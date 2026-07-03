import { Router, type IRouter } from "express";
import { db, tcgplayerOrdersTable } from "@workspace/db";
import { sql, desc } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// TCGPlayer charges ~10.25% platform fee (final value fee) on most sales.
// This is approximate since the exact fee varies by category/seller level.
// We store it so users can override per import if needed.
const TCG_FEE_RATE = 0.1025;

function parseUSD(val: string | undefined): number {
  if (!val) return 0;
  const n = parseFloat(val.replace(/[$,]/g, "").trim());
  return isNaN(n) ? 0 : n;
}

function parseDate(val: string | undefined): Date {
  if (!val) return new Date();
  const d = new Date(val.trim());
  return isNaN(d.getTime()) ? new Date() : d;
}

/** Parse a TCGPlayer Order Export CSV into rows */
function parseOrderExportCSV(text: string): Array<{
  id: string;
  date: Date;
  buyerName: string;
  status: string;
  productAmt: number;
  shippingAmt: number;
  totalAmt: number;
  platformFees: number;
  netPayout: number;
  itemCount: number;
}> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  // Find header row
  const headerLine = lines[0]!;
  const headers = headerLine.split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());

  const idx = (name: string) => headers.indexOf(name);
  const iOrderNum = idx("order #");
  const iBuyer = idx("buyer name");
  const iDate = idx("order date");
  const iStatus = idx("status");
  const iProduct = idx("product amt");
  const iShipping = idx("shipping amt");
  const iTotal = idx("total amt");

  if (iOrderNum === -1 || iTotal === -1) return [];

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (!raw.trim()) continue;

    // Simple CSV split (handles quoted fields)
    const cols = splitCSVLine(raw);

    const id = cols[iOrderNum]?.trim() ?? "";
    if (!id) continue;

    const productAmt = parseUSD(cols[iProduct]);
    const shippingAmt = parseUSD(cols[iShipping]);
    const totalAmt = parseUSD(cols[iTotal]);
    const platformFees = parseFloat((productAmt * TCG_FEE_RATE).toFixed(2));
    const netPayout = parseFloat((totalAmt - platformFees).toFixed(2));

    results.push({
      id,
      date: parseDate(cols[iDate]),
      buyerName: cols[iBuyer]?.trim() ?? "",
      status: cols[iStatus]?.trim() ?? "",
      productAmt,
      shippingAmt,
      totalAmt,
      platformFees,
      netPayout,
      itemCount: 1,
    });
  }
  return results;
}

/** Parse a TCGPlayer Pull Sheet CSV into ManaPick-compatible card entries */
/**
 * Strip TCGPlayer-specific suffixes from a product name to get the canonical
 * card name Scryfall recognises.
 *
 * TCGPlayer appends things like:
 *   "Otherworldly Gaze (2069) (Rainbow Foil)"
 *   "Sol Ring (Etched Foil)"
 *   "Black Lotus (Extended Art)"
 */
function toScryfallName(displayName: string): string {
  return displayName
    // strip "(collector_number)" e.g. "(2069)"
    .replace(/\s*\(\d+\)/g, "")
    // strip "(… Foil)", "(Extended Art)", "(Showcase)", "(Borderless)", "(Promo)", "(Retro Frame)", etc.
    .replace(/\s*\([^)]*(?:foil|art|showcase|borderless|promo|retro|frame|anime|serialized|concept|ampersand|neon ink|invisible ink|oil slick)[^)]*\)/gi, "")
    .trim();
}

// ─── Scryfall sets cache ────────────────────────────────────────────────────
// Maps lowercase set name → Scryfall set code. Refreshed once per hour.
let sfSetsCache: { codes: Map<string, string>; fetchedAt: number } | null = null;
const SF_SETS_TTL_MS = 3_600_000;

async function getScryfallSetCodes(): Promise<Map<string, string>> {
  const now = Date.now();
  if (sfSetsCache && now - sfSetsCache.fetchedAt < SF_SETS_TTL_MS) {
    return sfSetsCache.codes;
  }
  try {
    const r = await fetch("https://api.scryfall.com/sets", {
      headers: { "User-Agent": "TCGAccounting/1.0" },
    });
    if (!r.ok) return sfSetsCache?.codes ?? new Map();
    const body = (await r.json()) as { data: Array<{ code: string; name: string }> };
    const codes = new Map<string, string>();
    for (const s of body.data) {
      codes.set(s.name.toLowerCase(), s.code);
    }
    sfSetsCache = { codes, fetchedAt: now };
    return codes;
  } catch {
    return sfSetsCache?.codes ?? new Map();
  }
}

