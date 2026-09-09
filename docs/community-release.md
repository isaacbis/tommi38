# Community update — September 2026

## Behavior

- First visit presents an establishment picker. Existing Tommi38 sessions and root Firestore collections remain compatible. Switching establishments signs out before selecting another account scope.
- New establishments use `establishments/{id}/{collection}` for users, admin configuration, fields, reservations, player searches, waitlist and credit history. The server validates the establishment and session membership; the selector/header cannot grant access to another establishment. Async context keeps simultaneous requests isolated.
- Home shows credits, upcoming personal bookings, open player searches, communications and the personal waitlist. Existing organizer acceptance/rejection and contact privacy are retained.
- Occupied slots offer a waitlist. Home refreshes while visible and reports a newly free slot; booking remains explicit and subject to normal limits. This is an in-app availability notice, not background web push or an automatic reservation.
- Credit ledger records new booking debits, existing-policy user cancellation refunds and admin adjustments in the same transaction as their balance changes. Existing balances are preserved; historical transactions cannot be reconstructed. Negative/fractional admin balances are refused. User rename carries credit history and waitlist ownership in the existing atomic batch, subject to Firestore’s batch size limit.
- Admin operations show user count, aggregate credit balance, bookings from today and counts by field. These are current figures, not historical occupancy or revenue: the existing cleanup deletes expired bookings.
- Admins can close and reopen dated time ranges. Closure creation refuses overlaps with booked slots; booking reads closures transactionally. Limits are rechecked in the booking transaction. Existing cancellation/refund policy is unchanged.
- No new paid services, purchase flow or ads are configured. Native reminders remain compatible and use establishment-prefixed IDs outside Tommi38.

## Add an establishment

Only Tommi38 is supplied by default; do not add fictitious venues or import another live service's users without a migration plan. On the trusted backend environment with its existing Firestore credentials, set `INITIAL_ADMIN_PASSWORD` to a unique password of at least 12 characters and run:

```
node scripts/create-establishment.js <id> "<display name>" <admin-username>
```

The script stores a bcrypt hash and atomically creates a new establishment, admin, configuration and empty field list. It refuses an existing ID and does not print the password. Sign in to that establishment and configure its fields. Existing user-management routes operate only in the selected establishment. Further branding and self-service user onboarding remain separate work.

## Validation

Install the existing backend dependencies, then run `node --test tests/*.test.cjs` from the repository root (17 tests). Regression tests exercise routes with an in-memory Firestore double including read-before-write checks, rollback on failure, serialized transactions, booking limits, credit privacy/refunds, closure overlaps and private waitlists. Tenant tests use real AsyncLocalStorage. They do not replace Firestore emulator/load testing.

Browser fixture checks: establishment selection, login, Home, admin navigation and closure creation at desktop/mobile width (320 px). No real booking, user, balance or closure was modified during tests.

Syntax checks cover frontend scripts, service worker, server, routes, tenancy and establishment provisioning.

## Deploy and rollback

Existing service: Render `tommi38`, `srv-d5cocvbuibrs739ltnvg`, repository `isaacbis/tommi38`, branch `main`, URL https://tommi38.onrender.com . Firebase hosting configuration is legacy and is not the deploy target.

Pre-update live commit: `22204fcf1696c74ebd770bd6e9254772c07ffe19`.

Publish the reviewed commit through the existing Render service. `/api/health` now includes `version` from `RENDER_GIT_COMMIT` for exact verification. Public checks: `/api/establishments`, `/api/public/config`, JavaScript assets and unauthenticated API rejection. Service worker cache v12 includes the new community module.

Rollback by redeploying the previous successful Render deployment. There is no destructive migration; root Tommi38 collections stay in place. New scoped establishments, closure documents and ledger entries remain in Firestore, but old code does not expose them or enforce closures, so resolve any scheduled closures before a functional rollback.

Known pre-existing operational limitation: server sessions use MemoryStore and may expire on restart/deploy. Redis migration and background push are not included.
