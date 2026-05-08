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

/** Fetch a single order's detail from Manapool. Returns null on error. */
async function fetchOrderDetail(
  orderId: string,
  email: string,
  token: string,
): Promise<Record<string, unknown> | null> {
  try {
    const resp = await fetch(`${MANAPOOL_BASE}/seller/orders/${orderId}`, {
      headers: manapoolHeaders(email, token),
    });
    if (!resp.ok) return null;
    const body = (await resp.json()) as Record<string, unknown>;
    // Detail is wrapped in { order: { ... } }
    return (body.order as Record<string, unknown> | undefined) ?? body;
  } catch {
    return null;
  }
}

router.get("/orders", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(manapoolOrdersTable)
    .orderBy(desc(manapoolOrdersTable.date));
  res.json(rows);
});

const CredBody = z.object({
  email: z.string().email(),
  token: z.string().min(1),
});

/** Debug: returns raw list + detail structure for one order */
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
  const detail = orderId ? await fetchOrderDetail(orderId, email, token) : null;

  req.log.info({ listOrderKeys: Object.keys(firstOrder), listOrder: firstOrder, detailKeys: detail ? Object.keys(detail) : [], detail }, "Manapool inspect result");

  res.json({ listOrder: firstOrder, detail });
});

router.post("/manapool/sync", async (req, res): Promise<void> => {
  const parsed = CredBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { email, token } = parsed.data;
  const headers = manapoolHeaders(email, token);

  // 1. Fetch full order list
  let pageOrders: Record<string, unknown>[] = [];
  let offset = 0;
  const limit = 100;
  const allOrders: Record<string, unknown>[] = [];

  try {
    while (true) {
      const resp = await fetch(
        `${MANAPOOL_BASE}/seller/orders?limit=${limit}&offset=${offset}`,
        { headers },
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
    logger.error({ err }, "Manapool list fetch failed");
    res.status(502).json({ error: "Failed to reach Manapool API" });
    return;
  }

  // 2. Fetch order detail for each order to get fee + net data
  //    Log the first detail's keys so we can verify the field names.
  let loggedDetail = false;
  let upserted = 0;

  for (const o of allOrders) {
    const id = String(o.id ?? "");
    if (!id) continue;

    const gross = pickCents(o.total_cents);
    const date = o.created_at ? new Date(String(o.created_at)) : new Date();

    // Fetch detail to get fee and net fields
    const detail = await fetchOrderDetail(id, email, token);

    if (!loggedDetail && detail) {
      req.log.info(
        { detailKeys: Object.keys(detail), detail },
        "Manapool first order detail structure",
      );
      loggedDetail = true;
    }

    // Extract fee + net from detail — try every plausible field name
    const d = detail ?? {};
    const fees =
      pickCents(
        d.fee_cents ??
          d.commission_cents ??
          d.platform_fee_cents ??
          d.manapool_fee_cents ??
          (d.payment as Record<string, unknown> | undefined)?.fee_cents,
      ) ??
      pickDollars(
        d.fee ??
          d.commission ??
          d.platform_fee ??
          (d.payment as Record<string, unknown> | undefined)?.fee,
      );

    const net =
      pickCents(
        d.net_cents ??
          d.payout_cents ??
          d.seller_payout_cents ??
          d.net_payout_cents ??
          (d.payment as Record<string, unknown> | undefined)?.net_cents ??
          (d.payment as Record<string, unknown> | undefined)?.payout_cents,
      ) ??
      pickDollars(
        d.net ??
          d.payout ??
          d.seller_payout ??
          d.net_payout ??
          (d.payment as Record<string, unknown> | undefined)?.net ??
          (d.payment as Record<string, unknown> | undefined)?.payout,
      ) ??
      // Last resort: derive net from gross minus fees
      (gross !== null && fees !== null ? gross - fees : null);

    await db
      .insert(manapoolOrdersTable)
      .values({
        id,
        date,
        grossTotal: gross ?? 0,
        platformFees: fees ?? 0,
        netPayout: net ?? 0,
      })
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
  res.json({
    message: `Synced ${allOrders.length} orders (${upserted} updated).`,
    upserted,
    total: allOrders.length,
  });
});

/** Parse a value as cents → dollars. Returns null if value is falsy/zero. */
function pickCents(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  if (Number.isNaN(n) || n === 0) return null;
  return n / 100;
}

/** Parse a value as dollars directly. Returns null if value is falsy/zero. */
function pickDollars(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  if (Number.isNaN(n) || n === 0) return null;
  return n;
}

export default router;
