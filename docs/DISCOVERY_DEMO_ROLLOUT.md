# Discovery, demo and commercial preferences — work in progress

Deployed on 2026-09-14, production commit 420046c:
- Public venue name/city search and optional device location sorting. Position stays in browser memory.
- New venues default to private; only platform administrators can publish them. Existing venue visibility is retained.
- Exact venue code lookup preserves access to private venues and remembered sessions. Codes are discovery identifiers, not authentication credentials.
- Platform city/coordinate editing.
- Personal manager demo namespace with separate manager/user personas, 100 initial demo credits, persistent configuration, isolated generation-based reset and explicit return to the original account.
- Commercial preference storage: ads/annual plan, optional two-video reward preference, daily limit, fixed proposed 10% commission. No ad or payment entitlement is granted by saving preferences.

Not implemented or not activated:
- Stripe Connect onboarding, checkout, payment/refund webhooks and settlement.
- AdMob SDK, consent, verified rewarded callbacks and interstitial delivery.
- StoreKit annual user subscription and verified entitlement restoration.
- Demo supports allowlisted scheduling/field copy into a fresh workspace and isolated, idempotent purchase/video simulations. No actual ad or checkout is involved.
- Support email is now campopronto.assistenza@gmail.com and deployed on public support/privacy pages.
- Public seller identity changes (individual Apple accounts display the legal name).

User delegated draft pricing: EUR 9.99/year for users and EUR 149/year for venues. Prices are provisional, not published products. Processing fees and merchant onboarding still require a decision. Stripe setup remains outstanding. AdMob account and iOS app record are created; payment profile is registered and account review is pending.

Do not deploy commercial activation into the app currently awaiting review: it was submitted as advertising/payment free. Update privacy, commercial/trader declarations and review notes and submit the appropriate new binary before activating monetization.

Validation: 134 node tests passed; browser smoke verified venue search and manager-to-demo-user entry. Further mobile layout, demo lifecycle, privacy/discovery authorization and payment-provider validation remain before release.

## AdMob setup, 2026-09-14

- iOS app: CampoPronto, app ID `ca-app-pub-5793073160443124~3993993932`.
- Interstitial unit: CampoPronto iOS - Transizioni, ID `ca-app-pub-5793073160443124/2680912264`.
- Frequency cap: one impression per user per 30 minutes. Natural transitions only; no interruption of login or booking completion.
- These public SDK identifiers do not activate delivery. No production SDK integration or rewarded unit yet.
- Reward design requires policy validation: personal, non-transferable, non-cash promotional entitlement distinct from purchased balances. Google permits qualifying indirect rewards but restricts direct monetary rewards and vouchers for physical items. Do not assume a physical court booking automatically qualifies.
- Official policy: https://support.google.com/adsense/answer/9121589?hl=en
