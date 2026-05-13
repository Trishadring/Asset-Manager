import { Router, type IRouter } from "express";
import { sum, sql } from "drizzle-orm";
import { db, purchasesTable, manapoolOrdersTable, customSalesTable, ebayOrdersTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/dashboard", async (_req, res): Promise<void> => {
  const [expRow] = await db
    .select({ total: sum(purchasesTable.amount) })
    .from(purchasesTable);
  const [revRow] = await db
    .select({ total: sum(manapoolOrdersTable.netPayout) })
    .from(manapoolOrdersTable);
  const [customRevRow] = await db
    .select({ total: sum(customSalesTable.amount) })
    .from(customSalesTable);
  const [ebayRevRow] = await db
    .select({ total: sum(ebayOrdersTable.netPayout) })
    .from(ebayOrdersTable);

  const totalExpenses = Number(expRow?.total ?? 0);
  const totalRevenue =
    Number(revRow?.total ?? 0) +
    Number(customRevRow?.total ?? 0) +
    Number(ebayRevRow?.total ?? 0);
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

  const customSalesRows = await db.execute(sql`
    SELECT
      to_char(date_trunc('week', date AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS week,
      ROUND(SUM(amount)::numeric, 2) AS revenue,
      COUNT(*)::int AS orders
    FROM custom_sales
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
  for (const row of customSalesRows.rows) {
    const week = String(row.week);
    const existing = map.get(week) ?? { week, revenue: 0, spending: 0, orders: 0, profit: 0 };
    existing.revenue += Number(row.revenue ?? 0);
    existing.orders += Number(row.orders ?? 0);
    map.set(week, existing);
  }

  const ebayRows = await db.execute(sql`
    SELECT
      to_char(date_trunc('week', date AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS week,
      ROUND(SUM(net_payout)::numeric, 2) AS revenue,
      COUNT(*)::int AS orders
    FROM ebay_orders
    WHERE date >= NOW() - INTERVAL '16 weeks'
    GROUP BY 1
    ORDER BY 1
  `);
  for (const row of ebayRows.rows) {
    const week = String(row.week);
    const existing = map.get(week) ?? { week, revenue: 0, spending: 0, orders: 0, profit: 0 };
    existing.revenue += Number(row.revenue ?? 0);
    existing.orders += Number(row.orders ?? 0);
    map.set(week, existing);
  }

  const weeks = Array.from(map.values())
    .sort((a, b) => a.week.localeCompare(b.week))
    .map((w) => ({ ...w, profit: w.revenue - w.spending }));

  res.json(weeks);
});

export default router;
