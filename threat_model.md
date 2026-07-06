# Threat Model

## Project Overview

This repository currently deploys a public path-routed accounting application with two production-reachable surfaces on the same origin: a TypeScript/Express API under `/api` and a React dashboard under `/accounting/`. The backend talks directly to PostgreSQL via Drizzle and to third-party seller APIs (Manapool, eBay, Scryfall) using server-side secrets and stored OAuth tokens.

Assumptions for security review:
- Only production-reachable issues are in scope.
- The current public deployment exposes `/api` and `/accounting/`; the root path returns an artifact listing/404.
- `app.py` is not part of the currently reachable public deployment unless future scans show otherwise.
- `app.py` and attached assets are dev-only unless production reachability is demonstrated.
- Replit-managed TLS is assumed in production.
- `NODE_ENV` is assumed to be `production` in production deployments.

## Assets

- **Business financial records** — purchases, custom sales, dashboard rollups, weekly profit data, and imported marketplace orders stored in PostgreSQL. Unauthorized reads or writes expose or corrupt the accounting ledger.
- **Marketplace operational data** — current unshipped Manapool orders, shipment actions, pick-state data, and imported eBay / TCGPlayer order history. These reveal business activity and can affect order fulfillment.
- **Marketplace credentials and tokens** — `MANAPOOL_API_KEY`, `MANAPOOL_EMAIL`, eBay client credentials, and the stored eBay refresh token. These let the server act directly on the seller's external accounts.
- **Authenticated browser sessions** — the `sid` session cookie and server-side session store grant access to all protected `/api` endpoints. Browser-side compromise can be used to exfiltrate data or invoke privileged actions.
- **Operational integrity** — sync and shipping endpoints can trigger upstream API traffic and overwrite shared local records. Abuse can poison accounting data, exhaust quotas, or disrupt fulfillment workflows.

## Trust Boundaries

- **Browser → Express API** — all request parameters, headers, cookies, and bodies are untrusted. Authentication alone is not sufficient; sensitive routes also need owner/staff authorization because the application operates on a single shared business dataset.
- **Express API → PostgreSQL** — the API has direct write access to global accounting and settings tables. Broken authorization here exposes or corrupts all business data.
- **Application → External marketplaces** — the server calls Manapool, eBay, and Scryfall with server-held credentials or tokens. Any route that triggers these calls inherits the seller account's privilege.
- **OIDC / OAuth provider → Application** — Replit OIDC login and eBay OAuth callbacks must be bound to the intended authenticated actor and deployment state. Callback routes must not trust arbitrary authorization responses or reflect untrusted parameters into HTML.
- **Public vs authenticated vs owner/admin boundary** — `/api/auth/*`, `/api/healthz`, and `/api/ebay/account-deletion` are public. Most remaining `/api` routes now require an authenticated session, but there is currently no server-side owner/admin or allowlist boundary after login.
- **Production vs dev-only boundary** — artifact preview tooling and the mockup sandbox should usually be ignored unless a future deployment exposes them publicly.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/*`, `artifacts/accounting/src/App.tsx`
- **Highest-risk areas:** `artifacts/api-server/src/routes/auth.ts`, `artifacts/api-server/src/routes/index.ts`, `artifacts/api-server/src/routes/orders.ts`, `artifacts/api-server/src/routes/manapick.ts`, `artifacts/api-server/src/routes/tcgplayer.ts`, `artifacts/api-server/src/routes/ebay.ts`, `artifacts/api-server/src/routes/dashboard.ts`, `lib/db/src/schema/auth.ts`, `lib/db/src/schema/settings.ts`
- **Public vs authenticated vs admin surfaces:** public routes are limited to auth, health, and eBay deletion challenge/ack endpoints; all other mounted API routes should be treated as authenticated-but-not-authorized until a real owner/admin boundary is added.
- **Usually dev-only:** `app.py`, `attached_assets/`

## Threat Categories

### Spoofing

The application trusts Replit OIDC for identity and eBay OAuth for marketplace account linking. The required guarantee is not just that sessions are valid, but that only explicitly approved owner/staff identities can use those sessions to access the shared business dataset. eBay OAuth flows must also bind authorization responses to the initiating user and deployment state so one user cannot rebind the deployment-wide seller connection or trick another logged-in user into completing a callback.

### Tampering

Purchases, custom sales, pick state, shipment actions, and marketplace sync results are integrity-sensitive shared resources. All create, delete, sync, shipping, and token-storage routes must enforce server-side owner/staff authorization before mutating data or invoking upstream seller APIs. Client-side navigation, possession of any valid Replit account, or knowledge of a route path is not a sufficient security boundary.

### Information Disclosure

Dashboard totals, weekly rollups, order histories, live Manapool order details, and imported marketplace data are business-sensitive. Protected routes must not disclose these records to arbitrary authenticated users, and HTML responses on authenticated routes must not reflect attacker-controlled input in a way that enables same-origin script execution. Secrets and tokens must not be placed in client-visible channels, source-controlled config, or unnecessary error bodies.

### Denial of Service

Sync and enrichment endpoints can trigger large numbers of upstream requests and database writes. Attackers who obtain any application session should not be able to repeatedly invoke Manapool, eBay, or TCGPlayer-related operations without additional authorization and abuse controls. External-service failures should not cascade into persistent corruption of shared local state.

### Elevation of Privilege

The primary privilege-escalation risk is that the current application treats any authenticated identity as a full operator for one shared business tenant. Routes that read or mutate accounting data, store the eBay refresh token, mark orders shipped, or trigger privileged marketplace operations must enforce an owner/admin or explicit allowlist boundary rather than relying on authentication alone. Reflected XSS on authenticated routes is also high risk because it converts a lower-privileged web interaction into full same-origin access against the protected API.