/** Resolve a TCGPlayer set name to a Scryfall set code.
 *  Tries exact match first, then a normalised partial match. */
function resolveSetCode(setName: string, codes: Map<string, string>): string {
  const lower = setName.toLowerCase();
  const exact = codes.get(lower);
  if (exact) return exact;
  // Partial: find any Scryfall set whose name contains the TCGPlayer name or vice-versa
  for (const [sfName, sfCode] of codes) {
    if (sfName.includes(lower) || lower.includes(sfName)) return sfCode;
  }
  return "";
}

function parsePullSheetCSV(
  text: string,
  setCodeMap: Map<string, string>,
): Array<{
  name: string;
  scryfallName: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  finish: "foil" | "nonfoil";
  quantity: number;
  orderQuantity: number;
  imageUrl: string;
  setReleaseDate: string;
  tcgplayerSku: number | null;
}> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headerLine = lines[0]!;
  const headers = headerLine.split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());

  const idx = (name: string) => headers.indexOf(name);
  const iName = idx("product name");
  const iSet = idx("set");
  const iNumber = idx("number");
  const iCondition = idx("condition");
  const iQty = idx("quantity");
  const iOrderQty = idx("order quantity");
  const iImage = idx("main photo url");
  const iReleaseDate = idx("set release date");
  const iSku = idx("skuid");

  if (iName === -1 || iSet === -1) return [];

  /**
   * Parse the "Order Quantity" column which TCGPlayer formats as one or more
   * "OrderId:qty" pairs joined by "|", e.g. "5265F626-FA3A0B-7501C:1" or
   * "5265F626-FA3A0B-7501C:2|5265F626-4AD69A-AFC5E:1".
   * Returns the sum of all quantities, or 1 as a fallback.
   */
  function parseOrderQty(raw: string | undefined): number {
    if (!raw) return 1;
    // Try plain integer first (in case format ever changes)
    const plain = parseInt(raw, 10);
    if (!isNaN(plain) && !raw.includes(":")) return plain || 1;
    // Sum orderId:qty pairs
    const total = raw
      .split("|")
      .reduce((sum, pair) => {
        const qty = parseInt(pair.split(":").pop() ?? "", 10);
        return sum + (isNaN(qty) ? 0 : qty);
      }, 0);
    return total > 0 ? total : 1;
  }

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (!raw.trim()) continue;
    const cols = splitCSVLine(raw);

    // Skip the footer row TCGPlayer appends: "Orders Contained in Pull Sheet:,..."
    const firstCol = cols[0]?.trim().toLowerCase() ?? "";
    if (firstCol.startsWith("orders contained")) continue;

    const name = cols[iName]?.trim() ?? "";
    if (!name) continue;

    const setName = cols[iSet]?.trim() ?? "";
    const collectorNumber = cols[iNumber]?.trim() ?? "";
    const condition = iCondition !== -1 ? (cols[iCondition]?.trim() ?? "") : "";
    const finish: "foil" | "nonfoil" = /foil/i.test(condition) ? "foil" : "nonfoil";
    const setCode = resolveSetCode(setName, setCodeMap);
    const quantity = parseInt(cols[iQty] ?? "1", 10) || 1;
    const orderQuantity = parseOrderQty(cols[iOrderQty]);
    const imageUrl = cols[iImage]?.trim() ?? "";
    const setReleaseDate = cols[iReleaseDate]?.trim() ?? "";
    const skuRaw = iSku !== -1 ? parseInt(cols[iSku] ?? "", 10) : NaN;
    const tcgplayerSku = isNaN(skuRaw) ? null : skuRaw;

    results.push({
      name,
      scryfallName: toScryfallName(name),
      setCode,
      setName,
      collectorNumber,
      finish,
      quantity,
      orderQuantity,
      imageUrl,
      setReleaseDate,
      tcgplayerSku,
    });
  }
  return results;
}

