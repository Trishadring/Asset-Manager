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
function parsePullSheetCSV(text: string): Array<{
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  quantity: number;
  orderQuantity: number;
  imageUrl: string;
  setReleaseDate: string;
}> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headerLine = lines[0]!;
  const headers = headerLine.split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());

  const idx = (name: string) => headers.indexOf(name);
  const iName = idx("product name");
  const iSet = idx("set");
  const iNumber = idx("number");
  const iQty = idx("quantity");
  const iOrderQty = idx("order quantity");
  const iImage = idx("main photo url");
  const iReleaseDate = idx("set release date");

  if (iName === -1 || iSet === -1) return [];

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (!raw.trim()) continue;
    const cols = splitCSVLine(raw);

    const name = cols[iName]?.trim() ?? "";
    if (!name) continue;

    const setName = cols[iSet]?.trim() ?? "";
    const collectorNumber = cols[iNumber]?.trim() ?? "";
    const quantity = parseInt(cols[iQty] ?? "1", 10) || 1;
    const orderQuantity = parseInt(cols[iOrderQty] ?? "1", 10) || 1;
    const imageUrl = cols[iImage]?.trim() ?? "";
    const setReleaseDate = cols[iReleaseDate]?.trim() ?? "";

    results.push({
      name,
      setCode: "", // resolved via Scryfall
      setName,
      collectorNumber,
      quantity,
      orderQuantity,
      imageUrl,
      setReleaseDate,
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
    const cards = parsePullSheetCSV(csv);
    if (cards.length === 0) {
      res.status(400).json({ error: "No valid cards found in CSV. Make sure you're using the Pull Sheet format." });
      return;
    }
    req.log.info({ cards: cards.length }, "tcgplayer pull sheet parsed");
    res.json({ cards });
  } catch (err) {
    logger.error(err, "tcgplayer/parse-pullsheet error");
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
