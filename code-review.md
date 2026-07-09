# Code Review: Asset-Manager

> Generated: 2026-07-06
> Scope: Full-stack monorepo (React frontend, Express API, shared DB/Zod libs)

---

## Priority Legend

| Prio | Meaning |
|------|---------|
| **P1** | High — architecture, DX, or correctness issue affecting development velocity |
| **P2** | Medium — tech debt, type safety, or code health |
| **P3** | Low — nice-to-have cleanup, minor inconsistencies |

---

## P1 — High Priority

### AS-001: Split `manapick.tsx` into focused components

**File:** `artifacts/accounting/src/pages/manapick.tsx` (1536 lines)

**Problem:** This single file handles picking, packing/shipping, Scryfall enrichment, TCGPlayer pull-sheet import, eBay pick-orders, deduction preview/apply, cross-device pick sync, and localStorage caching. It's a monolith with 4+ distinct UI modes that share state but have independent logic.

**Suggested approach:** Extract into at least 4 files:
- `pages/manapick/OrdersProvider.tsx` — data-fetching context (orders, master, picks, enrichment status)
- `pages/manapick/PickView.tsx` — the card-grid pick phase (CardItem sub-component included)
- `pages/manapick/PackView.tsx` — order-bin packing, shipping, tracking
- `pages/manapick/TcgImport.tsx` — TCGPlayer CSV upload + deduction flow
- `pages/manapick/EbaySection.tsx` — eBay pick-orders listing

The parent `manapick.tsx` would become a thin orchestrator ~200 lines.

**Acceptance criteria:**
- No functional change to picking, packing, TCG import, eBay, or deduction
- Each extracted file is under 400 lines
- Shared state flows through props or a lightweight context (not a global store)

---

### AS-002: Consolidate duplicate fetch patterns into a shared hook - done

**Files:**
- `artifacts/accounting/src/hooks/use-finance.ts` (138 lines)
- `artifacts/accounting/src/hooks/use-orders.ts` (48 lines)
- `artifacts/accounting/src/hooks/use-ebay.ts` (47 lines)
- `artifacts/accounting/src/hooks/use-tcgplayer.ts` (117 lines)

**Problem:** Every hook file independently reimplements the same pattern:
```ts
const getBaseUrl = () => "";
const res = await fetch(`${getBaseUrl()}/api/...`);
if (!res.ok) throw new Error("...");
return res.json();
```
Some use `getBaseUrl()`, some hardcode `/api/...`. Three of four use `getBaseUrl = () => ""` (a no-op). Error handling varies. Some parse error bodies, some don't.

**Suggested approach:** Create a thin `useApi` utility:
```ts
// hooks/use-api.ts
function apiFetch<T>(path: string, opts?: RequestInit): Promise<T>
function useApiQuery<T>(key: string[], path: string): UseQueryResult<T>
function useApiMutation<T, B = void>(path: string, method: string, invalidateKeys: string[][]): UseMutationResult<T, Error, B>
```
Each existing hook file shrinks to ~5 lines of route-specific configuration.

**Acceptance criteria:**
- All 4 hook files use the shared utility
- Invalidation patterns are consistent (no missing `invalidateQueries`)
- `getBaseUrl` no-ops eliminated
- No functional changes to any page

---

### AS-003: Extract shared Scryfall logic into a library module

**Files:**
- `artifacts/api-server/src/routes/manapick.ts` — fetches `/sets`, builds code→name map, calls `/cards/collection`
- `artifacts/api-server/src/routes/tcgplayer.ts` — fetches `/sets`, caches with TTL, resolves set names
- `artifacts/api-server/src/routes/ebay.ts` — fetches item images via Browse API (different endpoint, same pattern)

**Problem:** Three route files independently implement Scryfall HTTP calls with their own caching strategy, user-agent headers, and error handling. The `manapick` route fetches all sets every request (no cache); `tcgplayer` has a 1-hour in-memory cache. Set name→code resolution logic lives in `tcgplayer.ts` but is useful for `manapick.ts`.

**Suggested approach:**
```ts
// src/lib/scryfall.ts
export async function getScryfallSetCodes(): Promise<Map<string, string>>  // cached 1h
export async function resolveSetCode(setName: string): Promise<string>
export async function enrichCards(identifiers: Identifier[]): Promise<Map<string, ScryfallCard>>
```
Each route imports from the shared lib instead of calling fetch directly.

**Acceptance criteria:**
- `manapick.ts` uses the shared sets cache (instead of fetching per-request)
- `tcgplayer.ts` uses the shared `resolveSetCode`
- User-Agent header is defined once
- Caching is consistent (1-hour TTL, in-memory, reset on server restart)

---

### AS-004: Replace `Record<string, unknown>` casts with proper Zod schemas

**Files (representative):**
- `artifacts/api-server/src/routes/manapick.ts` — 25+ occurrences of `as Record<string, unknown>`
- `artifacts/api-server/src/routes/orders.ts` — `as Record<string, unknown>` throughout
- `artifacts/api-server/src/routes/ebay.ts` — `as` type assertions for API responses

