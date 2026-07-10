import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, purchasesTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/purchases", async (req, res): Promise<void> => {
  const rows = await db.select().from(purchasesTable).orderBy(desc(purchasesTable.date));
  res.json(rows);
});

const CreatePurchaseBody = z.object({
  description: z.string().min(1),
  amount: z.number().positive(),
  date: z.string().optional(),
});

router.post("/purchases", async (req, res): Promise<void> => {
  const parsed = CreatePurchaseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { description, amount, date } = parsed.data;
  const [row] = await db
    .insert(purchasesTable)
    .values({ description, amount, date: date ? new Date(date) : new Date() })
    .returning();
  req.log.info({ id: row.id }, "Purchase created");
  res.status(201).json(row);
});

router.delete("/purchases/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [deleted] = await db
    .delete(purchasesTable)
    .where(eq(purchasesTable.id, id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Purchase not found" });
    return;
  }
  res.json({ success: true });
});

export default router;
