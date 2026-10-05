package it.campopronto.ads

import android.app.Activity
import android.os.Bundle
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.*
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.ads.mediation.admob.AdMobAdapter
import com.google.android.gms.ads.*
import com.google.android.gms.ads.interstitial.*
import com.google.android.gms.ads.rewarded.*
import com.google.android.ump.*
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class NativeAds(private val activity: Activity) {
    private val consent = UserMessagingPlatform.getConsentInformation(activity)
    private val lock = Mutex()
    private var updated = false
    private var started = false
    private var showing = false
    private val prefs = activity.getSharedPreferences("ads", 0)
    val bannerUnit
        get() =
            if (BuildConfig.DEBUG) "ca-app-pub-3940256099942544/6300978111"
            else BuildConfig.BANNER_UNIT

    val rewardUnit
        get() =
            if (BuildConfig.DEBUG) "ca-app-pub-3940256099942544/5224354917"
            else BuildConfig.REWARDED_UNIT

    private val interstitialUnit
        get() =
            if (BuildConfig.DEBUG) "ca-app-pub-3940256099942544/1033173712"
            else BuildConfig.INTERSTITIAL_UNIT

    suspend fun prepare() =
        lock.withLock {
            if (!updated) {
                suspendCancellableCoroutine<Unit> { c ->
                    consent.requestConsentInfoUpdate(
                        activity,
                        ConsentRequestParameters.Builder().build(),
                        { if (c.isActive) c.resume(Unit) },
                        { if (c.isActive) c.resumeWithException(ApiException("ADS_UNAVAILABLE")) },
                    )
                }
                suspendCancellableCoroutine<Unit> { c ->
                    UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity) { error ->
                        if (c.isActive) {
                            if (error == null) c.resume(Unit)
                            else c.resumeWithException(ApiException("ADS_UNAVAILABLE"))
                        }
                    }
                }
                updated = true
            }
            if (!consent.canRequestAds()) throw ApiException("ADS_UNAVAILABLE")
            if (!started) {
                MobileAds.setRequestConfiguration(
                    RequestConfiguration.Builder()
                        .setMaxAdContentRating(RequestConfiguration.MAX_AD_CONTENT_RATING_G)
                        .build()
                )
                MobileAds.putPublisherFirstPartyIdEnabled(false)
                suspendCancellableCoroutine<Unit> { c ->
                    MobileAds.initialize(activity) { if (c.isActive) c.resume(Unit) }
                }
                started = true
            }
        }

    fun request(): AdRequest =
        AdRequest.Builder()
            .addNetworkExtrasBundle(
                AdMobAdapter::class.java,
                Bundle().apply { putString("npa", "1") },
            )
            .build()

    suspend fun privacy() {
        prepare()
        if (
            consent.privacyOptionsRequirementStatus ==
                ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED
        )
            suspendCancellableCoroutine<Unit> { c ->
                UserMessagingPlatform.showPrivacyOptionsForm(activity) {
                    if (c.isActive) c.resume(Unit)
                }
            }
    }

    suspend fun login(eligible: () -> Boolean) {
        if (
            showing ||
                interstitialUnit.isBlank() ||
                System.currentTimeMillis() - prefs.getLong("lastLogin", 0) < 120_000
        )
            return
        prepare()
        val ad =
            suspendCancellableCoroutine<InterstitialAd> { c ->
                InterstitialAd.load(
                    activity,
                    interstitialUnit,
                    request(),
                    object : InterstitialAdLoadCallback() {
                        override fun onAdLoaded(ad: InterstitialAd) {
                            if (c.isActive) c.resume(ad)
                        }

                        override fun onAdFailedToLoad(error: LoadAdError) {
                            if (c.isActive) c.resumeWithException(ApiException("ADS_UNAVAILABLE"))
                        }
                    },
                )
            }
        if (!eligible() || activity.isFinishing || activity.isDestroyed) return
        showing = true
        try {
            suspendCancellableCoroutine<Unit> { c ->
                ad.fullScreenContentCallback =
                    object : FullScreenContentCallback() {
                        override fun onAdShowedFullScreenContent() {
                            prefs.edit().putLong("lastLogin", System.currentTimeMillis()).apply()
                        }

                        override fun onAdDismissedFullScreenContent() {
                            if (c.isActive) c.resume(Unit)
                        }

                        override fun onAdFailedToShowFullScreenContent(error: AdError) {
                            if (c.isActive) c.resumeWithException(ApiException("ADS_UNAVAILABLE"))
                        }
                    }
                ad.show(activity)
            }
        } finally {
            showing = false
        }
    }

    suspend fun reward(token: String, eligible: () -> Boolean): Boolean {
        if (showing || rewardUnit.isBlank() || !Regex("^[a-f0-9]{64}$").matches(token))
            throw ApiException("ADS_UNAVAILABLE")
        prepare()
        val ad =
            suspendCancellableCoroutine<RewardedAd> { c ->
                RewardedAd.load(
                    activity,
                    rewardUnit,
                    request(),
                    object : RewardedAdLoadCallback() {
                        override fun onAdLoaded(ad: RewardedAd) {
                            if (c.isActive) c.resume(ad)
                        }

                        override fun onAdFailedToLoad(error: LoadAdError) {
                            if (c.isActive) c.resumeWithException(ApiException("ADS_UNAVAILABLE"))
                        }
                    },
                )
            }
        if (!eligible() || activity.isFinishing || activity.isDestroyed)
            throw ApiException("UNAUTHORIZED")
        ad.setServerSideVerificationOptions(
            ServerSideVerificationOptions.Builder().setCustomData(token).build()
        )
        var earned = false
        showing = true
        return try {
            suspendCancellableCoroutine<Boolean> { c ->
                ad.fullScreenContentCallback =
                    object : FullScreenContentCallback() {
                        override fun onAdDismissedFullScreenContent() {
                            if (c.isActive) c.resume(earned)
                        }

                        override fun onAdFailedToShowFullScreenContent(error: AdError) {
                            if (c.isActive) c.resumeWithException(ApiException("ADS_UNAVAILABLE"))
                        }
                    }
                ad.show(activity) { earned = true }
            }
        } finally {
            showing = false
        }
    }
}