**Problem:** The codebase uses TypeScript `as` type assertions extensively for external API responses (Manapool, eBay, Scryfall). This bypasses compile-time type checking and means malformed upstream data surfaces as cryptic runtime errors instead of structured validation failures. Many functions accept/return `Record<string, unknown>` which defeats IDE autocomplete and makes refactoring fragile.

**Suggested approach:** For each external API call, define a Zod schema for the response shape and use `.parse()` instead of `as`:
```ts
const ManapoolOrderSchema = z.object({
  id: z.string(),
  label: z.string(),
  items: z.array(ItemSchema),
  // ...
});
const order = ManapoolOrderSchema.parse(raw);
```
Start with the most-touched routes (manapick, orders) and proceed outward.

**Acceptance criteria:**
- No `as Record<string, unknown>` casts remain in route handlers
- External API responses are validated at the boundary
- Error messages include which field failed validation

---

## P2 — Medium Priority

### AS-005: Add Zod input validation to `manapick` routes

**File:** `artifacts/api-server/src/routes/manapick.ts`

**Problem:** Unlike `purchases.ts` and `sales.ts` (which use Zod for request body validation), the manapick routes use raw `as` type assertions on `req.body` and `req.query`. A malformed request produces confusing errors or silently does the wrong thing.

**Lines:**
- Line 280: `req.body as { identifiers: [...] }` — no shape validation
- Line 366: `req.body as { tracking_number?: string }`
- Line 393: `String(req.query["session"] ?? "").trim()` — no real validation
- Line 409: `req.body as { session?: string; pickKey?: string; picked?: boolean }` — manual null checks

**Suggested approach:** Add Zod schemas for each request body/query shape, using `.safeParse()` at the route boundary. Return 400 with the Zod error message on mismatch. This is consistent with the pattern already used in `purchases.ts:14` and `sales.ts:13`.

**Acceptance criteria:**
- All 4 manapick POST/PATCH endpoints validate their input with Zod
- Manapool credential errors are still caught separately
- Existing tests pass without modification

---

### AS-006: Consolidate `/api/weekly` into a single SQL query

**File:** `artifacts/api-server/src/routes/dashboard.ts` (lines 35–136)

**Problem:** The weekly stats endpoint runs 5 separate SQL queries (manapool_orders, purchases, custom_sales, ebay_orders, tcgplayer_orders) and merges them in JavaScript. This is 5 round-trips to PostgreSQL and ~60 lines of merge logic that could be a single SQL statement using `FULL OUTER JOIN` or `UNION ALL` with aggregation.

**Current approach:**
```ts
const revenueRows = await db.execute(sql`SELECT ... FROM manapool_orders ...`);
const spendingRows = await db.execute(sql`SELECT ... FROM purchases ...`);
const customSalesRows = await db.execute(sql`SELECT ... FROM custom_sales ...`);
const ebayRows = await db.execute(sql`SELECT ... FROM ebay_orders ...`);
const tcgRows = await db.execute(sql`SELECT ... FROM tcgplayer_orders ...`);
// merge in JS...
```

**Suggested approach:** Single query:
```sql
WITH weeks AS (
  SELECT to_char(week, 'YYYY-MM-DD') AS week FROM generate_series(...) week
)
SELECT w.week,
  COALESCE(SUM(mo.net_payout), 0) + ... AS revenue,
  COALESCE(SUM(p.amount), 0) AS spending,
  COALESCE(COUNT(mo.id), 0) + ... AS orders
FROM weeks w
LEFT JOIN manapool_orders mo ON date_trunc('week', mo.date) = w.week
...
GROUP BY w.week ORDER BY w.week
```

**Acceptance criteria:**
- Same response shape
- At least as fast (ideally faster due to fewer round-trips)
- No JS merge logic

---

### AS-007: Move eBay token management to a shared lib module

**File:** `artifacts/api-server/src/routes/ebay.ts`

**Problem:** `ebay.ts` contains three token-handling sections:
- `getAccessToken()` — user access token (line 39)
- `getAppToken()` — application token for Browse API (line ~470)
- `cachedToken` / `cachedAppToken` — two independent in-memory caches

Plus `getStoredRefreshToken()` / `saveRefreshToken()` which talk to the DB. All of this is inline in the route file, making it hard to reuse or unit-test.

**Suggested approach:** Extract to `src/lib/ebay-auth.ts`:
```ts
export async function getEbayAccessToken(): Promise<string>
export async function getEbayAppToken(): Promise<string | null>
export async function getEbayAuthUrl(): Promise<string>
export async function handleEbayCallback(code: string): Promise<void>
```
The route file becomes a thin HTTP wrapper around the lib. The cached tokens live in the module scope of the lib file.

**Acceptance criteria:**
- eBay route file shrinks by ~100 lines
- Token logic is testable without Express
- No functional change

---

### AS-008: Trim banner shim in `build.mjs` - done

**File:** `artifacts/api-server/build.mjs`

