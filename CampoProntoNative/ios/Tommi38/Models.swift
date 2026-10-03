import Foundation

struct Venue: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    var city: String?
    var latitude: Double?
    var longitude: Double?
    var enabled: Bool?
    var visibility: String?
}
struct Field: Codable, Identifiable, Hashable { var id: String; var name: String }
struct Photo: Codable, Hashable { var url: String; var caption: String?; var link: String? }
struct VenueConfig: Codable {
    var slotMinutes: Int = 40
    var dayStart: String = "08:00"
    var dayEnd: String = "23:00"
    var maxBookingsPerUserPerDay: Int = 1
    var maxActiveBookingsPerUser: Int = 1
    var fields: [Field] = []
    var notesText: String?
    var gallery: [Photo]?
    var registrationEnabled: Bool?
}
struct Member: Codable {
    var username: String
    var role: String
    var credits: Int
    var demo: Bool?
    var demoExpiresAt: Double?
    var platformAdmin: Bool?
    var managementMode: Bool?
    var establishment: Venue?
    var isManager: Bool { role == "admin" || platformAdmin == true }
}
struct Booking: Codable, Identifiable {
    var id: String
    var fieldId: String
    var date: String
    var time: String
    var user: String?
    var status: String?
}
struct Closure: Codable, Identifiable {
    var id: String
    var fieldId: String
    var date: String?
    var startDate: String?
    var endDate: String?
    var start: String
    var end: String
    var reason: String?
    func contains(_ day: String, _ time: String, duration: Int) -> Bool {
        let first = startDate ?? date ?? ""
        let last = endDate ?? date ?? first
        return day >= first && day <= last && Clock.minutes(time) < Clock.minutes(end) && Clock.minutes(time) + duration > Clock.minutes(start)
    }
}
struct CreditMovement: Codable, Identifiable { var id: String; var delta: Int; var reason: String; var at: String? }
struct CreditResponse: Codable { var balance: Int; var items: [CreditMovement] }
struct BookingResponse: Codable { var items: [Booking]; var closures: [Closure]? }
struct Items<T: Decodable>: Decodable { let items: [T] }
struct AdsStatus: Codable { var available: Bool; var videos: Int?; var remainingVideos: Int?; var earned: Bool? }
struct RewardToken: Decodable { var token: String }
struct DemoResponse: Decodable { var establishmentId: String; var expiresAt: Double }
struct DemoSetup: Encodable {
    var name = "La tua demo"
    var fields = ["Beach volley", "Tennis", "Padel"]
    var dayStart = "08:00"
    var dayEnd = "23:00"
    var slotMinutes = 40
}
struct ManagedUser: Codable, Identifiable { var username: String; var role: String; var credits: Int; var disabled: Bool?; var pendingApproval: Bool?; var id: String { username } }
struct WaitEntry: Codable, Identifiable { var id: String; var fieldId: String; var date: String; var time: String; var available: Bool? }
struct PlayerRequest: Codable, Identifiable { var id: String; var status: String?; var participantNames: [String]?; var phone: String?; var requesterUser: String? }
struct PlayerSearch: Codable, Identifiable {
    var id: String; var reservationId: String; var fieldId: String; var date: String; var time: String
    var note: String?; var spotsAvailable: Int?; var spotsNeeded: Int?
    var isOwner: Bool?; var canManage: Bool?; var myRequest: PlayerRequest?; var requests: [PlayerRequest]?
}
enum Clock {
    static var calendar: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Europe/Rome")!; return c }
    static func day(_ date: Date) -> String { let f = DateFormatter(); f.calendar = calendar; f.timeZone = calendar.timeZone; f.dateFormat = "yyyy-MM-dd"; return f.string(from: date) }
    static func minutes(_ time: String) -> Int { let parts = time.split(separator: ":").compactMap { Int($0) }; return parts.count == 2 ? parts[0] * 60 + parts[1] : 0 }
    static func slots(_ config: VenueConfig) -> [String] { guard config.slotMinutes > 0 else { return [] }; return stride(from: minutes(config.dayStart), through: minutes(config.dayEnd) - config.slotMinutes, by: config.slotMinutes).map { String(format: "%02d:%02d", $0 / 60, $0 % 60) } }
    static func date(day: String, time: String) -> Date? { let f = DateFormatter(); f.calendar = calendar; f.timeZone = calendar.timeZone; f.dateFormat = "yyyy-MM-dd HH:mm"; return f.date(from: day + " " + time) }
}
struct APIError: LocalizedError {
    let code: String
    var errorDescription: String? {
        switch code {
        case "INVALID_CREDENTIALS", "BAD_CREDENTIALS": return "Username o password non corretti."
        case "NO_CREDITS", "INSUFFICIENT_CREDITS": return "Non hai crediti sufficienti."
        case "SLOT_TAKEN", "SLOT_BUSY", "CONFLICT": return "Questo orario è appena stato prenotato. Aggiorna i campi."
        case "DEMO_EXPIRED": return "I dieci minuti della demo sono terminati."
        case "FORBIDDEN": return "Non puoi eseguire questa operazione con il tuo ruolo."
        case "UNAUTHORIZED": return "Accedi di nuovo per continuare."
        case "ADS_UNAVAILABLE": return "Al momento non ci sono video disponibili. Riprova più tardi."
        case "DAILY_LIMIT_REACHED", "REWARD_DAILY_LIMIT": return "Hai già ottenuto il credito di oggi."
        case "INVALID_DEMO_SETUP": return "Controlla i nomi dei campi e gli orari della demo."
        case "NETWORK": return "Connessione non disponibile. Riprova."
        default: return "Operazione non riuscita (\(code)). Riprova o contatta l’assistenza."
        }
    }
}
