import { Router, type IRouter } from "express";
import { desc, sql } from "drizzle-orm";
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

    const gross = centsToAmount(o.total_cents);
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

    // Extract fee + net from detail.payment (per OpenAPI spec: payment.fee_cents, payment.net_cents)
    const payment = detail
      ? (detail.payment as Record<string, unknown> | undefined)
      : undefined;
    const fees = payment ? centsToAmount(payment.fee_cents) : null;
    const net = payment ? centsToAmount(payment.net_cents) : null;

    await db
      .insert(manapoolOrdersTable)
      .values({
        id,
        date,
        grossTotal: gross,
        platformFees: fees ?? 0,
        netPayout: net ?? 0,
      })
      .onConflictDoUpdate({
        target: manapoolOrdersTable.id,
        set: {
          date,
          grossTotal: gross,
          // Only overwrite fees/net if we got a valid detail response
          platformFees: fees !== null ? fees : sql`${manapoolOrdersTable.platformFees}`,
          netPayout: net !== null ? net : sql`${manapoolOrdersTable.netPayout}`,
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

/** Convert a cents value (integer) to a dollar amount. Returns 0 for missing/invalid. */
function centsToAmount(v: unknown): number {
  if (v === undefined || v === null) return 0;
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  return n / 100;
}


export default router;
