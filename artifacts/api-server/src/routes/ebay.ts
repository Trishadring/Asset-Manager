import { Router, type IRouter } from "express";
import { db, ebayOrdersTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const SCOPES = [
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.finances.readonly",
].join(" ");

const router: IRouter = Router();

// In-memory access token cache
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }

  const clientId = process.env["EBAY_CLIENT_ID"];
  const clientSecret = process.env["EBAY_CLIENT_SECRET"];
  const refreshToken = process.env["EBAY_USER_TOKEN"];

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, or EBAY_USER_TOKEN");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const scopes = [
    "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
    "https://api.ebay.com/oauth/api_scope/sell.finances.readonly",
  ].join(" ");

  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: scopes,
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
  lineItems?: Array<unknown>;
  pricingSummary?: {
    total?: { value?: string };
    deliveryCost?: { value?: string };
    priceSubtotal?: { value?: string };
  };
}

interface EbayTransactionRaw {
  orderId?: string;
  totalFeeAmount?: { value?: string };
  amount?: { value?: string };
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
  return orders;
}

async function fetchAllTransactions(token: string): Promise<EbayTransactionRaw[]> {
  const transactions: EbayTransactionRaw[] = [];
  let next: string | null = null;

  while (true) {
    const url =
      next ??
      `https://api.ebay.com/sell/finances/v1/transaction?transactionType=SALE&limit=200`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`eBay Finances API ${res.status}: ${text}`);
    }
    const data = (await res.json()) as {
      transactions?: EbayTransactionRaw[];
      next?: string;
    };
    transactions.push(...(data.transactions ?? []));
    next = data.next ?? null;
    if (!next) break;
  }
  return transactions;
}

/** Returns the eBay OAuth authorization URL for the user to visit */
router.get("/ebay/auth-url", (req, res): void => {
  const clientId = process.env["EBAY_CLIENT_ID"];
  const ruName = process.env["EBAY_RUNAME"];
  if (!clientId || !ruName) {
    res.status(500).json({ error: "EBAY_CLIENT_ID or EBAY_RUNAME not configured" });
    return;
  }
  const url = new URL("https://auth.ebay.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", ruName);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  res.json({ url: url.toString() });
});

/** eBay redirects here after user authorizes — exchanges code for refresh token */
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

  // Cache the access token for immediate use
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };

  res.send(`<!DOCTYPE html>
<html>
<head><title>eBay Connected</title><style>
  body { font-family: system-ui, sans-serif; max-width: 600px; margin: 60px auto; padding: 0 20px; }
  .box { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 24px; }
  h2 { color: #16a34a; margin-top: 0; }
  code { display: block; background: #f1f5f9; padding: 12px; border-radius: 6px; word-break: break-all; font-size: 13px; margin: 12px 0; }
  p { color: #475569; }
  .warn { background: #fffbeb; border-color: #fbbf24; }
  .warn h3 { color: #b45309; margin-top: 0; }
</style></head>
<body>
  <div class="box">
    <h2>eBay connected successfully!</h2>
    <p>Your app can now sync eBay orders. Save this refresh token as your <strong>EBAY_USER_TOKEN</strong> secret to avoid re-authorizing:</p>
    <code>${data.refresh_token}</code>
    <p style="font-size:13px">Expires in ${Math.round(data.refresh_token_expires_in / 86400)} days.</p>
  </div>
  <br>
  <div class="box warn">
    <h3>Save your refresh token now</h3>
    <p>Go to Replit Secrets, update <strong>EBAY_USER_TOKEN</strong> with the value above. Then you won't need to re-authorize unless the token expires.</p>
    <p>You can close this tab and sync eBay orders from the Orders page.</p>
  </div>
</body>
</html>`);
});

router.post("/ebay/sync", async (req, res): Promise<void> => {
  try {
    const token = await getAccessToken();

    const [orders, transactions] = await Promise.all([
      fetchAllOrders(token),
      fetchAllTransactions(token).catch(() => [] as EbayTransactionRaw[]),
    ]);

    // Build fee map keyed by orderId
    const feeMap = new Map<string, number>();
    for (const tx of transactions) {
      if (tx.orderId && tx.totalFeeAmount?.value) {
        feeMap.set(tx.orderId, parseFloat(tx.totalFeeAmount.value));
      }
    }

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
