import { pgTable, text, real, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const tcgplayerOrdersTable = pgTable("tcgplayer_orders", {
  id: text("id").primaryKey(),
  date: timestamp("date", { withTimezone: true }).notNull(),
  buyerName: text("buyer_name"),
  status: text("status"),
  productAmt: real("product_amt").notNull().default(0),
  shippingAmt: real("shipping_amt").notNull().default(0),
  totalAmt: real("total_amt").notNull().default(0),
  platformFees: real("platform_fees").notNull().default(0),
  netPayout: real("net_payout").notNull().default(0),
  itemCount: integer("item_count").notNull().default(1),
});

export const insertTcgplayerOrderSchema = createInsertSchema(tcgplayerOrdersTable);
export type InsertTcgplayerOrder = z.infer<typeof insertTcgplayerOrderSchema>;
export type TcgplayerOrder = typeof tcgplayerOrdersTable.$inferSelect;
