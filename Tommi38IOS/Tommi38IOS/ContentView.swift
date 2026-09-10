import SwiftUI
import UIKit
import WebKit
import UserNotifications
import CryptoKit

struct ContentView: View {
    var body: some View {
        TommiWebView()
            .ignoresSafeArea(.container)
            .background(Color(red: 0.024, green: 0.082, blue: 0.145))
    }
}

struct TommiWebView: UIViewRepresentable {
    private let homeURL = URL(string: "https://tommi38.onrender.com/")!

    func makeCoordinator() -> Coordinator {
        Coordinator(homeURL: homeURL)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.applicationNameForUserAgent = "Tommi38-iOS-App/1.0"
        configuration.userContentController.add(context.coordinator, name: "tommi38Notifications")
        configuration.userContentController.addUserScript(WKUserScript(
            source: "window.tommi38Native = Object.freeze({notificationsVersion: 2});",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))

        let webView = WKWebView(frame: .zero, configuration: configuration)
        context.coordinator.webView = webView

        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.024, green: 0.082, blue: 0.145, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor
        webView.scrollView.alwaysBounceVertical = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = true

        let refreshControl = UIRefreshControl()
        refreshControl.tintColor = UIColor(red: 1.0, green: 0.68, blue: 0.22, alpha: 1)
        refreshControl.addTarget(
            context.coordinator,
            action: #selector(Coordinator.refresh),
            for: .valueChanged
        )
        webView.scrollView.refreshControl = refreshControl

        let request = URLRequest(
            url: homeURL,
            cachePolicy: .reloadRevalidatingCacheData,
            timeoutInterval: 30
        )
        webView.load(request)

        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "tommi38Notifications")
        uiView.navigationDelegate = nil
        uiView.uiDelegate = nil
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        weak var webView: WKWebView?
        private let homeURL: URL

        init(homeURL: URL) {
            self.homeURL = homeURL
        }

        private func trustedURL(_ url: URL) -> Bool {
            url.scheme?.lowercased() == "https" && url.host?.lowercased() == homeURL.host?.lowercased()
                && (url.port == nil || url.port == 443) && url.user == nil && url.password == nil
        }

        private func trustedFrame(_ frame: WKFrameInfo) -> Bool {
            frame.isMainFrame && frame.securityOrigin.protocol == "https"
                && frame.securityOrigin.host == homeURL.host
                && (frame.securityOrigin.port == 0 || frame.securityOrigin.port == 443)
        }

        private func openExternal(_ url: URL) {
            guard let scheme = url.scheme?.lowercased(), ["http", "https", "tel", "mailto", "sms"].contains(scheme) else { return }
            UIApplication.shared.open(url)
        }

        @objc func refresh() {
            webView?.load(URLRequest(url: homeURL))
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            webView.scrollView.refreshControl?.endRefreshing()
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            webView.scrollView.refreshControl?.endRefreshing()
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            webView.scrollView.refreshControl?.endRefreshing()
            guard (error as NSError).code != NSURLErrorCancelled else { return }
            showOfflinePage(in: webView)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            let scheme = url.scheme?.lowercased() ?? ""

            if scheme == "tel" || scheme == "mailto" || scheme == "sms" {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }

            if trustedURL(url) {
                decisionHandler(.allow)
                return
            }

            if scheme == "http" || scheme == "https" {
                openExternal(url)
                decisionHandler(.cancel)
                return
            }

            decisionHandler(url.absoluteString == "about:blank" ? .allow : .cancel)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            guard navigationAction.targetFrame == nil,
                  let url = navigationAction.request.url else {
                return nil
            }

            if trustedURL(url) {
                webView.load(URLRequest(url: url))
            } else {
                openExternal(url)
            }
            return nil
        }

