import { Router, type IRouter } from "express";
import { sum, sql } from "drizzle-orm";
import { db, purchasesTable, manapoolOrdersTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/dashboard", async (_req, res): Promise<void> => {
  const [expRow] = await db
    .select({ total: sum(purchasesTable.amount) })
    .from(purchasesTable);
  const [revRow] = await db
    .select({ total: sum(manapoolOrdersTable.netPayout) })
    .from(manapoolOrdersTable);

  const totalExpenses = Number(expRow?.total ?? 0);
  const totalRevenue = Number(revRow?.total ?? 0);
  const netProfit = totalRevenue - totalExpenses;

  res.json({ totalExpenses, totalRevenue, netProfit });
});

router.get("/weekly", async (_req, res): Promise<void> => {
  const revenueRows = await db.execute(sql`
    SELECT
      to_char(date_trunc('week', date AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS week,
      ROUND(SUM(net_payout)::numeric, 2) AS revenue,
      COUNT(*)::int AS orders
    FROM manapool_orders
    WHERE date >= NOW() - INTERVAL '16 weeks'
    GROUP BY 1
    ORDER BY 1
  `);

  const spendingRows = await db.execute(sql`
    SELECT
      to_char(date_trunc('week', date AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS week,
      ROUND(SUM(amount)::numeric, 2) AS spending
    FROM purchases
    WHERE date >= NOW() - INTERVAL '16 weeks'
    GROUP BY 1
    ORDER BY 1
  `);

  // Merge by week
  const map = new Map<string, { week: string; revenue: number; spending: number; orders: number; profit: number }>();

  for (const row of revenueRows.rows) {
    const week = String(row.week);
    map.set(week, {
      week,
      revenue: Number(row.revenue ?? 0),
      spending: 0,
      orders: Number(row.orders ?? 0),
      profit: 0,
    });
  }
  for (const row of spendingRows.rows) {
    const week = String(row.week);
    const existing = map.get(week) ?? { week, revenue: 0, spending: 0, orders: 0, profit: 0 };
    existing.spending = Number(row.spending ?? 0);
    map.set(week, existing);
  }

  const weeks = Array.from(map.values())
    .sort((a, b) => a.week.localeCompare(b.week))
    .map((w) => ({ ...w, profit: w.revenue - w.spending }));

  res.json(weeks);
});

export default router;
