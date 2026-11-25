# Workflow

After finishing each story:
1. Run typecheck (`pnpm run typecheck`)
2. Create/modify tests if needed
3. Build the API server (`pnpm --filter ./artifacts/api-server run build`)
4. Start API server (`artifacts/api-server/`), verify it responds on :8080
5. Start Accounting app (`artifacts/accounting/`), verify key features load
6. `git add` the relevant files
7. `git commit` with the story number and a concise description

> **Node.js version:** Both apps require Node >= 20.19. Use `nvm` to switch if needed:
> ```
> source ~/.nvm/nvm.sh && nvm use 22.22.2
> ```

# Starting the Apps

## API Server (port 8080)
Does not use a database. After building:
```bash
# From artifacts/api-server/
node --enable-source-maps dist/index.mjs
```
`PORT` is required. `COOKIE_ENCRYPTION_KEY` is required for the Manapool connection cookie.

## Accounting App (port 5173)
Requires `PORT` and `BASE_PATH` env vars:
```bash
# From artifacts/accounting/
PORT=5173 BASE_PATH=/ npx vite --config vite.config.ts --host 0.0.0.0
```
Proxies `/api/*` to `localhost:8080` by default (override with `API_PROXY_TARGET`).

# Key Features to Verify After Changes

## API Server (:8080)
- Server starts: `node --enable-source-maps dist/index.mjs` responds
- Health check: `GET /api/healthz` returns 200
- CORS: Requests from Accounting origin (localhost:5173) are allowed
- Routes load: Manapool OAuth, orders, sets, enrich, and ship

## Accounting App (:5173)
- ManaPick (root `/`): page renders, can fetch/pick/pack orders

## Shared Infrastructure
- `@workspace/api-zod` types compile correctly
- `pnpm-workspace.yaml` catalog pins are consistent
