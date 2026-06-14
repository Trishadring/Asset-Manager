import { pgTable, text, boolean, timestamp, primaryKey } from "drizzle-orm/pg-core";

export const manapickPicksTable = pgTable(
  "manapick_picks",
  {
    sessionId: text("session_id").notNull(),
    pickKey: text("pick_key").notNull(),
    picked: boolean("picked").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.pickKey] })],
);

export type ManapickPick = typeof manapickPicksTable.$inferSelect;
