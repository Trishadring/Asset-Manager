import { Router, type IRouter } from "express";
import { db, ebayOrdersTable, settingsTable } from "@workspace/db";
import { sql, eq } from "drizzle-orm";

const FULFILLMENT_SCOPE = "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly";

const router: IRouter = Router();

// In-memory access token cache
let cachedToken: { value: string; expiresAt: number } | null = null;

const REFRESH_TOKEN_KEY = "ebay_refresh_token";

async function getStoredRefreshToken(): Promise<string | null> {
  // Check DB first (set by OAuth callback)
  const [row] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, REFRESH_TOKEN_KEY))
    .limit(1);
  if (row?.value) return row.value;

  // Fall back to env var (legacy / manual override)
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
  // Return cached token if still valid (with 60s buffer)
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
      scope: FULFILLMENT_SCOPE,
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
    priceSubtotal?: { value?: string };
  };
}

function isActiveOrder(o: EbayOrderRaw): boolean {
  // Skip cancelled orders — they don't count as revenue
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

/** Returns the eBay OAuth authorization URL for the user to visit */
router.get("/ebay/auth-url", (req, res): void => {
  const clientId = process.env["EBAY_CLIENT_ID"];
  const ruName = process.env["EBAY_RUNAME"];
  if (!clientId || !ruName) {
    res.status(500).json({ error: "EBAY_CLIENT_ID or EBAY_RUNAME not configured" });
    return;
  }
  const encodedScope = encodeURIComponent(FULFILLMENT_SCOPE);
  const url =
    `https://auth.ebay.com/oauth2/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(ruName)}` +
    `&response_type=code` +
    `&scope=${encodedScope}`;
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

  // Auto-save refresh token to DB — no manual copy needed
  await saveRefreshToken(data.refresh_token);

  // Cache the access token for immediate use
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
    <p>Your refresh token has been saved automatically. You can close this tab.</p>
    <p style="font-size:13px;color:#94a3b8">Token valid for ${expiryDays} days. Reconnect from the Orders page before it expires.</p>
  </div>
</body>
</html>`);
});

router.post("/ebay/sync", async (req, res): Promise<void> => {
  try {
    const token = await getAccessToken();
    const orders = await fetchAllOrders(token);

    const rows = orders.map((o) => {
      const gross = parseFloat(o.pricingSummary?.total?.value ?? "0");
      const shipping = parseFloat(o.pricingSummary?.deliveryCost?.value ?? "0");

      return {
        id: o.orderId,
        date: new Date(o.creationDate),
        grossTotal: gross,
        shippingTotal: shipping,
        platformFees: 0, // populated once sell.finances.readonly scope is enabled
        netPayout: gross,
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

    res.json({
      message: `Synced ${rows.length} eBay order${rows.length !== 1 ? "s" : ""}`,
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

export default router;
