import { pgTable, text, real, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ebayOrdersTable = pgTable("ebay_orders", {
  id: text("id").primaryKey(),
  date: timestamp("date", { withTimezone: true }).notNull(),
  grossTotal: real("gross_total").notNull(),
  shippingTotal: real("shipping_total").notNull().default(0),
  platformFees: real("platform_fees").notNull().default(0),
  netPayout: real("net_payout").notNull(),
  itemCount: integer("item_count").notNull().default(1),
});

export const insertEbayOrderSchema = createInsertSchema(ebayOrdersTable);
export type InsertEbayOrder = z.infer<typeof insertEbayOrderSchema>;
export type EbayOrder = typeof ebayOrdersTable.$inferSelect;
