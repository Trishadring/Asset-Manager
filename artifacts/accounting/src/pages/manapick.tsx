import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw, Package, ShoppingBag, CheckCircle2 } from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ScryfallCard {
  id: string;
  name: string;
  colors?: string[];
  type_line?: string;
  set: string;
  collector_number: string;
  image_uris?: { normal?: string; large?: string; small?: string };
  card_faces?: Array<{ image_uris?: { normal?: string; large?: string; small?: string } }>;
}

interface MasterEntry {
  name: string;
  set: string;
  collector_number: string;
  finish: "nonfoil" | "foil" | "etched" | string;
  quantity: number;
  scryfall_id?: string;
  allocations: Record<string, number>;
  scryfall?: ScryfallCard;
}

interface ShippingAddress {
  name?: string; line1?: string; line2?: string; line3?: string;
  city?: string; state?: string; postal_code?: string; country?: string;
}

interface OrderItem {
  quantity?: number;
  product?: { single?: { name?: string; set?: string; number?: string; finish_id?: string; scryfall_id?: string } };
}

interface Order {
  id: string; label?: string;
  shipping_address?: ShippingAddress;
  shipping_method?: string;
  items?: OrderItem[];
}

type Master = Record<string, MasterEntry>;
type SetsMap = Record<string, { name: string; released_at: string }>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FINISH_LABELS: Record<string, string> = { NF: "nonfoil", FO: "foil", EF: "etched" };

function cardImage(card?: ScryfallCard): string | null {
  if (!card) return null;
  if (card.image_uris) return card.image_uris.normal ?? card.image_uris.large ?? card.image_uris.small ?? null;
  const face = card.card_faces?.[0];
  if (face?.image_uris) return face.image_uris.normal ?? face.image_uris.large ?? face.image_uris.small ?? null;
  return null;
}

function colorSortIndex(card?: ScryfallCard): number {
  if (!card) return 9;
  if (card.type_line?.includes("Land")) return 8;
  const c = card.colors ?? [];
  if (c.length === 0) return 7;
  if (c.length > 1) return 6;
  return ({ W: 1, U: 2, B: 3, R: 4, G: 5 } as Record<string, number>)[c[0]!] ?? 9;
}

