# ManaPick

A pick-and-pack tool for Magic: The Gathering sellers who fulfill orders on Manapool. ManaPick loads your paid, unshipped Manapool orders, consolidates the cards across them, and guides you through picking cards from inventory, packing each order into its bin, and marking it shipped.

## How It Works

1. **Connect Manapool.** Authorize ManaPick with your Manapool seller account (`orders:read` and `orders:write` scopes). The connection is stored in an encrypted, httpOnly browser cookie (AES-256-GCM, keyed by `COOKIE_ENCRYPTION_KEY`), so no database is needed. It lasts until the access token expires (at most 60 minutes) or you disconnect. No Replit sign-in is required.
2. **Fetch orders.** ManaPick pulls your unfulfilled Manapool orders and their line items. Duplicate cards across orders are merged into one entry, keyed by name, set, collector number, and finish (nonfoil, foil, or etched). Each order is assigned a bin number.
3. **Enrich cards.** Card images, colors, and type lines are looked up from Scryfall in batches of 75, so cards display with art and sort correctly.
4. **Pick.** Cards are grouped by set (oldest release first), then sorted by color (white, blue, black, red, green, multicolor, colorless, lands), then by collector number. Tokens and basic lands appear in their own groups at the end. Each card shows one button per bin it belongs to. Tapping a button marks that allocation as picked, and a card fades once every bin needing it is checked.
5. **Pack & ship.** Each unshipped order lists its bin, shipping address, shipping method, and the cards that belong in it. Enter an optional tracking number and click **Mark Shipped** to update the order on Manapool (carrier is set to USPS). When every order is shipped, the page confirms that packing is complete.

Pick progress is saved in the browser's local storage, keyed to the current set of orders, so a page refresh keeps your checks. **Clear All** removes the saved progress and the loaded orders.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Monorepo | pnpm workspaces |
| Frontend | React 19, Vite 7, TailwindCSS 4, shadcn/ui, wouter |
| Backend | Express 5 + TypeScript |
| API codegen | OpenAPI 3.1 → Orval → Zod schemas |
| External services | Manapool API (orders, fulfillment), Scryfall (card data and set info) |

## Project Structure

```
artifacts/
  api-server/   # Express API: Manapool OAuth, order fetch, enrichment, shipping
  accounting/   # React frontend for ManaPick (served at /)
lib/
  api-spec/     # OpenAPI spec and Orval codegen config
  api-zod/      # Generated Zod schemas
```

### Frontend (`artifacts/accounting`)

- `src/pages/manapick.tsx`: connection gate and main ManaPick page
- `src/pages/manapick/OrdersProvider.tsx`: order loading, enrichment, pick and ship state
- `src/pages/manapick/PickView.tsx`, `CardItem.tsx`: pick phase
- `src/pages/manapick/PackView.tsx`: pack and ship phase
- `src/components/manapool-key-panel.tsx`: Manapool connection panel in the sidebar

### API (`artifacts/api-server`)

| Route | Purpose |
|-------|---------|
| `GET /api/manapick/oauth/start`, `/callback`, `/status`; `POST /api/manapick/oauth/disconnect` | Manapool OAuth connection |
| `GET /api/manapick/orders` | Fetch unfulfilled orders and build the consolidated card list |
| `GET /api/manapick/sets` | Scryfall set info |
| `POST /api/manapick/enrich` | Batch Scryfall card lookup |
| `POST /api/manapick/orders/:id/ship` | Mark an order shipped on Manapool |
| `GET /api/healthz` | Health check |

## Getting Started

**Prerequisites:** Node.js 20.19 or newer, pnpm

```bash
pnpm install
pnpm run typecheck
pnpm run build
```

Generate a cookie encryption key (at least 32 characters) and set it as `COOKIE_ENCRYPTION_KEY`:

```bash
openssl rand -base64 32
```

Run the API server:

```bash
pnpm --filter @workspace/api-server run dev
```

Run the frontend:

```bash
pnpm --filter @workspace/accounting run dev
```

## Environment Variables

| Variable | Used by | Description |
|----------|---------|-------------|
| `COOKIE_ENCRYPTION_KEY` | API server | Secret (at least 32 characters) used to encrypt the Manapool connection cookie. Rotating it disconnects every user. |
| `MANAPOOL_CLIENT_ID` | API server | Manapool OAuth client ID |
| `MANAPOOL_CLIENT_SECRET` | API server | Manapool OAuth client secret |
| `MANAPOOL_REDIRECT_URI` | API server | HTTPS OAuth callback URL, `https://<host>/api/manapick/oauth/callback` |
| `PORT` | API server, frontend | Port to listen on |
| `BASE_PATH` | Frontend | Base path the app is served from |
| `API_PROXY_TARGET` | Frontend (dev) | API server URL for `/api` proxying (default `http://localhost:8080`) |
| `LOG_LEVEL` | API server | Log level (default `info`) |

## Local Development Ports

- API server: `http://localhost:8080`
- Frontend: `http://localhost:5173`, which proxies `/api/*` to the API server