@Composable
fun ClientBanner(activity: Activity, ads: NativeAds, ready: Boolean) {
    if (!ready || ads.bannerUnit.isBlank()) return
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val scope = rememberCoroutineScope()
    var loaded by remember { mutableStateOf(false) }
    var retry by remember { mutableStateOf<Job?>(null) }
    val view = remember {
        AdView(activity).apply {
            setAdSize(AdSize.BANNER)
            adUnitId = ads.bannerUnit
        }
    }
    DisposableEffect(view, lifecycle) {
        var loading = false
        var active = lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)
        fun load() {
            if (active && !loading && !loaded) {
                loading = true
                view.loadAd(ads.request())
            }
        }
        view.adListener =
            object : AdListener() {
                override fun onAdLoaded() {
                    loading = false
                    loaded = true
                    retry?.cancel()
                }

                override fun onAdFailedToLoad(error: LoadAdError) {
                    loading = false
                    loaded = false
                    retry?.cancel()
                    if (active)
                        retry =
                            scope.launch {
                                delay(60_000)
                                load()
                            }
                }
            }
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> {
                    active = true
                    view.resume()
                    load()
                }
                Lifecycle.Event.ON_PAUSE -> {
                    active = false
                    retry?.cancel()
                    view.pause()
                }
                else -> {}
            }
        }
        lifecycle.addObserver(observer)
        load()
        onDispose {
            lifecycle.removeObserver(observer)
            retry?.cancel()
            view.adListener = object : AdListener() {}
            view.destroy()
        }
    }
    Column(
        Modifier.fillMaxWidth().height(if (loaded) 74.dp else 0.dp).clipToBounds(),
        horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally,
    ) {
        Text("Pubblicità", fontSize = 10.sp)
        AndroidView(factory = { view }, modifier = Modifier.requiredSize(320.dp, 50.dp))
    }
}
