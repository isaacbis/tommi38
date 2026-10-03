import SwiftUI
@main
@MainActor
struct BeachApp: App {
    @StateObject private var store = BeachStore()
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(store).tint(.blue)
                .environment(\.locale, Locale(identifier: "it_IT"))
                .environment(\.calendar, Clock.calendar)
                .environment(\.timeZone, Clock.calendar.timeZone)
                .onOpenURL { url in Task { await store.openInvitation(url) } }
        }
    }
}

import UserNotifications
/// Reminders are scheduled locally; the server remains authoritative for booking status.
@MainActor
enum BookingReminders {
    private static var revision = 0
    static func enable() async throws -> Bool {
        let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        UserDefaults.standard.set(granted, forKey: "bookingReminders")
        return granted
    }
    static func sync(_ bookings: [Booking], fields: [Field], enabled: Bool) async {
        revision += 1; let expected = revision
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests()
        guard expected == revision else { return }
        center.removePendingNotificationRequests(withIdentifiers: pending.filter { $0.identifier.hasPrefix("booking:") }.map(\.identifier))
        guard enabled else { return }
        for booking in bookings.sorted(by: { $0.date + $0.time < $1.date + $1.time }).prefix(60) {
            guard expected == revision else { return }
            guard booking.status != "cancelled", let start = Clock.date(day: booking.date, time: booking.time) else { continue }
            let reminder = start.addingTimeInterval(-1800)
            guard reminder > Date() else { continue }
            let content = UNMutableNotificationContent()
            content.title = "La tua partita inizia tra 30 minuti"
            content.body = "\(fields.first { $0.id == booking.fieldId }?.name ?? "Campo") · \(booking.time)"
            content.sound = .default
            var components = Clock.calendar.dateComponents([.year,.month,.day,.hour,.minute], from: reminder)
            components.timeZone = Clock.calendar.timeZone
            let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
            try? await center.add(UNNotificationRequest(identifier: "booking:" + booking.id, content: content, trigger: trigger))
            if expected != revision { center.removePendingNotificationRequests(withIdentifiers: ["booking:" + booking.id]); return }
        }
    }
    static func clear() { revision += 1; UNUserNotificationCenter.current().removeAllPendingNotificationRequests() }
}

import CoreLocation
@MainActor
final class NearbyVenues: NSObject, ObservableObject, @preconcurrency CLLocationManagerDelegate {
    @Published var location: CLLocation?
    @Published var status: String?
    private let manager = CLLocationManager()
    override init() { super.init(); manager.delegate = self; manager.desiredAccuracy = kCLLocationAccuracyKilometer }
    func locate() {
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse: manager.requestLocation()
        default: status = "Per cercare gli stabilimenti vicini, abilita la posizione nelle Impostazioni di iPhone."
        }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) { if [.authorizedAlways, .authorizedWhenInUse].contains(manager.authorizationStatus) { manager.requestLocation() } }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) { location = locations.last; status = nil }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { status = "Posizione non disponibile. Puoi cercare per nome o città." }
    func distance(_ venue: Venue) -> Double? { guard let location, let lat = venue.latitude, let lon = venue.longitude else { return nil }; return location.distance(from: CLLocation(latitude: lat, longitude: lon)) / 1000 }
}