function splitCSVLine(line: string): string[] {
  const cols: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === "," && !inQuote) {
      cols.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

// POST /api/tcgplayer/import-orders
// Upload and import a TCGPlayer Order Export CSV into accounting
router.post("/tcgplayer/import-orders", async (req, res): Promise<void> => {
  const { csv } = req.body as { csv?: string };
  if (!csv || typeof csv !== "string") {
    res.status(400).json({ error: "csv field is required" });
    return;
  }

  try {
    const rows = parseOrderExportCSV(csv);
    if (rows.length === 0) {
      res.status(400).json({ error: "No valid orders found in CSV. Make sure you're using the Order Export format." });
      return;
    }

    await db
      .insert(tcgplayerOrdersTable)
      .values(rows)
      .onConflictDoUpdate({
        target: tcgplayerOrdersTable.id,
        set: {
          date: sql`excluded.date`,
          buyerName: sql`excluded.buyer_name`,
          status: sql`excluded.status`,
          productAmt: sql`excluded.product_amt`,
          shippingAmt: sql`excluded.shipping_amt`,
          totalAmt: sql`excluded.total_amt`,
          platformFees: sql`excluded.platform_fees`,
          netPayout: sql`excluded.net_payout`,
          itemCount: sql`excluded.item_count`,
        },
      });

    req.log.info({ upserted: rows.length }, "tcgplayer orders imported");
    res.json({ message: `Imported ${rows.length} TCGPlayer order${rows.length !== 1 ? "s" : ""}.`, upserted: rows.length });
  } catch (err) {
    logger.error(err, "tcgplayer/import-orders error");
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/tcgplayer/parse-pullsheet
// Parse a TCGPlayer Pull Sheet CSV and return card entries for ManaPick
router.post("/tcgplayer/parse-pullsheet", async (req, res): Promise<void> => {
  const { csv } = req.body as { csv?: string };
  if (!csv || typeof csv !== "string") {
    res.status(400).json({ error: "csv field is required" });
    return;
  }

  try {
    // Detect if user accidentally uploaded an Order List instead of a Pull Sheet
    const firstLine = csv.split(/\r?\n/)[0]?.toLowerCase() ?? "";
    if (firstLine.includes("order #") || firstLine.includes("buyer name")) {
      res.status(400).json({
        error:
          'This looks like a TCGPlayer Order List, not a Pull Sheet. In TCGPlayer, go to Orders → click "Pull Sheet" (or export a Pull Sheet from the Orders page) to get a CSV with individual card rows.',
      });
      return;
    }

    const setCodeMap = await getScryfallSetCodes();
    const cards = parsePullSheetCSV(csv, setCodeMap);
    if (cards.length === 0) {
      res.status(400).json({
        error:
          'No card rows found. Upload the TCGPlayer Pull Sheet CSV (columns: Product Name, Set, SkuId, Order Quantity). The Order List or Packing Slip formats won\'t work here.',
      });
      return;
    }
    req.log.info({ cards: cards.length }, "tcgplayer pull sheet parsed");
    res.json({ cards });
  } catch (err) {
    logger.error(err, "tcgplayer/parse-pullsheet error");
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/tcgplayer/deduct-manapool
// Preview or apply Manapool inventory deductions based on a TCGPlayer pull sheet.
// Body: { cards: TcgPullCard[], apply: boolean }
// - apply=false (default): returns a preview of what would change, no writes
// - apply=true: fetches inventory, reduces quantities, writes back to Manapool
router.post("/tcgplayer/deduct-manapool", async (req, res): Promise<void> => {
  let email: string, token: string;
  try {
    const e = process.env["MANAPOOL_EMAIL"] ?? "";
    const t = process.env["MANAPOOL_API_KEY"] ?? "";
    if (!e || !t) throw new Error("MANAPOOL_EMAIL or MANAPOOL_API_KEY not configured.");
    email = e; token = t;
  } catch (err) {
    res.status(500).json({ error: String(err) }); return;
  }

  const { cards, apply = false } = req.body as {
    cards?: Array<{ name: string; tcgplayerSku: number | null; orderQuantity: number }>;
    apply?: boolean;
  };

  if (!Array.isArray(cards) || cards.length === 0) {
    res.status(400).json({ error: "cards array is required" }); return;
  }

  // Only cards with a known TCGPlayer SKU can be matched
  const skuCards = cards.filter((c) => c.tcgplayerSku !== null);
  if (skuCards.length === 0) {
    res.status(400).json({ error: "No cards with TCGPlayer SKU found. Make sure you're using the Pull Sheet export (not the Order export)." });
    return;
  }

  const skuSet = new Set(skuCards.map((c) => c.tcgplayerSku!));
  const mpHeaders = {
    Accept: "application/json",
    "X-ManaPool-Email": email,
    "X-ManaPool-Access-Token": token,
    "Content-Type": "application/json",
  };

  // Fetch all Manapool inventory, paginating until we have everything
  type MpInventoryItem = {
    id: string;
    product: { tcgplayer_sku: number };
    price_cents: number;
    quantity: number;
  };

  const allInventory: MpInventoryItem[] = [];
  try {
    let cursor: string | null = null;
    const limit = 200;
    while (true) {
      const url = `https://manapool.com/api/v1/seller/inventory?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const r = await fetch(url, { headers: mpHeaders });
      if (!r.ok) {
        const text = await r.text();
        res.status(502).json({ error: `Manapool inventory fetch failed (${r.status}): ${text.slice(0, 200)}` });
        return;
      }
      const body = (await r.json()) as {
        inventory?: MpInventoryItem[];
        pagination?: { next_cursor?: string; returned?: number };
      };
      const page = body.inventory ?? [];
      allInventory.push(...page);
      cursor = body.pagination?.next_cursor ?? null;
      if (!cursor || page.length < limit) break;
    }
  } catch (err) {
    res.status(502).json({ error: `Failed to fetch Manapool inventory: ${String(err)}` }); return;
  }

  // Build a map from tcgplayer_sku -> inventory item (only items we care about)
  const inventoryBySku = new Map<number, MpInventoryItem>();
  for (const item of allInventory) {
    if (skuSet.has(item.product.tcgplayer_sku)) {
      inventoryBySku.set(item.product.tcgplayer_sku, item);
    }
  }

  // Build the deduction plan
  type DeductionRow = {
    name: string;
    tcgplayerSku: number;
    orderQuantity: number;
    currentQuantity: number;
    newQuantity: number;
    priceCents: number;
    inventoryId: string;
    status: "ok" | "insufficient" | "not_found";
  };

  const plan: DeductionRow[] = [];
  const notFound: Array<{ name: string; tcgplayerSku: number }> = [];

  for (const card of skuCards) {
    const sku = card.tcgplayerSku!;
    const inv = inventoryBySku.get(sku);
    if (!inv) {
      notFound.push({ name: card.name, tcgplayerSku: sku });
      continue;
    }
    const newQty = Math.max(0, inv.quantity - card.orderQuantity);
    plan.push({
      name: card.name,
      tcgplayerSku: sku,
      orderQuantity: card.orderQuantity,
      currentQuantity: inv.quantity,
      newQuantity: newQty,
      priceCents: inv.price_cents,
      inventoryId: inv.id,
      status: inv.quantity < card.orderQuantity ? "insufficient" : "ok",
    });
  }

  if (!apply) {
    // Preview only — no writes
    req.log.info({ plan: plan.length, notFound: notFound.length }, "tcgplayer deduct preview");
    res.json({ preview: true, plan, notFound });
    return;
  }

  // Apply: write only rows that have a change (newQuantity !== currentQuantity)
  const toUpdate = plan.filter((row) => row.newQuantity !== row.currentQuantity);
  if (toUpdate.length === 0) {
    res.json({ applied: true, updated: 0, plan, notFound });
    return;
  }

  try {
    const updateBody = toUpdate.map((row) => ({
      tcgplayer_sku: row.tcgplayerSku,
      price_cents: row.priceCents,
      quantity: row.newQuantity,
    }));

    const r = await fetch("https://manapool.com/api/v1/seller/inventory", {
      method: "POST",
      headers: mpHeaders,
      body: JSON.stringify(updateBody),
    });

    if (!r.ok) {
      const text = await r.text();
      res.status(502).json({ error: `Manapool inventory update failed (${r.status}): ${text.slice(0, 200)}` });
      return;
    }

    req.log.info({ updated: toUpdate.length, notFound: notFound.length }, "tcgplayer manapool deduction applied");
    res.json({ applied: true, updated: toUpdate.length, plan, notFound });
  } catch (err) {
    logger.error(err, "tcgplayer/deduct-manapool apply error");
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/tcgplayer/orders
router.get("/tcgplayer/orders", async (_req, res): Promise<void> => {
  const orders = await db
    .select()
    .from(tcgplayerOrdersTable)
    .orderBy(desc(tcgplayerOrdersTable.date));
  res.json(orders);
});

// DELETE /api/tcgplayer/orders
// Clear all TCGPlayer orders (useful for re-importing clean CSV)
router.delete("/tcgplayer/orders", async (req, res): Promise<void> => {
  const count = await db.delete(tcgplayerOrdersTable);
  req.log.info({ count }, "tcgplayer orders cleared");
  res.json({ ok: true });
});

export default router;
