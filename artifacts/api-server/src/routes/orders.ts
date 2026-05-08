import { Router, type IRouter } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, manapoolOrdersTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const MANAPOOL_BASE = "https://manapool.com/api/v1";

function manapoolHeaders(email: string, token: string) {
  return {
    Accept: "application/json",
    "X-ManaPool-Email": email,
    "X-ManaPool-Access-Token": token,
  };
}

router.get("/orders", async (_req, res): Promise<void> => {
  const rows = await db.select().from(manapoolOrdersTable).orderBy(desc(manapoolOrdersTable.date));
  res.json(rows);
});

const CredBody = z.object({
  email: z.string().email(),
  token: z.string().min(1),
});

/**
 * Debug endpoint — returns the raw API response for the first order so we
 * can inspect the exact field names the Manapool API uses.
 */
router.post("/manapool/inspect", async (req, res): Promise<void> => {
  const parsed = CredBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { email, token } = parsed.data;
  const headers = manapoolHeaders(email, token);

  const listResp = await fetch(`${MANAPOOL_BASE}/seller/orders?limit=1&offset=0`, { headers });
  if (!listResp.ok) {
    res.status(listResp.status).json({ error: `Manapool list error: ${listResp.statusText}` });
    return;
  }
  const listBody = (await listResp.json()) as { orders?: unknown[] };
  const firstOrder = (listBody.orders ?? [])[0] as Record<string, unknown> | undefined;

  if (!firstOrder) {
    res.json({ message: "No orders found", listBody });
    return;
  }

  const orderId = String(firstOrder.id ?? "");
  let detailBody: unknown = null;
  if (orderId) {
    const detailResp = await fetch(`${MANAPOOL_BASE}/seller/orders/${orderId}`, { headers });
    if (detailResp.ok) detailBody = await detailResp.json();
  }

  res.json({ listOrder: firstOrder, detail: detailBody });
});

router.post("/manapool/sync", async (req, res): Promise<void> => {
  const parsed = CredBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { email, token } = parsed.data;
  const headers = manapoolHeaders(email, token);

  // Fetch ALL orders (no is_fulfilled filter) so today's unfulfilled orders appear too
  let pageOrders: Record<string, unknown>[] = [];
  let offset = 0;
  const limit = 100;
  const allOrders: Record<string, unknown>[] = [];

  try {
    while (true) {
      const resp = await fetch(
        `${MANAPOOL_BASE}/seller/orders?limit=${limit}&offset=${offset}`,
        { headers }
      );
      if (!resp.ok) {
        res.status(resp.status).json({ error: `Manapool API error: ${resp.statusText}` });
        return;
      }
      const body = (await resp.json()) as { orders?: Record<string, unknown>[] };
      pageOrders = body.orders ?? [];
      allOrders.push(...pageOrders);
      if (pageOrders.length < limit) break;
      offset += limit;
      if (offset > 5000) break;
    }
  } catch (err) {
    logger.error({ err }, "Manapool fetch failed");
    res.status(502).json({ error: "Failed to reach Manapool API" });
    return;
  }

  // Log the first order's top-level keys so we can see the real structure
  if (allOrders.length > 0) {
    req.log.info({ firstOrderKeys: Object.keys(allOrders[0]!), firstOrder: allOrders[0] }, "Manapool first order structure");
  }

  let upserted = 0;
  for (const o of allOrders) {
    const id = String(o.id ?? "");
    if (!id) continue;

    // Try to extract payment amounts from multiple possible field shapes
    // Shape A: top-level cents fields
    // Shape B: nested payment object with cents
    // Shape C: nested payment object with dollar amounts
    // Shape D: top-level dollar amounts
    const p = (o.payment as Record<string, unknown> | null | undefined) ?? {};

    const gross =
      pickCents(p.total_cents ?? o.total_cents ?? p.gross_cents ?? o.gross_cents) ??
      pickDollars(p.total ?? o.total ?? p.gross ?? o.gross_total ?? o.gross);

    const fees =
      pickCents(p.fee_cents ?? o.fee_cents ?? p.commission_cents ?? o.commission_cents) ??
      pickDollars(p.fee ?? o.fee ?? p.commission ?? o.platform_fees ?? o.commission);

    const net =
      pickCents(p.net_cents ?? o.net_cents ?? p.payout_cents ?? o.payout_cents ?? p.seller_payout_cents) ??
      pickDollars(p.net ?? o.net ?? p.payout ?? o.seller_payout ?? o.net_payout ?? p.amount);

    const date = o.created_at ? new Date(String(o.created_at)) : new Date();

    await db
      .insert(manapoolOrdersTable)
      .values({ id, date, grossTotal: gross ?? 0, platformFees: fees ?? 0, netPayout: net ?? 0 })
      .onConflictDoUpdate({
        target: manapoolOrdersTable.id,
        set: {
          date,
          grossTotal: gross ?? sql`excluded.gross_total`,
          platformFees: fees ?? sql`excluded.platform_fees`,
          netPayout: net ?? sql`excluded.net_payout`,
        },
      });
    upserted++;
  }

  req.log.info({ upserted, total: allOrders.length }, "Manapool sync complete");
  res.json({ message: `Synced ${allOrders.length} orders (${upserted} upserted).`, upserted, total: allOrders.length });
});

/** Parse a value as cents → dollars. Returns null if value is 0 or missing. */
function pickCents(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  if (Number.isNaN(n) || n === 0) return null;
  return n / 100;
}

/** Parse a value as dollars directly. Returns null if value is 0 or missing. */
function pickDollars(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  if (Number.isNaN(n) || n === 0) return null;
  return n;
}

export default router;
