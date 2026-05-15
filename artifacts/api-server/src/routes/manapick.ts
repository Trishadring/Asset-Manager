import { Router, type IRouter } from "express";
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
    res.status(500).json({ error: String(err) });
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
        res.status(500).json({ error: "Manapool authentication failed. Check your credentials." });
        return;
      }
      if (!resp.ok) {
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

    req.log.info({ orders: orders.length, uniqueCards: Object.keys(master).length }, "manapick orders fetched");
    res.json({ orders, master });
  } catch (err) {
    logger.error(err, "manapick/orders error");
    res.status(500).json({ error: String(err) });
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
      const sfIds = batch.map((c) => {
        if (c.scryfall_id) return { id: c.scryfall_id };
        if (c.set && c.collector_number) return { set: c.set, collector_number: c.collector_number };
        return { name: c.name ?? "" };
      });

      const r = await fetch(`${SCRYFALL_BASE}/cards/collection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: sfIds }),
      });

      if (r.ok) {
        const body = (await r.json()) as { data?: Array<Record<string, unknown>> };
        for (const card of body.data ?? []) {
          const matched = batch.find(
            (b) =>
              (b.scryfall_id && b.scryfall_id === card["id"]) ||
              (b.set && b.collector_number &&
                b.set === String(card["set"] ?? "").toLowerCase() &&
                b.collector_number === String(card["collector_number"] ?? "")),
          );
          if (matched) results[matched.key] = card;
        }
      }
    }
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/manapick/orders/:id/ship
router.post("/manapick/orders/:id/ship", async (req, res): Promise<void> => {
  let email: string, token: string;
  try {
    ({ email, token } = getCredentials());
  } catch (err) {
    res.status(500).json({ error: String(err) }); return;
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
      const text = await r.text();
      res.status(r.status).json({ error: text }); return;
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