        // WKWebView does not present JavaScript dialogs automatically.
        // These are used by the existing administration forms.
        private func dialogPresenter(for webView: WKWebView, frame: WKFrameInfo) -> UIViewController? {
            guard trustedFrame(frame),
                  var presenter = webView.window?.rootViewController else { return nil }
            while let presented = presenter.presentedViewController { presenter = presented }
            guard !(presenter is UIAlertController) else { return nil }
            return presenter
        }

        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            guard let presenter = dialogPresenter(for: webView, frame: frame) else {
                completionHandler(); return
            }
            let alert = UIAlertController(title: "Tommi38", message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
            presenter.present(alert, animated: true)
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            guard let presenter = dialogPresenter(for: webView, frame: frame) else {
                completionHandler(false); return
            }
            let alert = UIAlertController(title: "Tommi38", message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Annulla", style: .cancel) { _ in completionHandler(false) })
            alert.addAction(UIAlertAction(title: "Conferma", style: .default) { _ in completionHandler(true) })
            presenter.present(alert, animated: true)
        }

        func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                     defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                     completionHandler: @escaping (String?) -> Void) {
            guard let presenter = dialogPresenter(for: webView, frame: frame) else {
                completionHandler(nil); return
            }
            let alert = UIAlertController(title: "Tommi38", message: prompt, preferredStyle: .alert)
            alert.addTextField { field in
                field.text = defaultText
                field.autocapitalizationType = .none
                field.autocorrectionType = .no
                field.isSecureTextEntry = prompt.localizedCaseInsensitiveContains("password")
            }
            alert.addAction(UIAlertAction(title: "Annulla", style: .cancel) { _ in completionHandler(nil) })
            alert.addAction(UIAlertAction(title: "Conferma", style: .default) { [weak alert] _ in
                completionHandler(alert?.textFields?.first?.text)
            })
            presenter.present(alert, animated: true)
        }

        // Riceve i messaggi inviati da script.js dopo creazione/cancellazione prenotazione.
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard trustedFrame(message.frameInfo),
                  message.name == "tommi38Notifications",
                  let payload = message.body as? [String: Any],
                  let type = payload["type"] as? String else {
                return
            }

            BookingReminderStore.shared.receive(type: type, payload: payload)
        }

        private func showOfflinePage(in webView: WKWebView) {
            let html = """
            <!doctype html>
            <html lang="it">
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
              <style>
                *{box-sizing:border-box} body{margin:0;min-height:100vh;padding:env(safe-area-inset-top) 22px env(safe-area-inset-bottom);display:flex;align-items:center;justify-content:center;text-align:center;background:#061525;color:#fff;font-family:-apple-system,BlinkMacSystemFont,sans-serif}
                .box{width:min(100%,420px)} img{width:92px;height:92px;border-radius:22px} h1{margin:18px 0 8px;font-size:30px} p{margin:0;color:#9fb3d0;line-height:1.5} button{width:100%;margin-top:24px;padding:15px;border:0;border-radius:16px;background:#ffad38;color:#071321;font-weight:800;font-size:17px}
              </style>
            </head>
            <body><div class="box"><img src="https://tommi38.onrender.com/icon-192.png" alt=""><h1>Connessione assente</h1><p>Controlla Internet e riprova.</p><button onclick="location.href='https://tommi38.onrender.com/'">Riprova</button></div></body>
            </html>
            """
            webView.loadHTMLString(html, baseURL: homeURL)
        }
    }
}

@MainActor
final class BookingReminderStore {
    static let shared = BookingReminderStore()
    private let center = UNUserNotificationCenter.current()
    private let prefix = "tommi38.booking."
    private var activeScope: String?
    private var revision = 0
    private var desiredIdentifiers = Set<String>()
    private var immediateIdentifiers = Set<String>()

    private struct Reminder {
        let id: String
        let field: String
        let time: String
        let bookingDate: Date
        let reminderDate: Date
    }

