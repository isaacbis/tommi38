# CampoPronto ADS 1.1 (build 3)

Google Mobile Ads 13.10.0 / UMP 3.1.0, pinned Swift package. Bundle ID retained.
Nonpersonalized requests, publisher first-party ID disabled, no ATT/IDFA request.
UMP consent required before requesting ads; preferences accessible in account settings.
Debug rewarded/interstitial units use Google's test units. Demo lab exposes a dedicated test rewarded unit; it never grants real credits.

Real rewarded unit: ca-app-pub-5793073160443124/7248847275.
Interstitial: ca-app-pub-5793073160443124/2680912264, max one per 30 minutes.
Backend enable flag ADMOB_ENABLED=true is required. Without it no real rewards are offered.
Callback URL: https://tommi38.onrender.com/api/admob/ssv.
Only signed, recent Google SSV events for the pinned unit can grant reward progress. One-use opaque attempt tokens, session revalidation, daily Rome cap, atomic ledger. Two videos = one credit. Account deletion also removes linked AdMob attempts and daily progress.

Remaining release checks: publish UMP message, verify app-ads.txt, configure/test SSV on AdMob, native test-ad run, App Store privacy/disclosure and metadata, binary upload/review. Google approval is independent from the app integration.
