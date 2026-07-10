import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, customSalesTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/sales", async (_req, res): Promise<void> => {
  const rows = await db.select().from(customSalesTable).orderBy(desc(customSalesTable.date));
  res.json(rows);
});

const CreateSaleBody = z.object({
  description: z.string().min(1),
  amount: z.number().refine((n) => n !== 0, { message: "Amount must be non-zero" }),
  date: z.string().optional(),
  notes: z.string().optional(),
});

router.post("/sales", async (req, res): Promise<void> => {
  const parsed = CreateSaleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { description, amount, date, notes } = parsed.data;
  const [row] = await db
    .insert(customSalesTable)
    .values({ description, amount, date: date ? new Date(date) : new Date(), notes })
    .returning();
  req.log.info({ id: row.id }, "Custom sale created");
  res.status(201).json(row);
});

router.delete("/sales/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [deleted] = await db
    .delete(customSalesTable)
    .where(eq(customSalesTable.id, id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Sale not found" });
    return;
  }
  res.json({ success: true });
});

export default router;
