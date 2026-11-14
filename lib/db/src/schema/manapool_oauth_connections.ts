import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const manapoolOAuthConnectionsTable = pgTable(
  "manapool_oauth_connections",
  {
    sessionId: text("session_id").primaryKey(),
    oauthState: text("oauth_state"),
    codeVerifier: text("code_verifier"),
    redirectUri: text("redirect_uri"),
    stateExpiresAt: timestamp("state_expires_at", { withTimezone: true }),
    accessToken: text("access_token"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    scopes: text("scopes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);

export const insertManapoolOAuthConnectionSchema = createInsertSchema(
  manapoolOAuthConnectionsTable,
).omit({ createdAt: true, updatedAt: true });

export type InsertManapoolOAuthConnection = z.infer<
  typeof insertManapoolOAuthConnectionSchema
>;
export type ManapoolOAuthConnection =
  typeof manapoolOAuthConnectionsTable.$inferSelect;
