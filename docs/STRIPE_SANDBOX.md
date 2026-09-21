# Stripe sandbox connection

Only personal demo workspaces can start checkout or confirm a payment. Real tenant balances cannot be credited by these routes. The server reads package price and credits, pins the connected account, and accepts sk_test keys only.

Render variables: STRIPE_TEST_SECRET_KEY (secret), STRIPE_TEST_CONNECTED_ACCOUNT. No credentials in Git.

In Laboratorio di prova, create a priced package as the demo manager, then use Prova pagamento Stripe. After returning, reopen the same screen and choose Verifica ultimo pagamento di prova. Confirmation retrieves the session directly from Stripe and checks test mode, order metadata, session ID, account, currency, amount and paid status. A transaction prevents duplicate credit grants.

This is a manual sandbox reconciliation flow, not production checkout. It has no webhook or real refunds yet. Native iOS external checkout navigation is not validated. Connected-account capability restrictions can prevent checkout. Live payments and AdMob rewards remain unavailable.
