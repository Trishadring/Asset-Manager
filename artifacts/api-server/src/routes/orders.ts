import { Router, type IRouter } from "express";
import { desc, sql } from "drizzle-orm";
import { db, manapoolOrdersTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const MANAPOOL_BASE = "https://manapool.com/api/v1";

function getCredentials(): { email: string; token: string } {
  const email = process.env["MANAPOOL_EMAIL"] ?? "";
  const token = process.env["MANAPOOL_API_KEY"] ?? "";
  if (!email || !token) {
    throw new Error("MANAPOOL_EMAIL or MANAPOOL_API_KEY not configured as secrets.");
  }
  return { email, token };
}

function manapoolHeaders(email: string, token: string) {
  return {
    Accept: "application/json",
    "X-ManaPool-Email": email,
    "X-ManaPool-Access-Token": token,
  };
}

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

router.post("/manapool/inspect", async (req, res): Promise<void> => {
  let email: string, token: string;
  try {
    ({ email, token } = getCredentials());
  } catch (err) {
    res.status(500).json({ error: String(err) });
    return;
  }

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
  let email: string, token: string;
  try {
    ({ email, token } = getCredentials());
  } catch (err) {
    res.status(500).json({ error: String(err) });
    return;
  }

  const headers = manapoolHeaders(email, token);

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

  let loggedDetail = false;
  let upserted = 0;

  for (const o of allOrders) {
    const id = String(o.id ?? "");
    if (!id) continue;

    const gross = centsToAmount(o.total_cents);
    const date = o.created_at ? new Date(String(o.created_at)) : new Date();

    const detail = await fetchOrderDetail(id, email, token);

    if (!loggedDetail && detail) {
      req.log.info(
        { detailKeys: Object.keys(detail), detail },
        "Manapool first order detail structure",
      );
      loggedDetail = true;
    }

    const payment = detail
      ? (detail.payment as Record<string, unknown> | undefined)
      : undefined;
    const shipping = payment ? centsToAmount(payment.shipping_cents) : null;
    const fees = payment ? centsToAmount(payment.fee_cents) : null;
    const net = payment ? centsToAmount(payment.net_cents) : null;

    await db
      .insert(manapoolOrdersTable)
      .values({
        id,
        date,
        grossTotal: gross,
        shippingTotal: shipping ?? 0,
        platformFees: fees ?? 0,
        netPayout: net ?? 0,
      })
      .onConflictDoUpdate({
        target: manapoolOrdersTable.id,
        set: {
          date,
          grossTotal: gross,
          shippingTotal: shipping !== null ? shipping : sql`${manapoolOrdersTable.shippingTotal}`,
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

function centsToAmount(v: unknown): number {
  if (v === undefined || v === null) return 0;
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  return n / 100;
}

export default router;
