import { Router, type IRouter } from "express";
import { db, ebayOrdersTable, settingsTable, purchasesTable } from "@workspace/db";
import { sql, eq, and, lt, like } from "drizzle-orm";

const SCOPES = [
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.finances",
].join(" ");

const router: IRouter = Router();

// In-memory access token cache
let cachedToken: { value: string; expiresAt: number } | null = null;

const REFRESH_TOKEN_KEY = "ebay_refresh_token";

async function getStoredRefreshToken(): Promise<string | null> {
  const [row] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, REFRESH_TOKEN_KEY))
    .limit(1);
  if (row?.value) return row.value;
  return process.env["EBAY_USER_TOKEN"] ?? null;
}

async function saveRefreshToken(token: string): Promise<void> {
  await db
    .insert(settingsTable)
    .values({ key: REFRESH_TOKEN_KEY, value: token, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: token, updatedAt: new Date() },
    });
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }

  const clientId = process.env["EBAY_CLIENT_ID"];
  const clientSecret = process.env["EBAY_CLIENT_SECRET"];
  const refreshToken = await getStoredRefreshToken();

  if (!clientId || !clientSecret) {
    throw new Error("Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET");
  }
  if (!refreshToken) {
    throw new Error("No eBay refresh token found. Connect your eBay account first.");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      // Do not pass `scope` here — eBay returns an access token with whatever
      // scopes were originally granted. Specifying scopes not in the original
      // grant causes the entire refresh to fail.
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay token exchange failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.value;
}

interface EbayOrderRaw {
  orderId: string;
  creationDate: string;
  orderFulfillmentStatus?: string;
  cancelStatus?: { cancelState?: string };
  lineItems?: Array<unknown>;
  pricingSummary?: {
    total?: { value?: string };
    deliveryCost?: { value?: string };
  };
}

interface EbayTransaction {
  orderId?: string;
  transactionType?: string;
  amount?: { value?: string };
  totalFeeAmount?: { value?: string };
}

function isActiveOrder(o: EbayOrderRaw): boolean {
  if (o.cancelStatus?.cancelState === "CANCEL_COMPLETE") return false;
  if (o.orderFulfillmentStatus === "NOT_STARTED" && o.cancelStatus?.cancelState) return false;
  return true;
}

async function fetchAllOrders(token: string): Promise<EbayOrderRaw[]> {
  const orders: EbayOrderRaw[] = [];
  let offset = 0;
  const limit = 200;

  while (true) {
    const res = await fetch(
      `https://api.ebay.com/sell/fulfillment/v1/order?limit=${limit}&offset=${offset}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`eBay Fulfillment API ${res.status}: ${text}`);
    }
    const data = (await res.json()) as { orders?: EbayOrderRaw[]; total?: number };
    const page = data.orders ?? [];
    orders.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }
  return orders.filter(isActiveOrder);
}

/** Fetch all SALE transactions from Finances API. Returns a map of orderId -> fees. */
async function fetchFeesByOrder(token: string): Promise<Map<string, number>> {
  const feeMap = new Map<string, number>();
  let offset = 0;
  const limit = 200;

  try {
    while (true) {
      const res = await fetch(
        `https://apiz.ebay.com/sell/finances/v1/transaction?transactionType=SALE&limit=${limit}&offset=${offset}`,
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
      );

      if (!res.ok) {
        // Finances API not available (scope not granted yet) — return empty map
        break;
      }

      const data = (await res.json()) as { transactions?: EbayTransaction[]; total?: number };
      const page = data.transactions ?? [];

      for (const tx of page) {
        if (tx.orderId && tx.totalFeeAmount?.value) {
          const fee = parseFloat(tx.totalFeeAmount.value);
          if (!isNaN(fee) && fee > 0) {
            feeMap.set(tx.orderId, fee);
          }
        }
      }

      if (page.length < limit) break;
      offset += limit;
    }
  } catch {
    // Silently fall back to no fees if Finances API fails
  }

  return feeMap;
}

/** Returns the eBay OAuth authorization URL for the user to visit */
router.get("/ebay/auth-url", (req, res): void => {
  const clientId = process.env["EBAY_CLIENT_ID"];
  const ruName = process.env["EBAY_RUNAME"];
  if (!clientId || !ruName) {
    res.status(500).json({ error: "EBAY_CLIENT_ID or EBAY_RUNAME not configured" });
    return;
  }
  const url =
    `https://auth.ebay.com/oauth2/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(ruName)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(SCOPES)}`;
  res.json({ url });
});

