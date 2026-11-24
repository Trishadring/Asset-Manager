# Threat Model

## Project Overview

This repository deploys ManaPick: a TypeScript/Express API under `/api` and a React pick-and-pack app. The API does not use a database. A seller connects their own Manapool account with OAuth, and the access token is stored in an encrypted httpOnly cookie. Orders, card enrichment, and shipment updates are proxied to Manapool and Scryfall.

Assumptions for security review:
- Only production-reachable issues are in scope.
- The current public deployment exposes `/api` and the ManaPick frontend.
- Replit-managed TLS is assumed in production.
- `NODE_ENV` is assumed to be `production` in production deployments.

## Assets

- **Manapool seller access** — the encrypted `manapick_sid` cookie holds a short-lived Manapool access token (`orders:read` and `orders:write`). Theft of that cookie lets the holder read unshipped orders and mark them shipped until the token expires.
- **Order and shipment data** — unfulfilled Manapool orders include buyer addresses and line items. The ship route can change fulfillment state on the seller's Manapool account.
- **OAuth client secret and cookie key** — `MANAPOOL_CLIENT_SECRET` and `COOKIE_ENCRYPTION_KEY` let the server complete OAuth and decrypt connection cookies.

## Trust Boundaries

- **Browser → Express API** — request parameters, headers, cookies, and bodies are untrusted. ManaPick routes are reachable without a separate application login; possession of the Manapool session cookie is the seller boundary.
- **Application → Manapool and Scryfall** — the server calls these APIs with the seller's token or with no credential (Scryfall). Routes that trigger these calls can spend the seller's quota and mutate orders.
- **Manapool OAuth → Application** — the callback must only accept the state issued for that browser. Untrusted `code`, `state`, and error query values must not be reflected into HTML.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/index.ts`, `artifacts/accounting/src/App.tsx`
- **Highest-risk areas:** `artifacts/api-server/src/lib/manapool-oauth.ts`, `artifacts/api-server/src/routes/manapick.ts`, `artifacts/api-server/src/routes/manapick-oauth.ts`
- **Public surfaces:** `/api/healthz`, `/api/healthz/env` (reports only whether the OAuth credentials and cookie key are configured; never environment variable names or values), and the ManaPick OAuth, order, enrich, and ship routes. The ship and order routes require a valid Manapool session cookie.

## Threat Categories

### Spoofing

The OAuth `state` cookie must be bound to the browser that started the flow, and the token response must be verified before a session cookie is set. A stolen or forged `manapick_sid` cookie is the seller credential.

### Tampering

The ship route marks a Manapool order fulfilled. It must only run with the cookie's access token, and tracking input must be sent to Manapool as data rather than reflected into an HTML response.

### Information Disclosure

Order responses include buyer shipping details. Errors and logs must not include the access token, client secret, or cookie encryption key. The cookie value itself must stay httpOnly and encrypted.

### Denial of Service

Order fetch and Scryfall enrichment can fan out into many upstream requests. Those routes should keep their existing batch limits so one browser cannot unbounded-loop the seller's Manapool or Scryfall quota.

### Elevation of Privilege

There is no second application account. Anyone who can read the Manapool session cookie can act as that seller until the token expires (at most 60 minutes) or the seller disconnects. Disconnecting only clears the browser cookie; it does not revoke the access token at Manapool, so a copied cookie stays usable until the token expires. The cookie key and OAuth client secret must stay server-side.
