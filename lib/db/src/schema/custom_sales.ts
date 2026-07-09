import { pgTable, text, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const customSalesTable = pgTable("custom_sales", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  date: timestamp("date", { withTimezone: true }).notNull().defaultNow(),
  description: text("description").notNull(),
  amount: real("amount").notNull(),
  notes: text("notes"),
});

export const insertCustomSaleSchema = createInsertSchema(customSalesTable).omit({ id: true });
export type InsertCustomSale = z.infer<typeof insertCustomSaleSchema>;
export type CustomSale = typeof customSalesTable.$inferSelect;