/** eBay redirects here after user authorizes — auto-saves refresh token to DB */
router.get("/ebay/oauth-callback", async (req, res): Promise<void> => {
  const code = req.query["code"];
  const error = req.query["error"];

  if (error || !code || typeof code !== "string") {
    res.status(400).send(`<h2>eBay authorization failed</h2><p>${String(error ?? "No code received")}</p>`);
    return;
  }

  const clientId = process.env["EBAY_CLIENT_ID"];
  const clientSecret = process.env["EBAY_CLIENT_SECRET"];
  const ruName = process.env["EBAY_RUNAME"];

  if (!clientId || !clientSecret || !ruName) {
    res.status(500).send("<h2>Server misconfiguration</h2><p>Missing EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, or EBAY_RUNAME.</p>");
    return;
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const tokenRes = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: ruName,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    res.status(502).send(`<h2>Token exchange failed (${tokenRes.status})</h2><pre>${text}</pre>`);
    return;
  }

  const data = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    refresh_token_expires_in: number;
  };

  await saveRefreshToken(data.refresh_token);
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };

  const expiryDays = Math.round(data.refresh_token_expires_in / 86400);

  res.send(`<!DOCTYPE html>
<html>
<head><title>eBay Connected</title><style>
  body { font-family: system-ui, sans-serif; max-width: 560px; margin: 60px auto; padding: 0 20px; }
  .box { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 24px; }
  h2 { color: #16a34a; margin-top: 0; }
  p { color: #475569; margin: 0 0 8px; }
</style></head>
<body>
  <div class="box">
    <h2>eBay connected!</h2>
    <p>Your refresh token has been saved automatically. You can close this tab and sync your orders.</p>
    <p style="font-size:13px;color:#94a3b8">Token valid for ${expiryDays} days. Reconnect from the Orders page before it expires.</p>
  </div>
</body>
</html>`);
});

router.post("/ebay/sync", async (req, res): Promise<void> => {
  try {
    const token = await getAccessToken();

    // Fetch orders and fee data in parallel
    const [orders, feeMap] = await Promise.all([
      fetchAllOrders(token),
      fetchFeesByOrder(token),
    ]);

    const rows = orders.map((o) => {
      const gross = parseFloat(o.pricingSummary?.total?.value ?? "0");
      const shipping = parseFloat(o.pricingSummary?.deliveryCost?.value ?? "0");
      const fees = feeMap.get(o.orderId) ?? 0;
      const net = gross - fees;

      return {
        id: o.orderId,
        date: new Date(o.creationDate),
        grossTotal: gross,
        shippingTotal: shipping,
        platformFees: fees,
        netPayout: net,
        itemCount: Array.isArray(o.lineItems) ? o.lineItems.length : 1,
      };
    });

    if (rows.length === 0) {
      res.json({ message: "No eBay orders found", upserted: 0, total: 0 });
      return;
    }

    await db
      .insert(ebayOrdersTable)
      .values(rows)
      .onConflictDoUpdate({
        target: ebayOrdersTable.id,
        set: {
          date: sql`excluded.date`,
          grossTotal: sql`excluded.gross_total`,
          shippingTotal: sql`excluded.shipping_total`,
          platformFees: sql`excluded.platform_fees`,
          netPayout: sql`excluded.net_payout`,
          itemCount: sql`excluded.item_count`,
        },
      });

    const withFees = rows.filter((r) => r.platformFees > 0).length;
    res.json({
      message: `Synced ${rows.length} eBay order${rows.length !== 1 ? "s" : ""} (${withFees} with real fee data).`,
      upserted: rows.length,
      total: rows.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: message });
  }
});

router.get("/ebay/orders", async (_req, res): Promise<void> => {
  const orders = await db
    .select()
    .from(ebayOrdersTable)
    .orderBy(sql`date DESC`);
  res.json(orders);
});

interface EbayShippingTransaction {
  transactionId?: string;
  transactionDate?: string;
  transactionType?: string;
  amount?: { value?: string; currency?: string };
  orderId?: string;
}

