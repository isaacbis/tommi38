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

Verified on 2026-09-21:
- 142 tests passed; signed archive uploaded successfully as 1.1 (3), selected in App Store Connect.
- UMP European message published in Italian and English with a reject option.
- AdMob SSV console signature probe passed and callback URL saved. Both raw and percent-decoded signed callback representations are validated cryptographically; console probes never grant credits.
- Native Google test rewarded video displayed and completed on iPhone 17 Pro Max simulator.
- Render ADMOB_ENABLED=true deployed. Production reward UI correctly displays 0/2 verified videos and the first-video action. No live ad was clicked or used to generate developer revenue.
- Review account login and next-day court availability verified. App Store privacy disclosures, advertising age-rating answer, name, release notes and review instructions updated.
- Three current 1320x2868 iPhone screenshots uploaded (booking grid, rewards, home). Version 1.1 (3) submitted on 2026-09-21 at 20:13 Europe/Rome; App Store Connect confirmed “In attesa di verifica”, submission 6ab8da8d-1453-4401-9b31-da490c2717e8. Automatic release after approval selected. Existing iPad screenshots retained.
- Final web deployment: cd91ecff6bdce2218fb368d6f65f9a53482d40e7, verified using /api/health. Home data stays visible during background refresh.
- app-ads.txt publicly returns the matching publisher record. Google verification remains pending: Apple's public 1.0 lookup has no sellerUrl. The 1.1 marketing URL is set to https://tommi38.onrender.com/ and must become public before Google can discover it. Retry Google app verification after release; account/app approval is independent of this integration.

Real-money credit packs remain disabled; Stripe is sandbox-only. Two real signed videos granting a live reward still need validation after Google permits ad delivery. Do not substitute client callbacks or test impressions for real SSV credit authorization.
