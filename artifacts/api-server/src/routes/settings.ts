import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, settingsTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// GET /api/settings/manapool — returns current manapool credentials (token masked)
router.get("/settings/manapool", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(settingsTable)
      .where(
        eq(settingsTable.key, "manapool_email"),
      );
    const tokenRows = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, "manapool_api_key"));

    const email = rows[0]?.value ?? "";
    const hasToken = !!tokenRows[0]?.value;

    res.json({ email, hasToken });
  } catch (err) {
    req.log.error(err, "settings/manapool GET error");
    res.status(500).json({ error: "Failed to load settings" });
  }
});

// PUT /api/settings/manapool — save manapool credentials to DB
router.put("/settings/manapool", async (req, res) => {
  const { email, token } = req.body as { email?: string; token?: string };

  if (typeof email !== "string" || typeof token !== "string") {
    res.status(400).json({ error: "email and token are required strings" });
    return;
  }

  try {
    await db
      .insert(settingsTable)
      .values({ key: "manapool_email", value: email })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { value: email, updatedAt: new Date() },
      });

    await db
      .insert(settingsTable)
      .values({ key: "manapool_api_key", value: token })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { value: token, updatedAt: new Date() },
      });

    logger.info("manapool credentials updated via settings UI");
    res.json({ ok: true });
  } catch (err) {
    req.log.error(err, "settings/manapool PUT error");
    res.status(500).json({ error: "Failed to save settings" });
  }
});

export default router;