/** Fetches SHIPPING_LABEL transactions and upserts them into purchases. */
router.post("/ebay/sync-shipping", async (req, res): Promise<void> => {
  try {
    const token = await getAccessToken();

    // Only pull labels on or after Mar 29 2026
    const FROM_DATE = "2026-03-29T00:00:00.000Z";

    // Remove previously-synced labels older than the cutoff, and any
    // no-order-ID bulk charges (description = "eBay Shipping Label" exactly).
    await db
      .delete(purchasesTable)
      .where(
        and(
          like(purchasesTable.id, "ebay-ship-%"),
          lt(purchasesTable.date, new Date(FROM_DATE))
        )
      );
    await db
      .delete(purchasesTable)
      .where(
        and(
          like(purchasesTable.id, "ebay-ship-%"),
          eq(purchasesTable.description, "eBay Shipping Label")
        )
      );

    const labels: EbayShippingTransaction[] = [];
    let offset = 0;
    const limit = 200;

    while (true) {
      const r = await fetch(
        `https://apiz.ebay.com/sell/finances/v1/transaction?transactionType=SHIPPING_LABEL&limit=${limit}&offset=${offset}&transactionDateRange.from=${encodeURIComponent(FROM_DATE)}`,
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
      );

      if (!r.ok) {
        const text = await r.text();
        throw new Error(`eBay Finances API ${r.status}: ${text}`);
      }

      const data = (await r.json()) as { transactions?: EbayShippingTransaction[]; total?: number };
      const page = data.transactions ?? [];
      labels.push(...page);
      if (page.length < limit) break;
      offset += limit;
    }

    if (labels.length === 0) {
      res.json({ message: "No shipping label transactions found", synced: 0, total: 0 });
      return;
    }

    // Deduplicate by transaction ID — eBay can return the same ID in multiple
    // pages, and ON CONFLICT DO UPDATE rejects duplicates within one statement.
    const rowMap = new Map<string, { id: string; date: Date; description: string; amount: number }>();
    for (const tx of labels) {
      if (!tx.transactionId || !tx.amount?.value || !tx.orderId) continue;
      const id = `ebay-ship-${tx.transactionId}`;
      rowMap.set(id, {
        id,
        date: tx.transactionDate ? new Date(tx.transactionDate) : new Date(),
        description: tx.orderId
          ? `eBay Shipping Label (order …${tx.orderId.slice(-8)})`
          : "eBay Shipping Label",
        amount: Math.abs(parseFloat(tx.amount.value)),
      });
    }
    const rows = Array.from(rowMap.values());

    if (rows.length === 0) {
      res.json({ message: "No valid shipping transactions to sync", synced: 0, total: labels.length });
      return;
    }

    // PostgreSQL caps bind parameters at 65535. Each row has 4 columns, so
    // cap batch size at 500 rows (500 × 4 = 2000 params) to stay well under.
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      await db
        .insert(purchasesTable)
        .values(rows.slice(i, i + BATCH))
        .onConflictDoUpdate({
          target: purchasesTable.id,
          set: {
            date: sql`excluded.date`,
            description: sql`excluded.description`,
            amount: sql`excluded.amount`,
          },
        });
    }

    res.json({
      message: `Synced ${rows.length} eBay shipping label${rows.length !== 1 ? "s" : ""}.`,
      synced: rows.length,
      total: labels.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "ebay sync-shipping failed");
    res.status(502).json({ error: message });
  }
});

// ── App-level token cache (client_credentials for Browse API) ─────────────────

let cachedAppToken: { value: string; expiresAt: number } | null = null;

async function getAppToken(): Promise<string | null> {
  if (cachedAppToken && Date.now() < cachedAppToken.expiresAt - 60_000) {
    return cachedAppToken.value;
  }
  const clientId = process.env["EBAY_CLIENT_ID"];
  const clientSecret = process.env["EBAY_CLIENT_SECRET"];
  if (!clientId || !clientSecret) return null;
  try {
    const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "https://api.ebay.com/oauth/api_scope",
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token: string; expires_in: number };
    cachedAppToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return data.access_token;
  } catch {
    return null;
  }
}

interface EbayLineItemRaw {
  legacyItemId?: string;
  title?: string;
  quantity?: number;
  image?: { imageUrl?: string };
}

/** Returns unfulfilled eBay orders with listing title + image, for ManaPick. */
router.get("/ebay/pick-orders", async (req, res): Promise<void> => {
  try {
    const token = await getAccessToken();
    const allOrders = await fetchAllOrders(token);

    // Only orders awaiting shipment
    const pending = allOrders.filter(
      (o) => o.orderFulfillmentStatus === "NOT_STARTED" || o.orderFulfillmentStatus === "IN_PROGRESS"
    );

    // Collect unique legacyItemIds
    const itemIds = new Set<string>();
    for (const order of pending) {
      for (const item of (order.lineItems as EbayLineItemRaw[]) ?? []) {
        if (item.legacyItemId) itemIds.add(item.legacyItemId);
      }
    }

    // Try to fetch listing images via Browse API (app token = no user auth needed)
    const imageMap = new Map<string, string>();
    const appToken = await getAppToken();
    if (appToken && itemIds.size > 0) {
      await Promise.all(
        [...itemIds].map(async (itemId) => {
          try {
            const r = await fetch(`https://api.ebay.com/buy/browse/v1/item/v1|${itemId}|0`, {
              headers: { Authorization: `Bearer ${appToken}` },
            });
            if (r.ok) {
              const data = (await r.json()) as { image?: { imageUrl?: string } };
              if (data.image?.imageUrl) imageMap.set(itemId, data.image.imageUrl);
            }
          } catch { /* ignore */ }
        })
      );
    }

    const result = pending.map((order) => ({
      id: order.orderId,
      lineItems: ((order.lineItems as EbayLineItemRaw[]) ?? []).map((item) => ({
        title: item.title ?? "Unknown item",
        imageUrl:
          (item.legacyItemId ? imageMap.get(item.legacyItemId) : undefined) ??
          item.image?.imageUrl ??
          null,
        quantity: item.quantity ?? 1,
      })),
    }));

    res.json({ orders: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "ebay pick-orders failed");
    res.status(502).json({ error: message });
  }
});

export default router;
