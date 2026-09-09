import SwiftUI
import UIKit
import WebKit
import UserNotifications

struct ContentView: View {
    var body: some View {
        TommiWebView()
            .ignoresSafeArea()
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

            if url.scheme == "https", url.host == "tommi38.onrender.com" {
                decisionHandler(.allow)
                return
            }

            if scheme == "http" || scheme == "https" {
                UIApplication.shared.open(url)
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

            if url.scheme == "https", url.host == "tommi38.onrender.com" {
                webView.load(URLRequest(url: url))
            } else {
                UIApplication.shared.open(url)
            }
            return nil
        }

        // WKWebView does not present JavaScript dialogs automatically.
        // These are used by the existing administration forms.
        private func dialogPresenter(for webView: WKWebView, frame: WKFrameInfo) -> UIViewController? {
            guard frame.isMainFrame,
                  frame.securityOrigin.protocol == "https",
                  frame.securityOrigin.host == homeURL.host,
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
            guard message.frameInfo.isMainFrame,
                  message.frameInfo.securityOrigin.protocol == "https",
                  message.frameInfo.securityOrigin.host == homeURL.host,
                  message.name == "tommi38Notifications",
                  let payload = message.body as? [String: Any],
                  let type = payload["type"] as? String else {
                return
            }

            switch type {
            case "bookingCreated":
                scheduleBookingReminder(payload)
            case "bookingCancelled":
                if let id = payload["id"] as? String {
                    cancelBookingReminder(id: id)
                }
            default:
                break
            }
        }

        private func scheduleBookingReminder(_ payload: [String: Any]) {
            guard let id = payload["id"] as? String,
                  let field = payload["field"] as? String,
                  let date = payload["date"] as? String,
                  let time = payload["time"] as? String else {
                return
            }

            let minutesBefore = min(max(payload["minutesBefore"] as? Int ?? 30, 0), 1440)
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "it_IT")
            formatter.calendar = Calendar(identifier: .gregorian)
            formatter.timeZone = TimeZone(identifier: "Europe/Rome")
            formatter.dateFormat = "yyyy-MM-dd HH:mm"

            guard let bookingDate = formatter.date(from: "\(date) \(time)"), bookingDate > Date() else {
                return
            }

            var reminderDate = bookingDate.addingTimeInterval(TimeInterval(-minutesBefore * 60))

            // Se la prenotazione è stata effettuata a meno di 30 minuti dall'inizio,
            // l'avviso arriva quasi subito invece di essere perso.
            if reminderDate <= Date() {
                reminderDate = Date().addingTimeInterval(5)
            }

            let content = UNMutableNotificationContent()
            content.title = "Tommi38"
            content.body = "La tua prenotazione di \(field) inizia alle \(time)."
            content.sound = .default
            content.userInfo = ["reservationId": id]

            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: "Europe/Rome") ?? .current
            var components = calendar.dateComponents(
                [.year, .month, .day, .hour, .minute, .second],
                from: reminderDate
            )

            components.timeZone = calendar.timeZone
            let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
            let request = UNNotificationRequest(
                identifier: notificationIdentifier(for: id),
                content: content,
                trigger: trigger
            )

            UNUserNotificationCenter.current().add(request) { error in
                if let error {
                    print("Errore pianificazione notifica:", error.localizedDescription)
                }
            }
        }

        private func cancelBookingReminder(id: String) {
            let identifier = notificationIdentifier(for: id)
            UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [identifier])
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [identifier])
        }

        private func notificationIdentifier(for id: String) -> String {
            "tommi38.booking.\(id)"
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

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView()
    }
}
