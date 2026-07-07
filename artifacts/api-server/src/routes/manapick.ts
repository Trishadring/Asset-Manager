import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { manapickPicksTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const MANAPOOL_BASE = "https://manapool.com/api/v1";
const SCRYFALL_BASE = "https://api.scryfall.com";

const FINISH_LABELS: Record<string, string> = {
  NF: "nonfoil",
  FO: "foil",
  EF: "etched",
};

function getCredentials() {
  const email = process.env["MANAPOOL_EMAIL"] ?? "";
  const token = process.env["MANAPOOL_API_KEY"] ?? "";
  if (!email || !token) throw new Error("MANAPOOL_EMAIL or MANAPOOL_API_KEY not configured.");
  return { email, token };
}

const PLACEHOLDER_CARDS: Record<string, { number: string; scryfall_id: string }> = {
  "Sol Ring":         { number: "410", scryfall_id: "46ca0b66-a000-4483-b916-f5b89e710244" },
  "Arcane Signet":    { number: "367", scryfall_id: "0539b83c-4459-41b5-a001-d15a1c9ddf23" },
  "Command Tower":    { number: "420", scryfall_id: "14019383-0327-404b-ab4d-c65c3fa8c50d" },
  "Lightning Greaves": { number: "398", scryfall_id: "331013f6-976a-4dac-9939-1006e474e108" },
  "Swords to Plowshares": { number: "841", scryfall_id: "42ecba4b-9624-428f-a8af-dd88139ab13c" },
  "Path to Exile":    { number: "49",  scryfall_id: "4970389b-08f4-4a15-a128-954b072a8137" },
  "Counterspell":     { number: "81",  scryfall_id: "8493131c-0a7b-4be6-a8a2-0b425f4f67fb" },
};

function getPlaceholderOrders() {
  const card = (name: string) => {
    const c = PLACEHOLDER_CARDS[name]!;
    return { name, set: "cmm", number: c.number, finish_id: "NF", scryfall_id: c.scryfall_id };
  };

  const orders = [
    {
      id: "dev-order-001",
      label: "Alice Johnson",
      shipping_address: {
        name: "Alice Johnson",
        line1: "123 Magic Ln",
        city: "Seattle",
        state: "WA",
        postal_code: "98101",
        country: "US",
      },
      shipping_method: "USPS Ground",
      items: [
        { quantity: 3, product: { single: card("Sol Ring") } },
        { quantity: 2, product: { single: card("Arcane Signet") } },
        { quantity: 1, product: { single: card("Command Tower") } },
      ],
    },
    {
      id: "dev-order-002",
      label: "Bob Smith",
      shipping_address: {
        name: "Bob Smith",
        line1: "456 Card Ct",
        city: "Portland",
        state: "OR",
        postal_code: "97201",
        country: "US",
      },
      shipping_method: "USPS Priority",
      items: [
        { quantity: 1, product: { single: card("Sol Ring") } },
        { quantity: 2, product: { single: card("Lightning Greaves") } },
        { quantity: 1, product: { single: card("Swords to Plowshares") } },
      ],
    },
    {
      id: "dev-order-003",
      label: "Carol Davis",
      shipping_address: {
        name: "Carol Davis",
        line1: "789 TCG Ave",
        city: "Denver",
        state: "CO",
        postal_code: "80201",
        country: "US",
      },
      shipping_method: "USPS Ground",
      items: [
        { quantity: 4, product: { single: card("Path to Exile") } },
        { quantity: 2, product: { single: card("Counterspell") } },
      ],
    },
  ];

  const master: Record<string, unknown> = {};
  for (const order of orders) {
    const oid = String(order.id);
    for (const item of order.items) {
      const single = item.product.single as Record<string, string>;
      const name = single.name!.trim();
      const set = (single.set ?? "").trim().toLowerCase();
      const collector_number = (single.number ?? "").trim();
      const finish = FINISH_LABELS[single.finish_id ?? ""] ?? "nonfoil";
      const scryfall_id = single.scryfall_id;
      const qty = item.quantity ?? 1;
      const key = `${name}|${set}|${collector_number}|${finish}`;
      if (!master[key]) {
        master[key] = { name, set, collector_number, finish, scryfall_id, quantity: 0, allocations: {} };
      }
      (master[key] as Record<string, unknown>).quantity = (master[key] as Record<string, number>).quantity + qty;
      const alloc = (master[key] as Record<string, Record<string, number>>).allocations;
      alloc[oid] = (alloc[oid] ?? 0) + qty;
    }
  }

  const sets: Record<string, { name: string; released_at: string }> = {
    cmm: { name: "Commander Masters", released_at: "2023-08-04" },
  };

  return { orders, master, sets };
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
  let email: string, token: string;
  try {
    ({ email, token } = getCredentials());
  } catch (err) {
    if (process.env["NODE_ENV"] !== "production") {
      req.log.info("no manapool credentials; returning placeholder orders");
      res.json(getPlaceholderOrders());
      return;
    }
    logger.error(err, "manapick/orders getCredentials error");
    res.status(500).json({ error: "Internal server error" });
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
        if (process.env["NODE_ENV"] !== "production") {
          req.log.warn("manapool auth failed; returning placeholder orders");
          res.json(getPlaceholderOrders());
          return;
        }
        res.status(500).json({ error: "Manapool authentication failed. Check your credentials." });
        return;
      }
      if (!resp.ok) {
        if (process.env["NODE_ENV"] !== "production") {
          req.log.warn({ status: resp.status }, "manapool error; returning placeholder orders");
          res.json(getPlaceholderOrders());
          return;
        }
        res.status(500).json({ error: `Manapool error: ${resp.status}` });
        return;
      }
      const body = (await resp.json()) as { orders?: Array<Record<string, unknown>> };
      const page = body.orders ?? [];
      summaries.push(...page);
      if (page.length < limit || offset > 5000) break;
      offset += limit;
    }

    const orders: Array<Record<string, unknown>> = [];
    for (const s of summaries) {
      const oid = s["id"];
      if (!oid) continue;
      const r = await fetch(`${MANAPOOL_BASE}/seller/orders/${oid}`, {
        headers: mpHeaders(email, token),
      });
      if (r.ok) {
        const body = (await r.json()) as Record<string, unknown>;
        orders.push((body["order"] as Record<string, unknown>) ?? body);
      }
      await new Promise((r) => setTimeout(r, 50));
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

    // Fetch all Scryfall sets in one call, then filter to codes in this batch of orders
    const neededCodes = new Set(Object.values(master).map((e) => e.set).filter(Boolean));
    const sets: Record<string, { name: string; released_at: string }> = {};
    try {
      const r = await fetch(`${SCRYFALL_BASE}/sets`, {
        headers: { "User-Agent": "TCGAccounting/1.0" },
      });
      if (r.ok) {
        const body = (await r.json()) as { data?: Array<Record<string, unknown>> };
        for (const s of body.data ?? []) {
          const code = String(s["code"] ?? "").toLowerCase();
          if (neededCodes.has(code)) {
            sets[code] = {
              name: String(s["name"] ?? code),
              released_at: String(s["released_at"] ?? "1900-01-01"),
            };
          }
        }
      }
    } catch {
      // sets will be empty; client falls back to set codes for display
    }

    req.log.info({ orders: orders.length, uniqueCards: Object.keys(master).length, sets: Object.keys(sets).length }, "manapick orders fetched");
    res.json({ orders, master, sets });
  } catch (err) {
    logger.error(err, "manapick/orders error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/manapick/sets
// Scryfall sets for sorting and display
router.get("/manapick/sets", async (_req, res): Promise<void> => {
  try {
    const r = await fetch(`${SCRYFALL_BASE}/sets`);
    if (!r.ok) { res.json({ sets: {} }); return; }
    const body = (await r.json()) as { data?: Array<Record<string, unknown>> };
    const sets: Record<string, { name: string; released_at: string }> = {};
    for (const s of body.data ?? []) {
      const code = String(s["code"] ?? "").toLowerCase();
      if (code) sets[code] = { name: String(s["name"] ?? code), released_at: String(s["released_at"] ?? "1900-01-01") };
    }
    res.json({ sets });
  } catch {
    res.json({ sets: {} });
  }
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
    ({ email, token } = getCredentials());
  } catch (err) {
    logger.error(err, "manapick/orders/:id/ship getCredentials error");
    res.status(500).json({ error: "Internal server error" }); return;
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
