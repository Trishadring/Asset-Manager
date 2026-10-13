import { Router, type IRouter, type Request } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { manapickPicksTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { getScryfallSets } from "../lib/scryfall-sets";

const router: IRouter = Router();

const MANAPOOL_BASE = "https://manapool.com/api/v1";
const SCRYFALL_BASE = "https://api.scryfall.com";

const FINISH_LABELS: Record<string, string> = {
  NF: "nonfoil",
  FO: "foil",
  EF: "etched",
};

function getCredentials(req: Request): { email: string; token: string } {
  const email = req.get("X-ManaPool-Email")?.trim() ?? "";
  const token = req.get("X-ManaPool-Access-Token")?.trim() ?? "";
  if (!email || !token) throw new Error("Manapool email and API key are required.");
  return { email, token };
}

function mpHeaders(email: string, token: string) {
  return {
    Accept: "application/json",
    "X-ManaPool-Email": email,
    "X-ManaPool-Access-Token": token,
  };
}

// GET /api/manapick/orders
// Fetch paid/unshipped orders from Manapool and consolidate by card
router.get("/manapick/orders", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");

  let email: string, token: string;
  try {
    ({ email, token } = getCredentials(req));
  } catch {
    res.status(401).json({ error: "Enter your Manapool email and API key to continue." });
    return;
  }

  try {
    const summaries: Array<Record<string, unknown>> = [];
    let limit = 100, offset = 0;
    while (true) {
      const resp = await fetch(
        `${MANAPOOL_BASE}/seller/orders?is_fulfilled=false&limit=${limit}&offset=${offset}`,
        { headers: mpHeaders(email, token) },
      );
      if (resp.status === 401) {
        res.status(401).json({ error: "Manapool rejected those credentials. Check the email and API key." });
        return;
      }
      if (!resp.ok) {
        req.log.warn({ status: resp.status }, "Manapool order request failed");
        res.status(502).json({ error: "Manapool could not load orders. Try again shortly." });
        return;
      }
      const body = (await resp.json()) as { orders?: Array<Record<string, unknown>> };
      const page = body.orders ?? [];
      summaries.push(...page);
      if (page.length < limit || offset > 5000) break;
      offset += limit;
    }

    const ids = summaries.map((s) => String(s["id"] ?? "")).filter(Boolean);
    const orders: Array<Record<string, unknown>> = [];
    const CONCURRENCY = 5;
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const batch = ids.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((oid) =>
          fetch(`${MANAPOOL_BASE}/seller/orders/${oid}`, {
            headers: mpHeaders(email, token),
          }).then(async (r) => {
            if (!r.ok) return null;
            const body = (await r.json()) as Record<string, unknown>;
            return (body["order"] as Record<string, unknown>) ?? body;
          }),
        ),
      );
      for (const result of results) {
        if (result.status === "fulfilled" && result.value) orders.push(result.value);
      }
    }

    const master: Record<string, {
      name: string;
      set: string;
      collector_number: string;
      finish: string;
      quantity: number;
      scryfall_id?: string;
      allocations: Record<string, number>;
    }> = {};

    for (const order of orders) {
      const oid = String(order["id"] ?? "");
      for (const item of ((order["items"] as Array<Record<string, unknown>>) ?? [])) {
        const product = (item["product"] as Record<string, unknown>) ?? {};
        const single = (product["single"] as Record<string, unknown>) ?? {};
        if (!single["name"]) continue;
        const name = String(single["name"]).trim();
        const set = String(single["set"] ?? "").trim().toLowerCase();
        const collector_number = String(single["number"] ?? "").trim();
        const finish = FINISH_LABELS[String(single["finish_id"] ?? "")] ?? "nonfoil";
        const scryfall_id = single["scryfall_id"] as string | undefined;
        const qty = parseInt(String(item["quantity"] ?? "1"), 10) || 1;
        if (!name) continue;
        const key = `${name}|${set}|${collector_number}|${finish}`;
        if (!master[key]) {
          master[key] = { name, set, collector_number, finish, quantity: 0, scryfall_id, allocations: {} };
        }
        master[key].quantity += qty;
        master[key].allocations[oid] = (master[key].allocations[oid] ?? 0) + qty;
      }
    }

    // Fetch Scryfall sets (cached 1h), filter to codes in this batch of orders
    const neededCodes = new Set(Object.values(master).map((e) => e.set).filter(Boolean));
    const allSets = await getScryfallSets();
    const sets: Record<string, { name: string; released_at: string }> = {};
    for (const [code, info] of Object.entries(allSets)) {
      if (neededCodes.has(code)) sets[code] = info;
    }

    req.log.info({ orders: orders.length, uniqueCards: Object.keys(master).length, sets: Object.keys(sets).length }, "manapick orders fetched");
    const payload = { orders, master, sets };
    res.json(payload);
  } catch (err) {
    logger.error(err, "manapick/orders error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/manapick/sets
// Scryfall sets for sorting and display (cached 1h)
router.get("/manapick/sets", async (_req, res): Promise<void> => {
  const sets = await getScryfallSets();
  res.json({ sets });
});

// POST /api/manapick/enrich
// Batch Scryfall lookup using /cards/collection (up to 75 per call)
router.post("/manapick/enrich", async (req, res): Promise<void> => {
  const { identifiers } = req.body as {
    identifiers: Array<{ key: string; scryfall_id?: string; set?: string; collector_number?: string; name?: string }>;
  };
  if (!Array.isArray(identifiers) || identifiers.length === 0) {
    res.json({ results: {} }); return;
  }

  try {
    const results: Record<string, unknown> = {};
    for (let i = 0; i < identifiers.length; i += 75) {
      const batch = identifiers.slice(i, i + 75);
      // Build name-lookup index for this batch (items without scryfall_id or set)
      // Key: cleaned name (lowercase) → batch item; used for fallback matching
      const nameIndex = new Map<string, (typeof batch)[number]>();
      for (const c of batch) {
        if (!c.scryfall_id && !c.set && c.name) {
          nameIndex.set(c.name.toLowerCase(), c);
        }
      }

      const sfIds = batch.map((c) => {
        if (c.scryfall_id) return { id: c.scryfall_id };
        if (c.set && c.collector_number) return { set: c.set, collector_number: c.collector_number };
        return { name: c.name ?? "" };
      });

      const r = await fetch(`${SCRYFALL_BASE}/cards/collection`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "TCGAccounting/1.0" },
        body: JSON.stringify({ identifiers: sfIds }),
      });

      req.log.info(
        { status: r.status, batch: batch.length, batchOffset: i },
        "scryfall /cards/collection response",
      );

      if (r.ok) {
        const body = (await r.json()) as {
          data?: Array<Record<string, unknown>>;
          not_found?: Array<unknown>;
        };
        const found = body.data ?? [];
        const notFound = body.not_found ?? [];
        req.log.info({ found: found.length, notFound: notFound.length }, "scryfall results");

        for (const card of found) {
          // Try exact matches first (id, then set+collector_number)
          let matched = batch.find(
            (b) =>
              (b.scryfall_id && b.scryfall_id === card["id"]) ||
              (b.set && b.collector_number &&
                b.set === String(card["set"] ?? "").toLowerCase() &&
                b.collector_number === String(card["collector_number"] ?? "")),
          );
          // Fallback: match by card name for name-only lookups
          if (!matched) {
            const cardName = String(card["name"] ?? "").toLowerCase();
            matched = nameIndex.get(cardName);
            if (matched) nameIndex.delete(cardName); // consume so duplicates don't double-match
          }
          if (matched) results[matched.key] = card;
        }
      } else {
        const errText = await r.text().catch(() => "(no body)");
        req.log.warn({ status: r.status, body: errText }, "scryfall /cards/collection failed");
      }
    }
    req.log.info({ matched: Object.keys(results).length, total: identifiers.length }, "enrich complete");
    res.json({ results });
  } catch (err) {
    logger.error(err, "manapick/enrich error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/manapick/orders/:id/ship
router.post("/manapick/orders/:id/ship", async (req, res): Promise<void> => {
  let email: string, token: string;
  try {
    ({ email, token } = getCredentials(req));
  } catch {
    res.status(401).json({ error: "Enter your Manapool email and API key to continue." });
    return;
  }

  const orderId = req.params["id"]!;
  const { tracking_number = "" } = req.body as { tracking_number?: string };

  const body: Record<string, unknown> = { status: "shipped", tracking_company: "USPS" };
  if (tracking_number.trim()) {
    body["tracking_number"] = tracking_number.trim();
    body["tracking_url"] = `https://tools.usps.com/go/TrackConfirmAction?tLabels=${tracking_number.trim()}`;
  }

  try {
    const r = await fetch(`${MANAPOOL_BASE}/seller/orders/${orderId}/fulfillment`, {
      method: "PUT",
      headers: { ...mpHeaders(email, token), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      req.log.warn({ status: r.status, order: orderId }, "Manapool fulfillment update failed");
      res.status(r.status).json({ error: "Manapool fulfillment update failed" }); return;
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/manapick/picks?session=...
// Load persisted pick state for a session
router.get("/manapick/picks", async (req, res): Promise<void> => {
  const session = String(req.query["session"] ?? "").trim();
  if (!session) { res.json({ picks: {} }); return; }
  try {
    const rows = await db.select().from(manapickPicksTable).where(eq(manapickPicksTable.sessionId, session));
    const picks: Record<string, boolean> = {};
    for (const r of rows) picks[r.pickKey] = r.picked;
    res.json({ picks });
  } catch (err) {
    logger.error(err, "manapick/picks GET error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/manapick/picks
// Upsert a single pick (picked: true/false)
router.post("/manapick/picks", async (req, res): Promise<void> => {
  const { session, pickKey, picked } = req.body as { session?: string; pickKey?: string; picked?: boolean };
  if (!session || !pickKey || typeof picked !== "boolean") {
    res.status(400).json({ error: "session, pickKey, and picked are required" });
    return;
  }
  try {
    await db
      .insert(manapickPicksTable)
      .values({ sessionId: session, pickKey, picked })
      .onConflictDoUpdate({
        target: [manapickPicksTable.sessionId, manapickPicksTable.pickKey],
        set: { picked, updatedAt: new Date() },
      });
    res.json({ ok: true });
  } catch (err) {
    logger.error(err, "manapick/picks POST error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