function parseCollectorNumber(cn: string): [number, string] {
  const m = String(cn).match(/(\d+)/);
  return m ? [parseInt(m[1]!), cn] : [0, cn];
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return iso; }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CardItem({
  cardKey, entry, orderToBin, picked, onToggle,
}: {
  cardKey: string; entry: MasterEntry; orderToBin: Record<string, number>;
  picked: Record<string, boolean>; onToggle: (pk: string) => void;
}) {
  const img = cardImage(entry.scryfall);
  const allPicked = Object.keys(entry.allocations).every((oid) => picked[`${cardKey}|${oid}`]);
  const isFormatted = entry.finish === "foil" || entry.finish === "etched";

  return (
    <div className={`flex flex-col gap-1 transition-opacity duration-200 ${allPicked ? "opacity-30" : ""}`}>
      {/* Card image */}
      <div className={isFormatted ? "p-0.5 rounded-xl bg-gradient-to-br from-yellow-300 via-pink-400 via-cyan-300 to-green-300" : ""}>
        {img ? (
          <img src={img} alt={entry.name} className="w-full rounded-xl block" />
        ) : (
          <div className="w-full aspect-[63/88] rounded-xl bg-muted flex items-center justify-center text-xs text-muted-foreground px-2 text-center">
            {entry.name}
          </div>
        )}
      </div>

      {/* Name + set */}
      <div className="text-xs leading-tight mt-0.5">
        <p className={`font-semibold truncate ${allPicked ? "line-through text-muted-foreground" : ""}`}>{entry.name}</p>
        <p className="text-muted-foreground">
          {entry.set.toUpperCase()} #{entry.collector_number}
          {entry.finish === "foil" ? " ✨" : entry.finish === "etched" ? " 🔮" : ""}
        </p>
      </div>

      {/* Bin buttons */}
      {Object.entries(entry.allocations).map(([oid, qty]) => {
        const binNum = orderToBin[oid] ?? "?";
        const pk = `${cardKey}|${oid}`;
        const isPicked = picked[pk];
        return (
          <Button
            key={pk}
            size="sm"
            variant={isPicked ? "secondary" : "default"}
            className={`w-full text-xs h-7 ${isPicked ? "line-through text-muted-foreground" : ""}`}
            onClick={() => onToggle(pk)}
          >
            {isPicked ? "✓" : "○"} Bin {binNum} ×{qty}
          </Button>
        );
      })}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

type Phase = "pick" | "pack";

export default function ManaPick() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [master, setMaster] = useState<Master>({});
  const [sets, setSets] = useState<SetsMap>({});
  const [orderToBin, setOrderToBin] = useState<Record<string, number>>({});
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [shipped, setShipped] = useState<Record<string, boolean>>({});
  const [phase, setPhase] = useState<Phase>("pick");
  const [tracking, setTracking] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  // ── Fetch orders ──────────────────────────────────────────────────────────

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    setEnrichProgress({ done: 0, total: 0 });

    try {
      // 1. Fetch orders + sets in parallel
      const [ordersRes, setsRes] = await Promise.all([
        fetch("/api/manapick/orders"),
        fetch("/api/manapick/sets"),
      ]);

      if (!ordersRes.ok) {
        const body = await ordersRes.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${ordersRes.status}`);
      }

      const { orders: rawOrders, master: rawMaster } = await ordersRes.json() as {
        orders: Order[]; master: Master;
      };
      const { sets: rawSets } = await setsRes.json() as { sets: SetsMap };

      // Assign bin numbers
      const binMap: Record<string, number> = {};
      rawOrders.forEach((o, i) => { binMap[o.id] = i + 1; });

      setOrders(rawOrders);
      setMaster(rawMaster);
      setSets(rawSets);
      setOrderToBin(binMap);
      setPicked({});
      setShipped({});
      setLoading(false);

      // 2. Enrich cards with Scryfall in background
      const cardKeys = Object.keys(rawMaster);
      if (cardKeys.length === 0) return;

      setEnrichProgress({ done: 0, total: cardKeys.length });

      const identifiers = cardKeys.map((key) => {
        const e = rawMaster[key]!;
        return { key, scryfall_id: e.scryfall_id, set: e.set, collector_number: e.collector_number, name: e.name };
      });

      // Batch in chunks of 75
      const BATCH = 75;
      const allResults: Record<string, ScryfallCard> = {};
      for (let i = 0; i < identifiers.length; i += BATCH) {
        const batch = identifiers.slice(i, i + BATCH);
        try {
          const r = await fetch("/api/manapick/enrich", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifiers: batch }),
          });
          if (r.ok) {
            const { results } = await r.json() as { results: Record<string, ScryfallCard> };
            Object.assign(allResults, results);
          }
        } catch { /* continue on error */ }
        setEnrichProgress({ done: Math.min(i + BATCH, identifiers.length), total: identifiers.length });
      }

      // Merge scryfall data into master
      setMaster((prev) => {
        const next = { ...prev };
        for (const [key, card] of Object.entries(allResults)) {
          if (next[key]) next[key] = { ...next[key]!, scryfall: card };
        }
        return next;
      });
      setEnrichProgress({ done: 0, total: 0 });

    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
      setEnrichProgress({ done: 0, total: 0 });
    }
  }, []);

  const togglePick = useCallback((pk: string) => {
    setPicked((prev) => ({ ...prev, [pk]: !prev[pk] }));
  }, []);

  // ── Metrics ───────────────────────────────────────────────────────────────

  const { totalCards, pickedCards } = useMemo(() => {
    let total = 0, picked_ = 0;
    for (const [key, entry] of Object.entries(master)) {
      for (const [oid, qty] of Object.entries(entry.allocations)) {
        total += qty;
        if (picked[`${key}|${oid}`]) picked_ += qty;
      }
    }
    return { totalCards: total, pickedCards: picked_ };
  }, [master, picked]);

  // ── Sorted set groups ─────────────────────────────────────────────────────

  const setGroups = useMemo(() => {
    const bySet: Record<string, Array<[string, MasterEntry]>> = {};
    for (const [key, entry] of Object.entries(master)) {
      if (!bySet[entry.set]) bySet[entry.set] = [];
      bySet[entry.set]!.push([key, entry]);
    }
    return Object.entries(bySet)
      .sort(([a], [b]) => {
        const da = sets[a]?.released_at ?? "1900-01-01";
        const db = sets[b]?.released_at ?? "1900-01-01";
        return db.localeCompare(da);
      })
      .map(([setCode, cards]) => ({
        setCode,
        setInfo: sets[setCode],
        cards: cards.sort(([, a], [, b]) => {
          const ci = colorSortIndex(a.scryfall) - colorSortIndex(b.scryfall);
          if (ci !== 0) return ci;
          const [an] = parseCollectorNumber(a.collector_number);
          const [bn] = parseCollectorNumber(b.collector_number);
          return an - bn;
        }),
      }));
  }, [master, sets]);

  const isEmpty = Object.keys(master).length === 0;
  const isEnriching = enrichProgress.total > 0;

  // ── Pack view ─────────────────────────────────────────────────────────────

  async function shipOrder(oid: string) {
    const tn = tracking[oid] ?? "";
    try {
      const r = await fetch(`/api/manapick/orders/${oid}/ship`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracking_number: tn }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { error?: string };
        alert(`Failed: ${body.error ?? r.status}`);
        return;
      }
      setShipped((prev) => ({ ...prev, [oid]: true }));
    } catch (err) {
      alert(String(err));
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">ManaPick</h1>
          <p className="text-sm text-muted-foreground">Pick &amp; pack helper — sorted by set, color, and collector number</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={fetchOrders} disabled={loading} size="sm">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-1">{loading ? "Fetching…" : isEmpty ? "Fetch Orders" : "Refresh"}</span>
          </Button>
          {!isEmpty && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setOrders([]); setMaster({}); setPicked({}); setShipped({}); setOrderToBin({}); }}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md bg-destructive/10 text-destructive border border-destructive/20 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Enrichment progress */}
      {isEnriching && (
        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">
            Enriching card data… {enrichProgress.done}/{enrichProgress.total}
          </p>
          <Progress value={(enrichProgress.done / enrichProgress.total) * 100} />
        </div>
      )}

      {/* Empty state */}
      {!loading && isEmpty && !error && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <ShoppingBag className="h-12 w-12 opacity-20" />
          <p className="text-sm">Click <strong>Fetch Orders</strong> to load your paid, unshipped Manapool orders.</p>
        </div>
      )}

      {/* Metrics + phase toggle */}
      {!isEmpty && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Unique cards", value: Object.keys(master).length },
              { label: "Total to pick", value: totalCards },
              { label: "Picked", value: pickedCards },
              { label: "Orders", value: orders.length },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg border bg-card p-3 text-center">
                <p className="text-2xl font-bold tabular-nums">{value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {totalCards > 0 && (
            <Progress value={(pickedCards / totalCards) * 100} className="h-2" />
          )}

          {/* Phase toggle */}
          <div className="flex gap-2">
            <Button
              variant={phase === "pick" ? "default" : "outline"}
              size="sm"
              onClick={() => setPhase("pick")}
            >
              <ShoppingBag className="h-4 w-4 mr-1" /> Pick
            </Button>
            <Button
              variant={phase === "pack" ? "default" : "outline"}
              size="sm"
              onClick={() => setPhase("pack")}
            >
              <Package className="h-4 w-4 mr-1" /> Pack &amp; Ship
            </Button>
          </div>

          <Separator />

          {/* ── PICK VIEW ────────────────────────────────────────────────── */}
          {phase === "pick" && (
            <div className="space-y-8">
              {setGroups.map(({ setCode, setInfo, cards }) => (
                <div key={setCode}>
                  <div className="mb-3">
                    <h2 className="text-lg font-bold">{setInfo?.name ?? setCode.toUpperCase()}</h2>
                    <p className="text-xs text-muted-foreground">
                      {setCode.toUpperCase()}{setInfo?.released_at ? ` · Released ${formatDate(setInfo.released_at)}` : ""}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                    {cards.map(([key, entry]) => (
                      <CardItem
                        key={key}
                        cardKey={key}
                        entry={entry}
                        orderToBin={orderToBin}
                        picked={picked}
                        onToggle={togglePick}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── PACK VIEW ─────────────────────────────────────────────────── */}
          {phase === "pack" && (
            <div className="space-y-4">
              {/* Bin reference */}
              <div className="rounded-lg border p-3 text-sm space-y-1">
                <p className="font-semibold text-xs text-muted-foreground uppercase tracking-wide mb-2">Bin Reference</p>
                {orders.map((o) => (
                  <div key={o.id} className="flex items-center gap-2 text-xs">
                    <span className="font-bold text-foreground">Bin {orderToBin[o.id]}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="font-mono text-muted-foreground">{o.label ?? o.id.slice(0, 8)}</span>
                    {o.shipping_address?.name && (
                      <span className="text-muted-foreground">— {o.shipping_address.name}</span>
                    )}
                    {shipped[o.id] && <CheckCircle2 className="h-3 w-3 text-green-500 ml-auto" />}
                  </div>
                ))}
              </div>

              {/* Order cards */}
              {orders.filter((o) => !shipped[o.id]).map((order) => {
                const oid = order.id;
                const binNum = orderToBin[oid];
                const addr = order.shipping_address ?? {};
                const cardCount = (order.items ?? []).filter((i) => i.product?.single).reduce((s, i) => s + (i.quantity ?? 1), 0);

                return (
                  <div key={oid} className="rounded-lg border bg-card p-4 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h3 className="font-bold">📦 Bin {binNum} — <span className="font-mono text-sm">{order.label ?? oid.slice(0, 8)}</span></h3>
                        <p className="text-sm text-muted-foreground">{cardCount} card{cardCount !== 1 ? "s" : ""}</p>
                        <pre className="text-xs mt-2 bg-muted rounded p-2 whitespace-pre-wrap font-mono leading-snug">
                          {[addr.name, addr.line1, addr.line2, addr.line3,
                            `${addr.city ?? ""}, ${addr.state ?? ""} ${addr.postal_code ?? ""}`,
                            addr.country]
                            .filter(Boolean).join("\n")}
                        </pre>
                        {order.shipping_method && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Shipping: {order.shipping_method.replace(/_/g, " ")}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 min-w-[200px]">
                        <Input
                          placeholder="USPS tracking # (optional)"
                          value={tracking[oid] ?? ""}
                          onChange={(e) => setTracking((prev) => ({ ...prev, [oid]: e.target.value }))}
                          className="text-sm h-8"
                        />
                        <Button size="sm" onClick={() => shipOrder(oid)}>
                          ✓ Mark shipped via USPS
                        </Button>
                      </div>
                    </div>

                    {/* Card thumbnails */}
                    <div className="flex flex-wrap gap-2">
                      {(order.items ?? []).map((item, idx) => {
                        const single = item.product?.single;
                        if (!single?.name) return null;
                        const finishId = String(single.finish_id ?? "");
                        const finish = FINISH_LABELS[finishId] ?? "nonfoil";
                        const key = `${single.name}|${(single.set ?? "").toLowerCase()}|${single.number ?? ""}|${finish}`;
                        const entry = master[key];
                        const img = cardImage(entry?.scryfall);
                        const qty = item.quantity ?? 1;
                        return (
                          <div key={idx} className="flex flex-col items-center text-xs w-16">
                            {img ? (
                              <img src={img} alt={single.name} className="w-full rounded-lg" />
                            ) : (
                              <div className="w-full aspect-[63/88] rounded-lg bg-muted flex items-center justify-center text-[9px] text-center px-1">
                                {single.name}
                              </div>
                            )}
                            <span className="font-bold">×{qty}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Shipped */}
              {orders.filter((o) => shipped[o.id]).length > 0 && (
                <div className="rounded-lg border p-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    ✅ Shipped ({orders.filter((o) => shipped[o.id]).length})
                  </p>
                  {orders.filter((o) => shipped[o.id]).map((o) => (
                    <p key={o.id} className="text-sm">
                      Bin {orderToBin[o.id]} — {o.label ?? o.id.slice(0, 8)}
                      {o.shipping_address?.name ? ` — ${o.shipping_address.name}` : ""}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
