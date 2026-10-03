import UIKit
import GoogleMobileAds
import UserMessagingPlatform

/// Only an opaque, single-use reward token is shared with the advertising provider.
@MainActor
final class NativeAds: NSObject, FullScreenContentDelegate {
    static let shared = NativeAds()
    private var rewarded: RewardedAd?
    private var interstitial: InterstitialAd?
    private var lastInterstitial: Date {
        get { Date(timeIntervalSince1970: UserDefaults.standard.double(forKey: "lastLoginInterstitial")) }
        set { UserDefaults.standard.set(newValue.timeIntervalSince1970, forKey: "lastLoginInterstitial") }
    }
    private var continuation: CheckedContinuation<Bool, Error>?
    private var earned = false
    private var started = false
    private var consentUpdated = false
    private var loading = false
    private var presenter: UIViewController? {
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first(where: { $0.activationState == .foregroundActive }), var controller = scene.windows.first(where: \.isKeyWindow)?.rootViewController else { return nil }
        while let next = controller.presentedViewController { controller = next }
        return controller is UIAlertController ? nil : controller
    }
    private func consent() async throws {
        if !consentUpdated {
            try await ConsentInformation.shared.requestConsentInfoUpdate(with: RequestParameters())
            try await ConsentForm.loadAndPresentIfRequired(from: presenter)
            consentUpdated = true
        }
        guard ConsentInformation.shared.canRequestAds else { throw APIError(code: "ADS_UNAVAILABLE") }
        if !started {
            MobileAds.shared.requestConfiguration.setPublisherFirstPartyIDEnabled(false)
            MobileAds.shared.requestConfiguration.maxAdContentRating = .general
            await MobileAds.shared.start(); started = true
        }
    }
    func privacy() async throws {
        try await consent()
        if ConsentInformation.shared.privacyOptionsRequirementStatus == .required { try await ConsentForm.presentPrivacyOptionsForm(from: presenter) }
    }
    func showLoginAd() async throws {
        guard !loading, continuation == nil, Date().timeIntervalSince(lastInterstitial) >= 1800 else { return }
        loading = true; defer { loading = false }
        try await consent()
        let request = Request(); let extras = Extras(); extras.additionalParameters = ["npa": "1"]; request.register(extras)
        #if DEBUG
        let unit = "ca-app-pub-3940256099942544/4411468910"
        #else
        let unit = "ca-app-pub-5793073160443124/2680912264"
        #endif
        interstitial = try await InterstitialAd.load(with: unit, request: request)
        try Task.checkCancellation()
        guard let presenter, let interstitial else { return }
        interstitial.fullScreenContentDelegate = self; earned = false
        let _: Bool = try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation; interstitial.present(from: presenter)
        }
    }
    func adWillPresentFullScreenContent(_ ad: FullScreenPresentingAd) { if interstitial != nil { lastInterstitial = Date() } }
    func reward(token: String) async throws -> Bool {
        guard !loading, continuation == nil else { throw APIError(code: "ADS_BUSY") }
        loading = true; defer { loading = false }
        try await consent()
        guard token.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw APIError(code: "INVALID_REWARD_TOKEN") }
        let request = Request(); let extras = Extras(); extras.additionalParameters = ["npa": "1"]; request.register(extras)
        #if DEBUG
        let unit = "ca-app-pub-3940256099942544/1712485313"
        #else
        let unit = "ca-app-pub-5793073160443124/7248847275"
        #endif
        do { rewarded = try await RewardedAd.load(with: unit, request: request) } catch { throw APIError(code: "ADS_UNAVAILABLE") }
        try Task.checkCancellation()
        guard let presenter, let rewarded else { throw APIError(code: "ADS_UNAVAILABLE") }
        let options = ServerSideVerificationOptions(); options.customRewardText = token
        rewarded.serverSideVerificationOptions = options; rewarded.fullScreenContentDelegate = self; earned = false
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            rewarded.present(from: presenter) { [weak self] in self?.earned = true }
        }
    }
    func adDidDismissFullScreenContent(_ ad: FullScreenPresentingAd) { finish(.success(earned)) }
    func ad(_ ad: FullScreenPresentingAd, didFailToPresentFullScreenContentWithError error: Error) { finish(.failure(APIError(code: "ADS_UNAVAILABLE"))) }
    private func finish(_ result: Result<Bool, Error>) { let c = continuation; continuation = nil; rewarded = nil; interstitial = nil; earned = false; c?.resume(with: result) }
}