    private func digest(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private func scope(from payload: [String: Any]) -> String? {
        guard let account = payload["account"] as? String, !account.isEmpty, account.count <= 80,
              let establishment = payload["establishment"] as? String, !establishment.isEmpty,
              establishment.count <= 60 else { return nil }
        return digest(establishment + "\u{0}" + account)
    }

    private func reminder(from payload: [String: Any]) -> Reminder? {
        guard let id = payload["id"] as? String, !id.isEmpty, id.count <= 240,
              let field = payload["field"] as? String, !field.isEmpty, field.count <= 160,
              let date = payload["date"] as? String, date.count == 10,
              let time = payload["time"] as? String, time.count == 5 else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(identifier: "Europe/Rome")
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        formatter.isLenient = false
        let value = date + " " + time
        guard let bookingDate = formatter.date(from: value), formatter.string(from: bookingDate) == value,
              bookingDate > Date() else { return nil }
        let before = min(max(payload["minutesBefore"] as? Int ?? 30, 0), 1440)
        return Reminder(id: id, field: field, time: time, bookingDate: bookingDate,
                        reminderDate: bookingDate.addingTimeInterval(TimeInterval(-before * 60)))
    }

    private func identifier(_ reminder: Reminder, scope: String) -> String {
        prefix + "v2." + scope + "." + digest(reminder.id)
    }

    private func isCurrent(_ scope: String, revision expected: Int) -> Bool {
        activeScope == scope && revision == expected
    }

    func receive(type: String, payload: [String: Any]) {
        guard let scope = scope(from: payload) else { return }
        if type == "clearBookings" {
            clear(scope: scope)
            return
        }
        guard ["bookingContext", "bookingCreated", "bookingCancelled", "syncBookings"].contains(type) else { return }
        if activeScope != scope { activate(scope: scope) }
        switch type {
        case "bookingCreated":
            guard let item = reminder(from: payload) else { return }
            revision += 1
            let expected = revision
            desiredIdentifiers.insert(identifier(item, scope: scope))
            immediateIdentifiers.insert(identifier(item, scope: scope))
            Task { @MainActor in
                guard isCurrent(scope, revision: expected), await notificationPermission(), isCurrent(scope, revision: expected) else { return }
                await schedule(item, scope: scope, revision: expected, allowImmediate: true)
            }
        case "bookingCancelled":
            guard let id = payload["id"] as? String, !id.isEmpty, id.count <= 240 else { return }
            let identifier = prefix + "v2." + scope + "." + digest(id)
            revision += 1
            desiredIdentifiers.remove(identifier)
            immediateIdentifiers.remove(identifier)
            center.removePendingNotificationRequests(withIdentifiers: [identifier])
            center.removeDeliveredNotifications(withIdentifiers: [identifier])
        case "syncBookings":
            guard let values = payload["items"] as? [[String: Any]], values.count <= 1000 else { return }
            let parsed = values.compactMap { reminder(from: $0) }
                .sorted { $0.bookingDate < $1.bookingDate }
            // Keep the nearest reminders within the operating system's pending-request budget.
            let items = Array(parsed.prefix(64))
            revision += 1
            let expected = revision
            desiredIdentifiers = Set(items.map { identifier($0, scope: scope) })
            immediateIdentifiers.formIntersection(desiredIdentifiers)
            Task { @MainActor in await synchronize(items, scope: scope, revision: expected) }
        default:
            break
        }
    }

    private func activate(scope: String) {
        revision += 1
        activeScope = scope
        desiredIdentifiers.removeAll()
        immediateIdentifiers.removeAll()
        Task { @MainActor in
            let pending = await center.pendingNotificationRequests()
            let delivered = await center.deliveredNotifications()
            guard activeScope == scope else { return }
            // Older app versions have no account scope: retire only their known Tommi38 reminders.
            let outdated = pending.filter { $0.identifier.hasPrefix(prefix) && $0.content.userInfo["tommi38Scope"] as? String != scope }.map(\.identifier)
            let oldDelivered = delivered.filter { $0.request.identifier.hasPrefix(prefix) && $0.request.content.userInfo["tommi38Scope"] as? String != scope }.map { $0.request.identifier }
            center.removePendingNotificationRequests(withIdentifiers: outdated)
            center.removeDeliveredNotifications(withIdentifiers: oldDelivered)
        }
    }

    private func clear(scope: String) {
        if activeScope == scope {
            revision += 1
            activeScope = nil
            desiredIdentifiers.removeAll()
            immediateIdentifiers.removeAll()
        }
        let clearingRevision = revision
        Task { @MainActor in
            let pending = await center.pendingNotificationRequests()
            let delivered = await center.deliveredNotifications()
            guard revision == clearingRevision || activeScope != scope else { return }
            func belongs(_ request: UNNotificationRequest) -> Bool {
                guard request.identifier.hasPrefix(prefix) else { return false }
                let owner = request.content.userInfo["tommi38Scope"] as? String
                return owner == scope || owner == nil
            }
            center.removePendingNotificationRequests(withIdentifiers: pending.filter(belongs).map(\.identifier))
            center.removeDeliveredNotifications(withIdentifiers: delivered.filter { belongs($0.request) }.map { $0.request.identifier })
        }
    }

    private func notificationPermission() async -> Bool {
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return true
        case .notDetermined:
            return (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
        default:
            return false
        }
    }

    private func synchronize(_ items: [Reminder], scope: String, revision expected: Int) async {
        let pending = await center.pendingNotificationRequests()
        let delivered = await center.deliveredNotifications()
        guard isCurrent(scope, revision: expected) else { return }
        let desired = Set(items.map { identifier($0, scope: scope) })
        let owned = pending.filter { $0.identifier.hasPrefix(prefix) && $0.content.userInfo["tommi38Scope"] as? String == scope }
        center.removePendingNotificationRequests(withIdentifiers: owned.filter { !desired.contains($0.identifier) }.map(\.identifier))
        center.removeDeliveredNotifications(withIdentifiers: delivered.filter {
            $0.request.identifier.hasPrefix(prefix) && $0.request.content.userInfo["tommi38Scope"] as? String == scope && !desired.contains($0.request.identifier)
        }.map { $0.request.identifier })
        let existing = Set(owned.map(\.identifier))
        let missing = items.filter { !existing.contains(identifier($0, scope: scope)) && ($0.reminderDate > Date() || immediateIdentifiers.contains(identifier($0, scope: scope))) }
        guard !missing.isEmpty, await notificationPermission(), isCurrent(scope, revision: expected) else { return }
        for item in missing {
            guard isCurrent(scope, revision: expected) else { return }
            await schedule(item, scope: scope, revision: expected, allowImmediate: immediateIdentifiers.contains(identifier(item, scope: scope)))
        }
    }

    private func schedule(_ item: Reminder, scope: String, revision expected: Int, allowImmediate: Bool) async {
        guard isCurrent(scope, revision: expected), item.bookingDate > Date() else { return }
        var fireDate = item.reminderDate
        if fireDate <= Date() {
            guard allowImmediate else { return }
            fireDate = Date().addingTimeInterval(5)
        }
        let content = UNMutableNotificationContent()
        content.title = "Tommi38"
        content.body = "La tua prenotazione di \(item.field) inizia alle \(item.time)."
        content.sound = .default
        content.userInfo = ["reservationId": item.id, "tommi38Scope": scope]
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Rome") ?? .current
        var components = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: fireDate)
        components.timeZone = calendar.timeZone
        let request = UNNotificationRequest(identifier: identifier(item, scope: scope), content: content,
                                            trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false))
        do { try await center.add(request) } catch { return }
        // A logout can race an asynchronous add. Never leave a previous account's reminder behind.
        if activeScope != scope || !desiredIdentifiers.contains(request.identifier) {
            center.removePendingNotificationRequests(withIdentifiers: [request.identifier])
        } else { immediateIdentifiers.remove(request.identifier) }
    }
}

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView()
    }
}
