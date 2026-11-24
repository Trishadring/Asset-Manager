# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Validation**: Zod
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## ManaPick

- `artifacts/accounting` — React pick-and-pack app.
- `artifacts/api-server` — Express API for Manapool OAuth, orders, enrichment, and shipping.
- Run via the `Start application` workflow (API on port 8080, frontend on port 5173).

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
