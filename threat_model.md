# Threat Model

## Project Overview

This repository contains a small MTG seller operations stack with two production-relevant surfaces: a TypeScript/Express accounting API and React dashboard under `artifacts/api-server` and `artifacts/accounting`, plus a Streamlit helper in `app.py` for fetching and processing Manapool orders. The backend talks directly to PostgreSQL via Drizzle and to third-party seller APIs (Manapool, eBay, Scryfall) using server-side secrets.

Assumptions for security review:
- Only production-reachable issues are in scope.
- `artifacts/mockup-sandbox/`, `scripts/`, `main.py`, and attached assets are dev-only unless production reachability is demonstrated.
- Replit-managed TLS is assumed in production.
- `NODE_ENV` is assumed to be `production` in production deployments.

## Assets

- **Business financial records** — purchases, custom sales, dashboard rollups, and weekly profit data stored in PostgreSQL. Unauthorized reads or writes would expose or corrupt accounting records.
- **Marketplace order data** — Manapool and eBay order summaries, payout amounts, shipping totals, and order identifiers. These data sets reveal revenue and business activity.
- **Marketplace credentials and refresh tokens** — `MANAPOOL_API_KEY`, `MANAPOOL_EMAIL`, eBay client credentials, refresh tokens, and verification tokens. These secrets allow the application to act on behalf of the seller account.
- **Operational integrity** — sync endpoints trigger upstream API calls and database writes. Abuse can create denial-of-service conditions, rate-limit exhaustion, or poisoned local records.

## Trust Boundaries

- **Browser / Streamlit client → Express API / Streamlit server** — all request parameters, cookies, headers, and form inputs are untrusted and must be authenticated/authorized before accessing business data or sync actions.
- **Express API / Streamlit server → PostgreSQL** — database access is trusted only after server-side validation and authorization. Injection and broken access control here expose all accounting data.
- **Application → External marketplaces** — the server calls Manapool and eBay with privileged secrets and refresh tokens. Any public endpoint that triggers these calls inherits that privilege.
- **OAuth provider / webhook sender → Application** — callback and webhook routes must prove request origin and bind responses to the intended authenticated actor or deployment state.
- **Production / Dev-only boundary** — mockup sandbox, local scripts, and preview tooling should normally be ignored unless the scan finds a path that exposes them in production.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/*`, `artifacts/accounting/src/App.tsx`, `app.py`
- **Highest-risk areas:** `artifacts/api-server/src/routes/orders.ts`, `artifacts/api-server/src/routes/ebay.ts`, `artifacts/api-server/src/routes/purchases.ts`, `artifacts/api-server/src/routes/sales.ts`, `artifacts/api-server/src/routes/dashboard.ts`, `artifacts/api-server/src/routes/ebay-notifications.ts`, `lib/db/src/schema/*`, `app.py`
- **Public vs authenticated vs admin surfaces:** no authenticated or admin boundary is currently implemented in the Express app; all mounted `/api` routes should be treated as public until proven otherwise.
- **Usually dev-only:** `artifacts/mockup-sandbox/`, `scripts/`, `main.py`, `attached_assets/`

## Threat Categories

### Spoofing

This project integrates with eBay OAuth and marketplace notification endpoints. Callback and webhook routes must verify that inbound requests are tied to the intended authenticated user or trusted provider. OAuth authorization requests must carry an unpredictable `state` value and callbacks must validate it before storing tokens. Notification endpoints must not trust caller-controlled host headers or accept unauthenticated state-changing requests.

### Tampering

Financial records and marketplace sync state are high-value integrity targets. All create, delete, and sync endpoints must require server-side authentication and authorization before they can modify purchases, custom sales, cached marketplace orders, or stored tokens. Client-only navigation or obscurity is not a security boundary.

### Information Disclosure

Dashboard totals, weekly rollups, synced order histories, raw marketplace responses, and stored credentials are business-sensitive. API routes must avoid exposing these records to unauthenticated callers and must not reflect upstream error bodies, secrets, or raw third-party payloads unnecessarily. Secrets must not be placed in URLs, source-controlled config, or client-visible storage.

### Denial of Service

Marketplace sync endpoints can trigger large volumes of upstream requests and database writes. Public callers must not be able to repeatedly invoke Manapool or eBay synchronization, inspect raw upstream responses, or otherwise consume expensive resources without authentication and abuse controls.

### Elevation of Privilege

The primary elevation risk is public access to endpoints that run with server-held marketplace credentials or database privileges. All API routes that read or mutate accounting data, store OAuth refresh tokens, or trigger privileged marketplace operations must enforce an authenticated boundary before executing.