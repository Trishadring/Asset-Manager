# TCG Accounting & ManaPick

A full-stack cash-basis Profit & Loss tracker + order fulfillment system for Magic: The Gathering sellers listing on Manapool, eBay, and TCGPlayer.

## The Problem

MTG sellers list across multiple marketplaces that don't talk to each other:

- **Manapool** — MTG-specific marketplace with a REST API
- **eBay** — general auction site (OAuth API)
- **TCGPlayer** — large TCG marketplace (CSV exports only)

Each reports sales differently and at different times. Sellers have no single source of truth for what they earned, their net profit, or which orders to pack.

## How It Works

### Accounting (P&L Dashboard)

Pulls **revenue** from all three marketplaces and lets you manually enter **expenses** (card purchases, supplies) to produce a cash-basis P&L:

| Source | How It's Pulled |
|--------|----------------|
| **Manapool** | REST API — syncs order gross, shipping, fees, and net |
| **eBay** | OAuth-based order sync via Fulfillment API |
| **TCGPlayer** | CSV import (no seller API available) |
| **Purchases** | Manual expense entries |
| **Custom Sales** | Manual off-platform sales (Facebook, local store, etc.) |

The dashboard aggregates everything into a **weekly P&L chart** — revenue bars stacked by source vs. expense line, with net profit and order counts.

### Fulfillment (ManaPick)

When orders come in, the seller needs to find cards in inventory, pick the right ones per order, and ship. ManaPick:

1. Fetches **unfulfilled** Manapool orders via their API
2. **Consolidates** duplicate cards across orders using a `name|set|number|finish` composite key
3. **Enriches** card data via Scryfall (images, set names, color sorting)
4. Displays cards in a visual grid sorted by set release → color wheel → collector number
5. Provides **pick** (toggle per-order allocations) and **pack** (bin assignment, mark shipped) phases
6. Persists pick state server-side for cross-device sync

Also supports **TCGPlayer pull sheet CSV** import — parse a pull sheet, preview Manapool inventory deduction, and apply quantity changes.

### Key Business Logic

| Concept | How It Works |
|---------|-------------|
| Cash-basis accounting | Revenue recorded on order date (payment received), not when invoiced |
| Multi-source aggregation | Manapool + eBay + TCGPlayer + custom sales summed in one view |
| Fee extraction | Each platform's fees parsed separately for accurate net revenue |
| Card consolidation | Composite key collapses duplicates across orders into one line |
| Concurrent fulfillment | Bin numbers map orders to physical locations; cards picked per-order |
| Persistent state | Pick progress saved to DB — resume from any device |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Monorepo | pnpm workspaces |
| Backend | Express 5 + TypeScript |
| Database | PostgreSQL 16 + Drizzle ORM |
| Frontend | React 19, Vite 7, TailwindCSS 4, shadcn/ui |
| API Codegen | OpenAPI 3.1 → Orval → Zod + React Query hooks |
| Auth | Replit OIDC (session-based) |

## Project Structure

```
artifacts/
  api-server/     # Express 5 REST API
  accounting/     # React P&L dashboard
lib/
  db/             # Drizzle schema + DB client
  api-spec/       # OpenAPI spec + Orval codegen
  api-zod/        # Generated Zod schemas
  api-client-react/  # Generated React Query hooks
  replit-auth-web/   # Auth hook for React
scripts/          # Utility scripts
attached_assets/  # Screenshots, sample CSVs, design assets
```

## Getting Started

**Prerequisites:** Node.js 24, pnpm, PostgreSQL 16

```bash
pnpm install
pnpm run typecheck
pnpm run build
```

```bash
# Push DB schema
pnpm --filter @workspace/db run push

# Run API server
pnpm --filter @workspace/api-server run dev

# Run accounting frontend
pnpm --filter @workspace/accounting run dev
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `MANAPOOL_API_KEY` | Manapool API credentials |
| `MANAPOOL_EMAIL` | Manapool account email |
| `ISSUER_URL` | OIDC issuer (default: Replit) |
| `PORT` | API server port |
| `BASE_PATH` | Frontend base path |
| `EBAY_RUNAME` | eBay OAuth redirect URL name |
| `EBAY_DELETION_VERIFICATION_TOKEN` | eBay notification verification |

## License

MIT
