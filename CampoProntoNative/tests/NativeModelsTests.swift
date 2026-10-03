import Foundation
@main
struct NativeModelsTests {
    static func main() throws {
        var config = VenueConfig(); config.dayStart = "09:00"; config.dayEnd = "21:00"; config.slotMinutes = 60
        precondition(Clock.slots(config).count == 12)
        precondition(Clock.slots(config).first == "09:00" && Clock.slots(config).last == "20:00")
        config.slotMinutes = 40; config.dayEnd = "10:00"
        precondition(Clock.slots(config) == ["09:00"])
        config.slotMinutes = 0; precondition(Clock.slots(config).isEmpty)
        let closure = Closure(id:"period",fieldId:"court",startDate:"2026-10-03",endDate:"2026-10-05",start:"10:00",end:"12:00")
        precondition(closure.contains("2026-10-03", "09:45", duration: 40))
        precondition(closure.contains("2026-10-05", "11:30", duration: 40))
        precondition(!closure.contains("2026-10-06", "11:00", duration: 40))
        precondition(!closure.contains("2026-10-04", "12:00", duration: 40))
        let decoder = JSONDecoder()
        let member = try decoder.decode(Member.self, from: Data(#"{"username":"admin","role":"admin","credits":0,"platformAdmin":true,"managementMode":true,"demo":false,"demoExpiresAt":null,"establishment":{"id":"demo","name":"Demo","enabled":true}}"#.utf8))
        precondition(member.isManager && member.platformAdmin == true && member.managementMode == true)
        let status = try decoder.decode(AdsStatus.self, from: Data(#"{"available":true,"videos":1,"remainingVideos":0,"earned":true}"#.utf8))
        precondition(status.earned == true && status.remainingVideos == 0)
        let result = try decoder.decode(BookingResponse.self, from: Data(#"{"items":[{"id":"a","fieldId":"volley","date":"2026-10-04","time":"09:00","user":""}],"closures":[]}"#.utf8))
        precondition(result.items[0].user == "" && result.closures?.isEmpty == true)
        let requests = try decoder.decode(Items<PlayerSearch>.self, from: Data(#"{"items":[{"id":"a","reservationId":"a","fieldId":"volley","date":"2026-10-04","time":"09:00","note":"Partita","spotsAvailable":1,"isOwner":false,"canManage":false,"requests":[],"myRequest":null}]}"#.utf8))
        precondition(requests.items.first?.canManage == false)
        precondition(Clock.day(Clock.date(day:"2026-10-25", time:"18:00")!) == "2026-10-25")
        print("Native model checks passed: slots, closure boundaries, server contracts, reward status and Rome timezone.")
    }
}
