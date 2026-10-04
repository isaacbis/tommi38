import Foundation
import SwiftUI
import Security

/// The published service remains the sole authority for permissions, bookings and rewards.
@MainActor
final class BeachStore: ObservableObject {
    @Published var venues: [Venue] = []
    @Published var selected: Venue?
    @Published var member: Member?
    @Published var config = VenueConfig()
    @Published var bookings: [Booking] = []
    @Published var mine: [Booking] = []
    @Published var closures: [Closure] = []
    @Published var movements: [CreditMovement] = []
    @Published var waiting: [WaitEntry] = []
    @Published var searches: [PlayerSearch] = []
    @Published var users: [ManagedUser] = []
    @Published var platformVenues: [Venue] = []
    @Published var ads: AdsStatus?
    @Published var message: String?
    @Published var busy = false
    @Published var loading = true
    @Published var selectedDay = Date()
    @Published var dayLoading = false
    var shouldShowLoginAd = false
    private var generation = 0
    private var dayGeneration = 0
    private let base = URL(string: "https://ombrelloni-ddb55.web.app/api/")!
    private let session: URLSession
    init() {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 90
        c.timeoutIntervalForResource = 120
        c.httpCookieStorage = HTTPCookieStorage.shared
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: c)
        if let data = SecureSession.read(), let props = try? JSONSerialization.jsonObject(with: data) as? [String: String] {
            var converted = Dictionary(uniqueKeysWithValues: props.map { (HTTPCookiePropertyKey($0.key), $0.value as Any) })
            if let raw = props[HTTPCookiePropertyKey.expires.rawValue], let interval = Double(raw) { converted[.expires] = Date(timeIntervalSince1970: interval) }
            if let cookie = HTTPCookie(properties: converted) { HTTPCookieStorage.shared.setCookie(cookie) }
        }
    }
    func request<T: Decodable>(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> T {
        let expected = generation
        var req = URLRequest(url: base.appendingPathComponent(path.components(separatedBy: "?")[0]))
        if let query = path.components(separatedBy: "?").dropFirst().first { var u = URLComponents(url: req.url!, resolvingAgainstBaseURL: false)!; u.percentEncodedQuery = query; req.url = u.url }
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let selected { req.setValue(selected.id, forHTTPHeaderField: "X-Establishment") }
        if let body { req.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, response) = try await session.data(for: req)
        guard expected == generation else { throw CancellationError() }
        guard let http = response as? HTTPURLResponse else { throw APIError(code: "NETWORK") }
        guard (200..<300).contains(http.statusCode) else {
            let code = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String ?? "HTTP_\(http.statusCode)"
            if code == "DEMO_EXPIRED" { clearSession() }
            throw APIError(code: code)
        }
        saveCookie()
        return try JSONDecoder().decode(T.self, from: data)
    }
    func mutate(_ path: String, method: String = "POST", body: [String: Any] = [:]) async throws {
        let _: EmptyResponse = try await request(path, method: method, body: body)
    }
    func perform(_ action: () async throws -> Void) async {
        guard !busy else { return }; busy = true
        defer { busy = false }
        do { try await action() } catch is CancellationError {} catch { message = error.localizedDescription }
    }
    func bootstrap() async {
        defer { loading = false }
        do {
            let response: Items<Venue> = try await request("establishments"); venues = response.items
            if let id = UserDefaults.standard.string(forKey: "venue") {
                selected = venues.first { $0.id == id } ?? Venue(id: id, name: "CampoPronto ADS")
                do { member = try await request("me"); try await refresh() } catch { member = nil; selected = nil }
            }
        } catch { message = error.localizedDescription }
    }
    func openInvitation(_ url: URL) async {
        guard url.scheme == "campopronto", url.host == "venue", let id = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "id" })?.value, id.range(of: "^[a-z0-9-]{1,60}$", options: .regularExpression) != nil else { return }
        guard member == nil else { message = "Esci dall’account attuale prima di aprire l’invito a un altro stabilimento."; return }
        await perform { let response: Items<Venue> = try await self.request("establishments?code=" + id); guard let venue = response.items.first(where: { $0.id == id }) else { throw APIError(code: "ESTABLISHMENT_NOT_FOUND") }; self.generation += 1; self.selected = venue; self.config = try await self.request("public/config") }
    }
    func choose(_ venue: Venue) async {
        generation += 1; selected = venue; config = VenueConfig()
        await perform { self.config = try await self.request("public/config") }
    }
    func login(username: String, password: String) async {
        await perform {
            try await self.mutate("login", body: ["username": username.trimmingCharacters(in: .whitespaces), "password": password])
            self.shouldShowLoginAd = true
            self.member = try await self.request("me")
            UserDefaults.standard.set(self.selected?.id, forKey: "venue")
            if self.member?.demo != true { UserDefaults.standard.set(self.selected?.id, forKey: "lastRealVenue") }
            try await self.refresh()
        }
    }
    func refresh() async throws {
        guard member != nil else { return }
        config = try await request("public/config")
        member = try await request("me")
        if let venue = member?.establishment { selected = venue }
        if member?.managementMode != true { let result: Items<Booking> = try await request("reservations/mine"); mine = result.items } else { mine = [] }
        try await loadDay()
        await BookingReminders.sync(mine, fields: config.fields, enabled: member?.demo != true && UserDefaults.standard.bool(forKey: "bookingReminders"))
    }
    func loadDay() async throws {
        dayGeneration += 1; let expectedDay = dayGeneration
        dayLoading = true
        defer { if expectedDay == dayGeneration { dayLoading = false } }
        let day = Clock.day(selectedDay)
        let result: BookingResponse = try await request("reservations?date=" + day)
        guard expectedDay == dayGeneration, day == Clock.day(selectedDay) else { return }
        bookings = result.items; closures = result.closures ?? []
    }
    func loadCredits() async throws {
        let r: CreditResponse = try await request("credits"); movements = r.items; member?.credits = r.balance
        ads = try await request("ads/status")
    }
    func loadCommunity() async throws {
        let r: Items<PlayerSearch> = try await request("player-searches"); searches = r.items
        if member?.managementMode != true { let w: Items<WaitEntry> = try await request("waitlist"); waiting = w.items } else { waiting = [] }
    }
    func loadUsers() async throws { let r: Items<ManagedUser> = try await request("admin/users"); users = r.items }
    func loadPlatform() async throws { let r: Items<Venue> = try await request("platform/establishments"); platformVenues = r.items }
    func switchVenue(_ venue: Venue) async {
        await perform {
            try await self.mutate("platform/context", body: ["establishmentId": venue.id])
            self.generation += 1; self.selected = venue
            UserDefaults.standard.set(venue.id, forKey: "venue")
            self.member = try await self.request("me"); try await self.refresh()
        }
    }
    func startDemo(_ setup: DemoSetup?) async {
        await perform {
            let body: [String: Any]
            if let setup { let d = try JSONEncoder().encode(setup); body = ["setup": try JSONSerialization.jsonObject(with: d)] } else { body = [:] }
            let r: DemoResponse = try await self.request("demo/public", method: "POST", body: body)
            self.selected = Venue(id: r.establishmentId, name: setup?.name ?? "La tua demo")
            UserDefaults.standard.set(r.establishmentId, forKey: "venue")
            self.member = try await self.request("me"); try await self.refresh()
        }
    }
    func changeDemoRole() async {
        await perform { try await self.mutate("demo/enter", body: ["role": self.member?.isManager == true ? "user" : "admin"]); self.member = try await self.request("me"); try await self.refresh() }
    }
    func logout() async {
        await perform { try? await self.mutate(self.member?.demo == true ? "demo/exit" : "logout"); self.clearSession() }
    }
    func clearSession() {
        BookingReminders.clear()
        shouldShowLoginAd = false; generation += 1; dayGeneration += 1; dayLoading = false; closures = []; selectedDay = Date(); member = nil; selected = nil; mine = []; bookings = []; movements = []; searches = []; users = []; waiting = []; platformVenues = []; config = VenueConfig(); ads = nil
        HTTPCookieStorage.shared.cookies?.filter { $0.domain.contains("ombrelloni-ddb55.web.app") }.forEach { HTTPCookieStorage.shared.deleteCookie($0) }
        SecureSession.remove(); UserDefaults.standard.removeObject(forKey: "venue")
    }
    private func saveCookie() {
        guard let cookie = HTTPCookieStorage.shared.cookies?.first(where: { $0.name == "__session" && $0.domain.contains("ombrelloni-ddb55.web.app") }), let properties = cookie.properties else { return }
        let values = Dictionary(uniqueKeysWithValues: properties.compactMap { key, value -> (String,String)? in
            if let date = value as? Date { return (key.rawValue, String(date.timeIntervalSince1970)) }; return (key.rawValue, String(describing: value))
        })
        if let data = try? JSONSerialization.data(withJSONObject: values) { SecureSession.write(data) }
    }
}
struct EmptyResponse: Decodable {}
enum SecureSession {
    static var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "CampoPronto.session", kSecAttrAccount as String: "production"] }
    static func read() -> Data? { var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne; var out: CFTypeRef?; guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }; return out as? Data }
    static func write(_ data: Data) { remove(); var q = query; q[kSecValueData as String] = data; q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly; SecItemAdd(q as CFDictionary, nil) }
    static func remove() { SecItemDelete(query as CFDictionary) }
}
