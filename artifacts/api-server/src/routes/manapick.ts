import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import { getScryfallSets } from "../lib/scryfall-sets";
import { getManapoolAccessToken } from "../lib/manapool-oauth";
import {
  EnrichManapickCardsBody,
  EnrichManapickCardsResponse,
  GetManapickOrdersResponse,
  GetManapickSetsResponse,
  ShipManapickOrderBody,
  ShipManapickOrderParams,
  ShipManapickOrderResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const MANAPOOL_BASE = "https://manapool.com/api/v1";
const SCRYFALL_BASE = "https://api.scryfall.com";

const FINISH_LABELS: Record<string, string> = {
  NF: "nonfoil",
  FO: "foil",
  EF: "etched",
};

function mpHeaders(accessToken: string) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`,
  };
}

// GET /api/manapick/orders
// Fetch paid/unshipped orders from Manapool and consolidate by card
router.get("/manapick/orders", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");

  const accessToken = await getManapoolAccessToken(req);
  if (!accessToken) {
    res.status(401).json({ error: "Connect to Manapool to continue." });
    return;
  }

  try {
    const summaries: Array<Record<string, unknown>> = [];
    let limit = 100, offset = 0;
    while (true) {
      const resp = await fetch(
        `${MANAPOOL_BASE}/seller/orders?is_fulfilled=false&limit=${limit}&offset=${offset}`,
        { headers: mpHeaders(accessToken) },
      );
      if (resp.status === 401) {
        res.status(401).json({ error: "Manapool authorization expired. Reconnect and try again." });
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
            headers: mpHeaders(accessToken),
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
    res.json(GetManapickOrdersResponse.parse({ orders, master, sets }));
  } catch (err) {
    logger.error(err, "manapick/orders error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/manapick/sets
// Scryfall sets for sorting and display (cached 1h)
router.get("/manapick/sets", async (_req, res): Promise<void> => {
  const sets = await getScryfallSets();
  res.json(GetManapickSetsResponse.parse({ sets }));
});

// POST /api/manapick/enrich
// Batch Scryfall lookup using /cards/collection (up to 75 per call)
router.post("/manapick/enrich", async (req, res): Promise<void> => {
  const input = EnrichManapickCardsBody.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: input.error.message });
    return;
  }
  const { identifiers } = input.data;
  if (identifiers.length === 0) {
    res.json(EnrichManapickCardsResponse.parse({ results: {} }));
    return;
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
    res.json(EnrichManapickCardsResponse.parse({ results }));
  } catch (err) {
    logger.error(err, "manapick/enrich error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/manapick/orders/:id/ship
router.post("/manapick/orders/:id/ship", async (req, res): Promise<void> => {
  const accessToken = await getManapoolAccessToken(req);
  if (!accessToken) {
    res.status(401).json({ error: "Reconnect to Manapool to continue." });
    return;
  }

  const params = ShipManapickOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsedBody = ShipManapickOrderBody.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.message });
    return;
  }
  const orderId = params.data.id;
  const tracking_number = parsedBody.data.tracking_number ?? "";

  const body: Record<string, unknown> = { status: "shipped", tracking_company: "USPS" };
  if (tracking_number.trim()) {
    body["tracking_number"] = tracking_number.trim();
    body["tracking_url"] = `https://tools.usps.com/go/TrackConfirmAction?tLabels=${tracking_number.trim()}`;
  }

  try {
    const r = await fetch(`${MANAPOOL_BASE}/seller/orders/${orderId}/fulfillment`, {
      method: "PUT",
      headers: { ...mpHeaders(accessToken), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      req.log.warn({ status: r.status, order: orderId }, "Manapool fulfillment update failed");
      res.status(502).json({ error: "Manapool fulfillment update failed" });
      return;
    }
    res.json(ShipManapickOrderResponse.parse({ success: true }));
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
