import { Router, type IRouter } from "express";
import { sum } from "drizzle-orm";
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

export default router;
