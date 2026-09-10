#!/usr/bin/env python3
"""Test the production Swift reminder store using a mock notification service.

Requires macOS, Python 3 and Xcode's Swift compiler. No app build, signing,
network connection, device or notification permission is needed.
"""
from pathlib import Path
import subprocess
import tempfile

stubs=r'''
import Foundation
import CryptoKit

enum UNAuthorizationStatus { case authorized, provisional, ephemeral, notDetermined, denied }
struct UNAuthorizationOptions: OptionSet { let rawValue: Int; static let alert = Self(rawValue: 1); static let sound = Self(rawValue: 2) }
struct UNNotificationSettings { var authorizationStatus: UNAuthorizationStatus }
struct UNNotificationSound { static let `default` = Self() }
final class UNMutableNotificationContent {
 var title = "", body = ""
 var sound: UNNotificationSound?
 var userInfo: [String: Any] = [:]
}
struct UNCalendarNotificationTrigger { let dateMatching: DateComponents; let repeats: Bool }
struct UNNotificationRequest {
 let identifier: String
 let content: UNMutableNotificationContent
 let trigger: UNCalendarNotificationTrigger?
}
struct UNNotification { let request: UNNotificationRequest }
@MainActor final class UNUserNotificationCenter {
 static let instance = UNUserNotificationCenter()
 static func current() -> UNUserNotificationCenter { instance }
 var pending: [String: UNNotificationRequest] = [:]
 var delivered: [String: UNNotification] = [:]
 var authorizationStatus: UNAuthorizationStatus = .authorized
 var permissionRequests = 0
 var additionCount = 0
 var holdNextAdd = false
 var addContinuation: CheckedContinuation<Void, Never>?
 var addingID: String?
 func reset() { pending = [:]; delivered = [:]; authorizationStatus = .authorized; permissionRequests = 0; additionCount = 0; holdNextAdd = false; addContinuation = nil; addingID = nil }
 func pendingNotificationRequests() async -> [UNNotificationRequest] { Array(pending.values) }
 func deliveredNotifications() async -> [UNNotification] { Array(delivered.values) }
 func removePendingNotificationRequests(withIdentifiers ids: [String]) { ids.forEach { pending.removeValue(forKey: $0) } }
 func removeDeliveredNotifications(withIdentifiers ids: [String]) { ids.forEach { delivered.removeValue(forKey: $0) } }
 func notificationSettings() async -> UNNotificationSettings { .init(authorizationStatus: authorizationStatus) }
 func requestAuthorization(options: UNAuthorizationOptions) async throws -> Bool { permissionRequests += 1; authorizationStatus = .authorized; return true }
 func add(_ request: UNNotificationRequest) async throws {
  additionCount += 1
  if holdNextAdd { holdNextAdd = false; addingID = request.identifier; await withCheckedContinuation { addContinuation = $0 } }
  pending[request.identifier] = request
 }
 func releaseAdd() { let c = addContinuation; addContinuation = nil; c?.resume() }
}
'''
tests=r'''
@main struct Tests {
 @MainActor static func settle() async { for _ in 0..<100 { await Task.yield() } }
 @MainActor static func until(_ condition: () -> Bool) async {
  for _ in 0..<2000 { if condition() { return }; await Task.yield() }
  fatalError("Timed out waiting for deterministic task checkpoint")
 }
 static func expect(_ result: @autoclosure () -> Bool, _ message: String) { if !result() { fatalError(message) } }
 static func context(_ user: String = "alice", _ venue: String = "tommi38") -> [String: Any] { ["account": user, "establishment": venue] }
 static func item(_ id: String = "booking1", date: String = "2099-10-10", time: String = "16:00") -> [String: Any] { ["id": id, "date": date, "time": time, "field": "Volley 1", "minutesBefore": 30] }
 static func payload(_ items: [[String: Any]], user: String = "alice", venue: String = "tommi38") -> [String: Any] { context(user, venue).merging(["items": items]) { _, new in new } }
 @MainActor static func main() async {
  let center = UNUserNotificationCenter.current()
  var passed = 0
  func pass(_ label: String) { passed += 1; print("PASS \(label)") }

  // The application's real store is compiled above; only Apple's delivery service is replaced.
  do {
   center.reset(); let store = BookingReminderStore(); center.authorizationStatus = .notDetermined
   store.receive(type: "bookingContext", payload: context()); await settle()
   expect(center.permissionRequests == 0, "Launch/context must not prompt")
   store.receive(type: "syncBookings", payload: payload([])); await settle()
   expect(center.permissionRequests == 0, "Empty sync must not prompt")
   store.receive(type: "syncBookings", payload: payload([item()])); await settle()
   expect(center.permissionRequests == 1 && center.pending.count == 1, "First real reminder requests permission")
   pass("Permission requested only when a reminder needs scheduling")
  }
  do {
   center.reset(); let store = BookingReminderStore()
   let unrelated = UNNotificationRequest(identifier: "unrelated.local", content: UNMutableNotificationContent(), trigger: nil)
   let legacy = UNNotificationRequest(identifier: "tommi38.booking.legacy", content: UNMutableNotificationContent(), trigger: nil)
   center.pending[unrelated.identifier] = unrelated; center.pending[legacy.identifier] = legacy
   center.delivered[legacy.identifier] = .init(request: legacy)
   store.receive(type: "syncBookings", payload: payload([item()])); await settle()
   let firstID = center.pending.keys.first { $0 != unrelated.identifier }!
   expect(center.pending.count == 2 && center.delivered.isEmpty, "Retire known legacy notifications only")
   store.receive(type: "syncBookings", payload: payload([item()], user: "bob")); await settle()
   let secondID = center.pending.keys.first { $0 != unrelated.identifier }!
   expect(firstID != secondID && center.pending.count == 2 && center.pending[unrelated.identifier] != nil, "Same booking IDs must differ across account")
   store.receive(type: "syncBookings", payload: payload([item()], user: "bob", venue: "venue2")); await settle()
   let thirdID = center.pending.keys.first { $0 != unrelated.identifier }!
   expect(secondID != thirdID && center.pending.count == 2, "Same booking IDs must differ across venues")
   pass("Account/venue isolation and legacy retirement preserve unrelated notifications")
  }
  do {
   center.reset(); let store = BookingReminderStore()
   store.receive(type: "syncBookings", payload: payload([item("a"), item("b")])); await settle()
   expect(center.pending.count == 2, "Initial complete snapshot schedules both")
   let removed = center.pending.values.first { $0.content.userInfo["reservationId"] as? String == "b" }!
   center.delivered[removed.identifier] = .init(request: removed)
   store.receive(type: "syncBookings", payload: payload([item("a")])); await settle()
   expect(center.pending.count == 1 && center.delivered.isEmpty, "Remote cancellation removed from pending and delivered")
   expect(center.additionCount == 2, "Repeated snapshots must not duplicate schedule")
   store.receive(type: "syncBookings", payload: payload([])); await settle()
   expect(center.pending.isEmpty, "Empty snapshot clears owned reminders")
   pass("Authoritative snapshots reconcile cancellation without duplicate reminders")
  }
  do {
   center.reset(); let store = BookingReminderStore()
   store.receive(type: "syncBookings", payload: payload([item()])); await settle()
   let unrelated = UNNotificationRequest(identifier: "unrelated.local", content: UNMutableNotificationContent(), trigger: nil)
   let otherContent = UNMutableNotificationContent(); otherContent.userInfo["tommi38Scope"] = "other-user"
   let other = UNNotificationRequest(identifier: "tommi38.booking.v2.other-user.test", content: otherContent, trigger: nil)
   center.pending[unrelated.identifier] = unrelated; center.pending[other.identifier] = other
   store.receive(type: "clearBookings", payload: context()); await settle()
   expect(Set(center.pending.keys) == Set([unrelated.identifier, other.identifier]), "Logout only removes specified account/venue and legacy")
   pass("Logout removes only the signed-out scope")
  }
  do {
   center.reset(); let store = BookingReminderStore(); center.holdNextAdd = true
   store.receive(type: "bookingCreated", payload: context().merging(item()) { _, new in new })
   await until { center.addContinuation != nil }
   store.receive(type: "clearBookings", payload: context()); await settle()
   center.releaseAdd(); await settle()
   expect(center.pending.isEmpty, "Delayed add must be cleaned after logout")
   pass("Logout racing a delayed notification add leaves no stale reminder")
  }
  do {
   center.reset(); let store = BookingReminderStore(); center.holdNextAdd = true
   store.receive(type: "bookingCreated", payload: context().merging(item()) { _, new in new })
   await until { center.addContinuation != nil }
   store.receive(type: "bookingCancelled", payload: context().merging(["id":"booking1"]) { _, new in new })
   center.releaseAdd(); await settle()
   expect(center.pending.isEmpty, "Delayed add must be cleaned after cancellation")
   pass("Cancellation racing a delayed add leaves no stale reminder")
  }
  do {
   center.reset(); let store = BookingReminderStore()
   store.receive(type: "syncBookings", payload: payload([item(date: "2099-02-30"), item(date: "2001-01-01"), item(time: "24:90")])); await settle()
   expect(center.pending.isEmpty && center.additionCount == 0, "Reject invalid or past date and time")
   store.receive(type: "syncBookings", payload: payload((0..<100).map { item("booking\($0)") })); await settle()
   expect(center.pending.count == 64, "Respect finite pending notification budget")
   pass("Date validation and 64-reminder budget")
  }
  do {
   center.reset(); let store = BookingReminderStore()
   let calendar = Calendar(identifier: .gregorian)
   let fmt = DateFormatter(); fmt.locale = Locale(identifier:"en_US_POSIX"); fmt.calendar = calendar; fmt.timeZone = TimeZone(identifier:"Europe/Rome"); fmt.dateFormat = "yyyy-MM-dd HH:mm"
   let pieces = fmt.string(from: Date().addingTimeInterval(15 * 60)).split(separator: " ").map(String.init)
   let soon = item(date: pieces[0], time: pieces[1])
   store.receive(type: "syncBookings", payload: payload([soon])); await settle()
   expect(center.pending.isEmpty, "Already elapsed reminder must not be replayed on login")
   store.receive(type: "bookingCreated", payload: context().merging(soon) { _, new in new }); await settle()
   expect(center.pending.count == 1, "New last-minute booking may remind immediately")
   let request = center.pending.values.first!; center.pending.removeAll(); center.delivered[request.identifier] = .init(request: request)
   store.receive(type: "syncBookings", payload: payload([soon])); await settle()
   expect(center.pending.isEmpty && center.additionCount == 1, "Delivered immediate reminder must not repeat at each refresh")
   pass("Last-minute reminders do not repeat after delivery")
  }
  expect(passed == 8, "Expected all eight scenarios to run")
  print("\(passed)/\(passed) native reminder scenarios passed (mock delivery, no device notifications)")
 }
}
'''

def main():
    repo = Path(__file__).resolve().parent.parent
    content = (repo / "Tommi38IOS/Tommi38IOS/ContentView.swift").read_text()
    marker = "@MainActor\nfinal class BookingReminderStore"
    if content.count(marker) != 1 or "\nstruct ContentView_Previews" not in content:
        raise RuntimeError("Cannot locate the production BookingReminderStore for testing")
    store = content.split(marker, 1)[1].split("\nstruct ContentView_Previews", 1)[0]
    with tempfile.TemporaryDirectory(prefix="tommi38-reminder-tests-") as temp_dir:
        source = Path(temp_dir) / "ReminderTests.swift"
        executable = Path(temp_dir) / "reminder-tests"
        source.write_text(stubs + "\n" + marker + store + tests)
        subprocess.run(["xcrun", "swiftc", "-parse-as-library", str(source), "-o", str(executable)], check=True)
        result = subprocess.run([str(executable)], check=True, text=True, capture_output=True)
        print(result.stdout, end="")
        if "8/8 native reminder scenarios passed" not in result.stdout:
            raise RuntimeError("The native reminder test did not complete all eight scenarios")


if __name__ == "__main__":
    main()
