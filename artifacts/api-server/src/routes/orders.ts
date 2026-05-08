import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, manapoolOrdersTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/orders", async (_req, res): Promise<void> => {
  const rows = await db.select().from(manapoolOrdersTable).orderBy(desc(manapoolOrdersTable.date));
  res.json(rows);
});

const SyncBody = z.object({
  email: z.string().email(),
  token: z.string().min(1),
});

router.post("/manapool/sync", async (req, res): Promise<void> => {
  const parsed = SyncBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { email, token } = parsed.data;

  let pageOrders: Record<string, unknown>[] = [];
  let offset = 0;
  const limit = 100;
  const allOrders: Record<string, unknown>[] = [];

  try {
    while (true) {
      const resp = await fetch(
        `https://manapool.com/api/v1/seller/orders?is_fulfilled=true&limit=${limit}&offset=${offset}`,
        {
          headers: {
            Accept: "application/json",
            "X-ManaPool-Email": email,
            "X-ManaPool-Access-Token": token,
          },
        }
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

  let added = 0;
  for (const o of allOrders) {
    const id = String(o.id ?? "");
    if (!id) continue;
    const payment = (o.payment as Record<string, number> | undefined) ?? {};
    const gross = Number(payment.total_cents ?? 0) / 100;
    const fees = Number(payment.fee_cents ?? 0) / 100;
    const net = Number(payment.net_cents ?? 0) / 100;
    const date = o.created_at ? new Date(String(o.created_at)) : new Date();

    const existing = await db
      .select({ id: manapoolOrdersTable.id })
      .from(manapoolOrdersTable)
      .where(eq(manapoolOrdersTable.id, id));

    if (existing.length === 0) {
      await db.insert(manapoolOrdersTable).values({
        id,
        date,
        grossTotal: gross,
        platformFees: fees,
        netPayout: net,
      });
      added++;
    }
  }

  req.log.info({ added, total: allOrders.length }, "Manapool sync complete");
  res.json({ message: `Synced ${allOrders.length} orders, ${added} new.`, added, total: allOrders.length });
});

export default router;
