import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  RefreshCw,
  Package,
  ShoppingBag,
  CheckCircle2,
  Upload,
  X,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ScryfallCard {
  id: string;
  name: string;
  colors?: string[];
  type_line?: string;
  set: string;
  collector_number: string;
  image_uris?: { normal?: string; large?: string; small?: string };
  card_faces?: Array<{
    image_uris?: { normal?: string; large?: string; small?: string };
  }>;
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
  source?: "manapool" | "tcgplayer";
}

interface ShippingAddress {
  name?: string;
  line1?: string;
  line2?: string;
  line3?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

interface OrderItem {
  quantity?: number;
  product?: {
    single?: {
      name?: string;
      set?: string;
      number?: string;
      finish_id?: string;
      scryfall_id?: string;
    };
  };
}

interface Order {
  id: string;
  label?: string;
  shipping_address?: ShippingAddress;
  shipping_method?: string;
  items?: OrderItem[];
  source?: "manapool" | "tcgplayer";
}

interface TcgPullCard {
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  quantity: number;
  orderQuantity: number;
  imageUrl: string;
  setReleaseDate: string;
}

type Master = Record<string, MasterEntry>;
type SetsMap = Record<string, { name: string; released_at: string }>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scryfallDirectUrl(scryfallId?: string): string | null {
  if (!scryfallId || scryfallId.length < 2) return null;
  return `https://cards.scryfall.io/normal/front/${scryfallId[0]}/${scryfallId[1]}/${scryfallId}.jpg`;
}

function cardImageFromData(card?: ScryfallCard): string | null {
  if (!card) return null;
  if (card.image_uris)
    return card.image_uris.normal ?? card.image_uris.large ?? card.image_uris.small ?? null;
  const face = card.card_faces?.[0];
  if (face?.image_uris)
    return face.image_uris.normal ?? face.image_uris.large ?? face.image_uris.small ?? null;
  return null;
}

function entryImageUrl(entry: MasterEntry): string | null {
  return scryfallDirectUrl(entry.scryfall_id) ?? cardImageFromData(entry.scryfall);
}

function colorSortIndex(card?: ScryfallCard): number {
  if (!card) return 9;
  if (card.type_line?.includes("Land")) return 8;
  const c = card.colors ?? [];
  if (c.length === 0) return 7;
  if (c.length > 1) return 6;
  return (
    ({ W: 1, U: 2, B: 3, R: 4, G: 5 } as Record<string, number>)[c[0]!] ?? 9
  );
}

function parseCollectorNumber(cn: string): [number, string] {
  const m = String(cn).match(/(\d+)/);
  return m ? [parseInt(m[1]!), cn] : [0, cn];
}

function formatDate(iso: string): string {
  try {
    return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CardItem({
  cardKey,
  entry,
  orderToBin,
  picked,
  onToggle,
}: {
  cardKey: string;
  entry: MasterEntry;
  orderToBin: Record<string, number>;
  picked: Record<string, boolean>;
  onToggle: (pk: string) => void;
}) {
  const img = entryImageUrl(entry);
  const allPicked = Object.keys(entry.allocations).every(
    (oid) => picked[`${cardKey}|${oid}`],
  );
  const isFormatted = entry.finish === "foil" || entry.finish === "etched";

  return (
    <div
      className={`flex flex-col gap-1 transition-opacity duration-200 ${allPicked ? "opacity-30" : ""}`}
    >
      <div
        className={
          isFormatted
            ? "p-0.5 rounded-xl bg-gradient-to-br from-yellow-300 via-pink-400 via-cyan-300 to-green-300"
            : ""
        }
      >
        {img ? (
          <img src={img} alt={entry.name} className="w-full rounded-xl block" />
        ) : (
          <div className="w-full aspect-[63/88] rounded-xl bg-muted flex items-center justify-center text-xs text-muted-foreground px-2 text-center">
            {entry.name}
          </div>
        )}
      </div>

      <div className="text-xs leading-tight mt-0.5">
        <p
          className={`font-semibold truncate ${allPicked ? "line-through text-muted-foreground" : ""}`}
        >
          {entry.name}
        </p>
        <p className="text-muted-foreground">
          {entry.set.toUpperCase()} #{entry.collector_number}
          {entry.finish === "foil"
            ? " ✨"
            : entry.finish === "etched"
              ? " 🔮"
              : ""}
          {entry.source === "tcgplayer" && (
            <span className="ml-1 text-blue-500 font-medium">TCG</span>
          )}
        </p>
      </div>

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
  const [sessionId, setSessionId] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [tcgError, setTcgError] = useState<string | null>(null);
  const [tcgLoading, setTcgLoading] = useState(false);

  const sessionIdRef = useRef("");
  const tcgFileInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch Manapool orders (and background-sync accounting) ────────────────

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    setEnrichProgress({ done: 0, total: 0 });

    try {
      // Fetch orders + kick off background Manapool accounting sync
      const [ordersRes] = await Promise.all([
        fetch("/api/manapick/orders"),
        fetch("/api/manapool/sync", { method: "POST" }).catch(() => {}),
      ]);

      if (!ordersRes.ok) {
        const body = (await ordersRes.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${ordersRes.status}`);
      }

      const { orders: rawOrders, master: rawMaster, sets: rawSets } =
        (await ordersRes.json()) as {
          orders: Order[];
          master: Master;
          sets: SetsMap;
        };

      const binMap: Record<string, number> = {};
      rawOrders.forEach((o, i) => {
        binMap[o.id] = i + 1;
      });

      const sid = [...rawOrders.map((o) => o.id)].sort().join("|");
      setSessionId(sid);
      sessionIdRef.current = sid;

      setOrders(rawOrders);
      setMaster(rawMaster);
      setSets(rawSets);
      setOrderToBin(binMap);
      setShipped({});
      setLoading(false);

      // Load persisted pick state
      try {
        const picksRes = await fetch(`/api/manapick/picks?session=${encodeURIComponent(sid)}`);
        if (picksRes.ok) {
          const { picks: savedPicks } = (await picksRes.json()) as { picks: Record<string, boolean> };
          setPicked(savedPicks);
        } else {
          setPicked({});
        }
      } catch {
        setPicked({});
      }

      // Enrich cards with Scryfall in background
      const cardKeys = Object.keys(rawMaster);
      if (cardKeys.length === 0) return;

      setEnrichProgress({ done: 0, total: cardKeys.length });

      const identifiers = cardKeys.map((key) => {
        const e = rawMaster[key]!;
        return {
          key,
          scryfall_id: e.scryfall_id,
          set: e.set,
          collector_number: e.collector_number,
          name: e.name,
        };
      });

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
            const { results } = (await r.json()) as {
              results: Record<string, ScryfallCard>;
            };
            Object.assign(allResults, results);
          }
        } catch {
          /* continue */
        }
        setEnrichProgress({
          done: Math.min(i + BATCH, identifiers.length),
          total: identifiers.length,
        });
      }

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

  // ── Load TCGPlayer pull sheet CSV ─────────────────────────────────────────

  const handleTcgFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setTcgError(null);
    setTcgLoading(true);

    try {
      const csv = await file.text();
      const res = await fetch("/api/tcgplayer/parse-pullsheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const { cards } = (await res.json()) as { cards: TcgPullCard[] };

      // Merge TCGPlayer cards into master + create a synthetic "TCGPlayer" order
      const TCG_ORDER_ID = "tcgplayer-pullsheet";
      const tcgOrder: Order = {
        id: TCG_ORDER_ID,
        label: "TCGPlayer",
        source: "tcgplayer",
      };

      setOrders((prev) => {
        const without = prev.filter((o) => o.id !== TCG_ORDER_ID);
        return [...without, tcgOrder];
      });
      setOrderToBin((prev) => {
        const existing = { ...prev };
        if (!existing[TCG_ORDER_ID]) {
          const maxBin = Math.max(0, ...Object.values(existing));
          existing[TCG_ORDER_ID] = maxBin + 1;
        }
        return existing;
      });

      setMaster((prev) => {
        const next = { ...prev };
        for (const card of cards) {
          // Use set name to build a lookup key (no set code from TCGPlayer CSV)
          // Key uses name + setName + collectorNumber since we don't have scryfall set code yet
          const key = `${card.name}|tcg:${card.setName}|${card.collectorNumber}|nonfoil`;
          if (!next[key]) {
            next[key] = {
              name: card.name,
              set: card.setName.toLowerCase().replace(/\s+/g, "-").slice(0, 6),
              collector_number: card.collectorNumber,
              finish: "nonfoil",
              quantity: 0,
              allocations: {},
              source: "tcgplayer",
            };
          }
          next[key].quantity += card.orderQuantity;
          next[key].allocations[TCG_ORDER_ID] =
            (next[key].allocations[TCG_ORDER_ID] ?? 0) + card.orderQuantity;
        }

        // Update sessionId to include TCGPlayer order
        const newSid = [...Object.keys(next).length > 0
          ? [TCG_ORDER_ID, ...orders.filter(o => o.id !== TCG_ORDER_ID).map(o => o.id)]
          : [TCG_ORDER_ID]
        ].sort().join("|");
        sessionIdRef.current = newSid;
        setSessionId(newSid);

        return next;
      });

      // Enrich TCGPlayer cards via Scryfall using card name
      const tcgIdentifiers = cards.map((c) => ({
        key: `${c.name}|tcg:${c.setName}|${c.collectorNumber}|nonfoil`,
        name: c.name,
        set: undefined,
        collector_number: c.collectorNumber,
        scryfall_id: undefined,
      }));

      // Also add set info for sorting
      setSets((prev) => {
        const next = { ...prev };
        for (const c of cards) {
          const pseudoCode = c.setName.toLowerCase().replace(/\s+/g, "-").slice(0, 6);
          if (!next[pseudoCode]) {
            next[pseudoCode] = {
              name: c.setName,
              released_at: c.setReleaseDate || "1900-01-01",
            };
          }
        }
        return next;
      });

      if (tcgIdentifiers.length > 0) {
        setEnrichProgress({ done: 0, total: tcgIdentifiers.length });
        const allResults: Record<string, ScryfallCard> = {};
        const BATCH = 75;
        for (let i = 0; i < tcgIdentifiers.length; i += BATCH) {
          const batch = tcgIdentifiers.slice(i, i + BATCH);
          try {
            const r = await fetch("/api/manapick/enrich", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ identifiers: batch }),
            });
            if (r.ok) {
              const { results } = (await r.json()) as { results: Record<string, ScryfallCard> };
              Object.assign(allResults, results);
            }
          } catch { /* continue */ }
          setEnrichProgress({ done: Math.min(i + BATCH, tcgIdentifiers.length), total: tcgIdentifiers.length });
        }
        setMaster((prev) => {
          const next = { ...prev };
          for (const [key, card] of Object.entries(allResults)) {
            if (next[key]) next[key] = { ...next[key]!, scryfall: card, scryfall_id: card.id };
          }
          return next;
        });
        setEnrichProgress({ done: 0, total: 0 });
      }
    } catch (err) {
      setTcgError(err instanceof Error ? err.message : String(err));
    } finally {
      setTcgLoading(false);
    }
  }, [orders]);

  const removeTcgCards = useCallback(() => {
    const TCG_ORDER_ID = "tcgplayer-pullsheet";
    setOrders((prev) => prev.filter((o) => o.id !== TCG_ORDER_ID));
    setOrderToBin((prev) => {
      const next = { ...prev };
      delete next[TCG_ORDER_ID];
      return next;
    });
    setMaster((prev) => {
      const next: Master = {};
      for (const [k, v] of Object.entries(prev)) {
        if (v.source !== "tcgplayer") next[k] = v;
      }
      return next;
    });
    setTcgError(null);
  }, []);

  const togglePick = useCallback((pk: string) => {
    setPicked((prev) => {
      const newVal = !prev[pk];
      const sid = sessionIdRef.current;
      if (sid) {
        fetch("/api/manapick/picks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session: sid, pickKey: pk, picked: newVal }),
        }).catch(() => {});
      }
      return { ...prev, [pk]: newVal };
    });
  }, []);

  // ── Cross-device sync: poll server picks every 5s during pick phase ────────

  useEffect(() => {
    const sid = sessionId;
    if (!sid || phase !== "pick") return;
    const interval = setInterval(async () => {
      try {
        const r = await fetch(`/api/manapick/picks?session=${encodeURIComponent(sid)}`);
        if (r.ok) {
          const { picks } = (await r.json()) as { picks: Record<string, boolean> };
          setPicked(picks);
        }
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [sessionId, phase]);

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
      const setKey = entry.set;
      if (!bySet[setKey]) bySet[setKey] = [];
      bySet[setKey]!.push([key, entry]);
    }
    return Object.entries(bySet)
      .sort(([a], [b]) => {
        const da = sets[a]?.released_at ?? "1900-01-01";
        const db = sets[b]?.released_at ?? "1900-01-01";
        return da.localeCompare(db);
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
  const hasTcg = orders.some((o) => o.id === "tcgplayer-pullsheet");

  // ── Pack view ─────────────────────────────────────────────────────────────

  async function shipOrder(oid: string) {
    if (oid === "tcgplayer-pullsheet") {
      setShipped((prev) => ({ ...prev, [oid]: true }));
      return;
    }
    const tn = tracking[oid] ?? "";
    try {
      const r = await fetch(`/api/manapick/orders/${oid}/ship`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracking_number: tn }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
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
          <p className="text-sm text-muted-foreground">
            Pick &amp; pack helper — Manapool + TCGPlayer, sorted by set, color, and collector number
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={fetchOrders} disabled={loading} size="sm">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-1">
              {loading ? "Fetching…" : isEmpty ? "Fetch Manapool" : "Refresh Manapool"}
            </span>
          </Button>

          {/* TCGPlayer pull sheet upload */}
          <input
            ref={tcgFileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleTcgFile}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => tcgFileInputRef.current?.click()}
            disabled={tcgLoading}
          >
            {tcgLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            <span className="ml-1">
              {tcgLoading ? "Loading…" : hasTcg ? "Replace TCGPlayer CSV" : "Add TCGPlayer CSV"}
            </span>
          </Button>

          {hasTcg && (
            <Button
              variant="ghost"
              size="sm"
              onClick={removeTcgCards}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="h-4 w-4" />
              <span className="ml-1">Remove TCG</span>
            </Button>
          )}

          {!isEmpty && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setOrders([]);
                setMaster({});
                setPicked({});
                setShipped({});
                setOrderToBin({});
                setTcgError(null);
              }}
            >
              Clear All
            </Button>
          )}
        </div>
      </div>

      {/* Errors */}
      {error && (
        <div className="rounded-md bg-destructive/10 text-destructive border border-destructive/20 px-4 py-3 text-sm">
          {error}
        </div>
      )}
      {tcgError && (
        <div className="rounded-md bg-destructive/10 text-destructive border border-destructive/20 px-4 py-3 text-sm flex items-center justify-between">
          <span>TCGPlayer: {tcgError}</span>
          <button onClick={() => setTcgError(null)} className="ml-4 underline text-xs opacity-70 hover:opacity-100">dismiss</button>
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
          <p className="text-sm text-center max-w-sm">
            Click <strong>Fetch Manapool</strong> to load your paid, unshipped Manapool orders,
            or <strong>Add TCGPlayer CSV</strong> to load a TCGPlayer pull sheet.
          </p>
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

          {/* Platform badges */}
          <div className="flex gap-2 text-xs">
            {orders.some((o) => o.source !== "tcgplayer") && (
              <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 font-medium">
                Manapool
              </span>
            )}
            {hasTcg && (
              <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 font-medium">
                TCGPlayer
              </span>
            )}
          </div>

          {/* Phase toggle */}
          <div className="flex gap-2">
            <Button variant={phase === "pick" ? "default" : "outline"} size="sm" onClick={() => setPhase("pick")}>
              <ShoppingBag className="h-4 w-4 mr-1" /> Pick
            </Button>
            <Button variant={phase === "pack" ? "default" : "outline"} size="sm" onClick={() => setPhase("pack")}>
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
                    <h2 className="text-lg font-bold">
                      {setInfo?.name ?? setCode.toUpperCase()}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {setInfo?.name ? setCode.toUpperCase() : ""}
                      {setInfo?.released_at
                        ? `${setInfo.name ? " · " : ""}Released ${formatDate(setInfo.released_at)}`
                        : ""}
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
                <p className="font-semibold text-xs text-muted-foreground uppercase tracking-wide mb-2">
                  Bin Reference
                </p>
                {orders.map((o) => (
                  <div key={o.id} className="flex items-center gap-2 text-xs">
                    <span className="font-bold text-foreground">Bin {orderToBin[o.id]}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="font-mono text-muted-foreground">
                      {o.label ?? o.id.slice(0, 8)}
                    </span>
                    {o.shipping_address?.name && (
                      <span className="text-muted-foreground">— {o.shipping_address.name}</span>
                    )}
                    {o.source === "tcgplayer" && (
                      <span className="text-blue-500 font-medium">TCGPlayer</span>
                    )}
                    {shipped[o.id] && (
                      <CheckCircle2 className="h-3 w-3 text-green-500 ml-auto" />
                    )}
                  </div>
                ))}
              </div>

              {/* Order cards */}
              {orders
                .filter((o) => !shipped[o.id])
                .map((order) => {
                  const oid = order.id;
                  const binNum = orderToBin[oid];
                  const addr = order.shipping_address ?? {};
                  const isTcg = order.source === "tcgplayer";
                  const cardCount = isTcg
                    ? Object.values(master)
                        .filter((e) => e.source === "tcgplayer")
                        .reduce((s, e) => s + (e.allocations[oid] ?? 0), 0)
                    : (order.items ?? [])
                        .filter((i) => i.product?.single)
                        .reduce((s, i) => s + (i.quantity ?? 1), 0);

                  return (
                    <div
                      key={oid}
                      className="rounded-lg border bg-card p-4 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold">Bin {binNum}</span>
                            {isTcg && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 font-medium">
                                TCGPlayer
                              </span>
                            )}
                          </div>
                          {!isTcg && (
                            <>
                              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                                {order.label ?? oid.slice(0, 10)}
                              </p>
                              {addr.name && (
                                <p className="text-sm font-medium mt-1">{addr.name}</p>
                              )}
                              {addr.line1 && (
                                <p className="text-xs text-muted-foreground">
                                  {addr.line1}
                                  {addr.line2 ? `, ${addr.line2}` : ""}
                                </p>
                              )}
                              {(addr.city || addr.state || addr.postal_code) && (
                                <p className="text-xs text-muted-foreground">
                                  {[addr.city, addr.state, addr.postal_code].filter(Boolean).join(", ")}
                                </p>
                              )}
                              {order.shipping_method && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  via {order.shipping_method}
                                </p>
                              )}
                            </>
                          )}
                          {isTcg && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Ship via your normal TCGPlayer process
                            </p>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                          {cardCount} card{cardCount !== 1 ? "s" : ""}
                        </span>
                      </div>

                      {!isTcg && (
                        <div className="flex gap-2">
                          <Input
                            placeholder="Tracking number (optional)"
                            value={tracking[oid] ?? ""}
                            onChange={(e) =>
                              setTracking((prev) => ({ ...prev, [oid]: e.target.value }))
                            }
                            className="h-8 text-xs"
                          />
                          <Button
                            size="sm"
                            className="h-8 shrink-0"
                            onClick={() => shipOrder(oid)}
                          >
                            Mark Shipped
                          </Button>
                        </div>
                      )}

                      {isTcg && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8"
                          onClick={() => shipOrder(oid)}
                        >
                          Mark Packed
                        </Button>
                      )}
                    </div>
                  );
                })}

              {orders.filter((o) => !shipped[o.id]).length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                  <CheckCircle2 className="h-10 w-10 text-green-500 opacity-80" />
                  <p className="text-sm font-medium">All orders packed &amp; shipped!</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
