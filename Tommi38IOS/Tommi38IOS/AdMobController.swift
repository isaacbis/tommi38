import UIKit
import WebKit
import GoogleMobileAds
import UserMessagingPlatform

/// No account names or venue locations are sent to Google. Rewards use a one-use opaque token.
@MainActor
final class AdMobController: NSObject, FullScreenContentDelegate {
    weak var webView: WKWebView?
    private var rewarded: RewardedAd?
    private var interstitial: InterstitialAd?
    private var busy = false
    private var started = false
    private var consentUpdated = false
    private var lastInterstitial = Date.distantPast
    private var activeRequest: String?
    private var generation = 0
    private var earned = false
    private var presenter: UIViewController? {
        guard var controller = webView?.window?.rootViewController else { return nil }
        while let next = controller.presentedViewController { controller = next }
        return controller is UIAlertController ? nil : controller
    }
    private func emit(_ status: String, id: String, privacyRequired: Bool? = nil) {
        guard let webView, webView.url?.scheme == "https", webView.url?.host == "tommi38.onrender.com" else { return }
        var data: [String: Any] = ["status": status, "id": id]
        if let privacyRequired { data["privacyRequired"] = privacyRequired }
        guard let bytes = try? JSONSerialization.data(withJSONObject: data), let json = String(data: bytes, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('campoprontoAd',{detail:\(json)}));")
    }
    private func consent() async -> Bool {
        if !consentUpdated {
            do {
                try await ConsentInformation.shared.requestConsentInfoUpdate(with: RequestParameters())
                try await ConsentForm.loadAndPresentIfRequired(from: presenter)
                consentUpdated = true
            } catch { return false }
        }
        guard ConsentInformation.shared.canRequestAds else { return false }
        if !started {
            // Do not request ATT or IDFA. Disable publisher first-party identifiers as well.
            MobileAds.shared.requestConfiguration.setPublisherFirstPartyIDEnabled(false)
            MobileAds.shared.requestConfiguration.maxAdContentRating = .general
            await MobileAds.shared.start()
            started = true
        }
        return true
    }
    func receive(_ payload: [String: Any]) {
        guard let action = payload["action"] as? String,
              let id = payload["id"] as? String, id.count <= 80 else { return }
        if action == "cancel" { generation += 1; return }
        if busy { emit("busy", id: id); return }
        busy = true
        let expected = generation
        Task { @MainActor in
            defer { if activeRequest == nil { busy = false } }
            if action == "privacy" {
                do {
                    if !consentUpdated { _ = await consent() }
                    if ConsentInformation.shared.privacyOptionsRequirementStatus == .required {
                        try await ConsentForm.presentPrivacyOptionsForm(from: presenter)
                    }
                    emit("privacy", id: id, privacyRequired: ConsentInformation.shared.privacyOptionsRequirementStatus == .required)
                } catch { emit("unavailable", id: id) }
                return
            }
            guard ["reward", "testReward", "interstitial", "prepare"].contains(action), await consent() else {
                emit("unavailable", id: id); return
            }
            if action == "prepare" {
                emit("ready", id: id, privacyRequired: ConsentInformation.shared.privacyOptionsRequirementStatus == .required)
                return
            }
            guard generation == expected, let presenter, presenter.presentedViewController == nil else { emit("unavailable", id: id); return }
            let request = Request()
            let extras = Extras(); extras.additionalParameters = ["npa": "1"]
            request.register(extras)
            do {
                if action == "reward" || action == "testReward" {
                    guard let token = payload["token"] as? String, token.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { emit("unavailable", id: id); return }
                    #if DEBUG
                    let unit = "ca-app-pub-3940256099942544/1712485313"
                    #else
                    let unit = "ca-app-pub-5793073160443124/7248847275"
                    #endif
                    rewarded = try await RewardedAd.load(with: action == "testReward" ? "ca-app-pub-3940256099942544/1712485313" : unit, request: request)
                    let options = ServerSideVerificationOptions()
                    options.customRewardText = token
                    rewarded?.serverSideVerificationOptions = options
                    rewarded?.fullScreenContentDelegate = self
                    activeRequest = id; earned = false
                    guard generation == expected else { finish("closed"); return }
                    rewarded?.present(from: presenter) { [weak self] in self?.earned = true }
                } else {
                    guard Date().timeIntervalSince(lastInterstitial) >= 1800 else { emit("skipped", id:id); return }
                    #if DEBUG
                    let unit = "ca-app-pub-3940256099942544/4411468910"
                    #else
                    let unit = "ca-app-pub-5793073160443124/2680912264"
                    #endif
                    interstitial = try await InterstitialAd.load(with: unit, request: request)
                    interstitial?.fullScreenContentDelegate = self
                    activeRequest = id; earned = false
                    guard generation == expected else { finish("skipped"); return }
                    interstitial?.present(from: presenter)
                }
            } catch { emit("unavailable", id: id) }
        }
    }
    func adWillPresentFullScreenContent(_ ad: FullScreenPresentingAd) {
        if interstitial != nil { lastInterstitial = Date() }
    }
    func adDidDismissFullScreenContent(_ ad: FullScreenPresentingAd) { finish(earned ? "earned" : "closed") }
    func ad(_ ad: FullScreenPresentingAd, didFailToPresentFullScreenContentWithError error: Error) { finish("unavailable") }
    private func finish(_ status: String) {
        if let id = activeRequest { emit(status, id: id) }
        activeRequest = nil; rewarded = nil; interstitial = nil; busy = false; earned = false
    }
}
