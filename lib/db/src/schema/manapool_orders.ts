import { pgTable, text, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const manapoolOrdersTable = pgTable("manapool_orders", {
  id: text("id").primaryKey(),
  date: timestamp("date", { withTimezone: true }).notNull(),
  grossTotal: real("gross_total").notNull(),
  platformFees: real("platform_fees").notNull(),
  netPayout: real("net_payout").notNull(),
});

export const insertManapoolOrderSchema = createInsertSchema(manapoolOrdersTable);
export type InsertManapoolOrder = z.infer<typeof insertManapoolOrderSchema>;
export type ManapoolOrder = typeof manapoolOrdersTable.$inferSelect;
