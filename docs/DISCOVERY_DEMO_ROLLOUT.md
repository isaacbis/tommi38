# Discovery, demo and commercial preferences — work in progress

Implemented locally on codex/discovery-demo-monetization:
- Public venue name/city search and optional device location sorting. Position stays in browser memory.
- New venues default to private; only platform administrators can publish them. Existing venue visibility is retained.
- Exact venue code lookup preserves access to private venues and remembered sessions. Codes are discovery identifiers, not authentication credentials.
- Platform city/coordinate editing.
- Personal manager demo namespace with separate manager/user personas, 100 initial demo credits, persistent configuration and explicit return to the original account.
- Commercial preference storage: ads/annual plan, optional two-video reward preference, daily limit, fixed proposed 10% commission. No ad or payment entitlement is granted by saving preferences.

Not implemented or not activated:
- Stripe Connect onboarding, checkout, payment/refund webhooks and settlement.
- AdMob SDK, consent, verified rewarded callbacks and interstitial delivery.
- StoreKit annual user subscription and verified entitlement restoration.
- Demo reset/configuration copy and reward/payment simulation.
- New support email (awaiting an existing working address from owner).
- Public seller identity changes (individual Apple accounts display the legal name).

User delegated draft pricing: EUR 9.99/year for users and EUR 149/year for venues. Prices are provisional, not published products. Processing fees and merchant onboarding still require a decision. The owner has no Stripe or AdMob accounts yet.

Do not deploy commercial activation into the app currently awaiting review: it was submitted as advertising/payment free. Update privacy, commercial/trader declarations and review notes and submit the appropriate new binary before activating monetization.

Validation: 130 node tests passed; browser smoke verified venue search and manager-to-demo-user entry. Further mobile layout, demo lifecycle, privacy/discovery authorization and payment-provider validation remain before release.