**Problem:** The esbuild banner injected polyfills for `require`, `__filename`, and `__dirname` into the ESM output. `__filename`/`__dirname` were unused by any dependency; `require` was assumed unnecessary with Express 5.

**Result:** Removed `__filename`/`__dirname` polyfills (zero consumers). Kept `globalThis.require` polyfill because Express 5 internally calls `require("node:events")` even when bundled as ESM. Banner reduced from 6 lines to 1 inline import.

**Acceptance criteria:**
- `__filename`/`__dirname` polyfills removed
- Server starts and responds to requests
- No runtime `require is not defined` errors

---

### AS-009: Add fine-grained server-side authorization

**File:** `artifacts/api-server/src/routes/index.ts` (auth gate, lines 18–25)

**Problem:** The auth middleware checks `req.isAuthenticated()` for all routes except auth, health, and eBay notifications. There is no owner/admin concept — any authenticated Replit user has full access to all data. The threat model (`threat_model.md`) explicitly flags this:

> *The current application treats any authenticated identity as a full operator for one shared business tenant.*

**Suggested approach:** Add an `OWNER_USER_IDS` env var (comma-separated Replit user IDs). The auth gate in `routes/index.ts` checks membership:
```ts
const OWNERS = (process.env.OWNER_USER_IDS ?? "").split(",").filter(Boolean);
router.use((req, res, next) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (OWNERS.length > 0 && !OWNERS.includes(req.user!.id)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  next();
});
```
Non-owner access is denied at the route level rather than relying on UI hiding.

**Acceptance criteria:**
- New env var `OWNER_USER_IDS` supported
- Authenticated non-owners receive 403 on all protected routes
- No change when the env var is unset (backward compatible, all authenticated users pass)

---

## P3 — Low Priority / Nice-to-Have

### AS-010: Remove stale `AuthUser` re-export from `replit-auth-web`

**File:** `lib/replit-auth-web/src/index.ts`

**Problem:** The package re-exports `AuthUser` from its own `use-auth.ts`, which in turn imports it from `@workspace/api-zod`. The canonical source is `@workspace/api-zod`, and `artifacts/accounting` already imports directly from there in some places. The re-export creates two paths to the same type.

**Suggested approach:** Remove the re-export from `replit-auth-web/src/index.ts` and update any import that references `@workspace/replit-auth-web` for the type. Only `useAuth` should be exported from this package.

---

### AS-011: Unexport `reducer` in `use-toast.ts`

**File:** `artifacts/accounting/src/hooks/use-toast.ts`, line 74

**Problem:** `export const reducer = ...` is exported but only used internally by `useToast()`. No other file imports it. This is a copy-paste from the shadcn/ui template.

**Suggested approach:** Change `export const reducer` to `const reducer` (or `function reducer`).

---

### AS-012: Remove stale comments and template noise -done

**Files:**
- `artifacts/api-server/.replit-artifact/artifact.toml` (line 2) — `# TODO - should be excluded from preview`
- `artifacts/accounting/src/hooks/use-toast.ts` (lines 93–94) — shadcn template comment

**Problem:** These comments no longer convey useful information. The `TODO` in the artifact config has been unresolved long enough that it either needs actioning or deleting.

---

### AS-013: Align hooks' base URL handling-done

**Files:**
- `use-finance.ts` — `getBaseUrl = () => ""` (lines 4, 10, 20, 35, etc.)
- `use-orders.ts` — no `getBaseUrl`, hardcodes `/api/...`
- `use-ebay.ts` — no `getBaseUrl`, hardcodes `/api/...`
- `use-tcgplayer.ts` — no `getBaseUrl`, hardcodes `/api/...`

**Problem:** `use-finance.ts` has a `getBaseUrl` function returning `""`, used inconsistently (some calls use it, some hardcode `/api/...`). The other hooks don't have it at all. This is dead abstraction — if the base URL is always `""`, the indirection adds no value.

**Suggested approach:** If the abstraction is ever needed (e.g., API proxy target changes), define it once in a shared module. Otherwise remove `getBaseUrl` and use plain `/api/...` paths for consistency.

---

### AS-014: Address stale references in `threat_model.md`- done

**File:** `threat_model.md`

**Problem:** Updated in a previous session to remove `main.py` and `mockup-sandbox/` references, but line 10 still mentions `app.py` as "not part of the currently reachable public deployment" pending verification. The artifact config still references a Streamlit service for `app.py`. Either deploy it or remove the dead references.

---

## Summary Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Longest file | 1536 lines (manapick.tsx) | <400 lines per component |
| Hook files with duplicated fetch pattern | 4 files | 1 shared utility |
| Scryfall fetch implementations | 3 independent ones | 1 shared lib module |
| `as Record<string, unknown>` casts | 30+ | 0 (replaced with Zod) |
| SQL round-trips for `/api/weekly` | 5 + JS merge | 1 query |
| Test files | 0 | ≥1 per critical module |
| Pre-commit hooks | 0 | 1 (typecheck + test) |
