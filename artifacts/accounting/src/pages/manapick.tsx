import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2,
  RefreshCw,
  Package,
  ShoppingBag,
  CheckCircle2,
  Upload,
  X,
  MinusCircle,
  Tag,
} from "lucide-react";
import {
  useDeductFromManapool,
  type DeductionResult,
  type TcgPullCard,
} from "@/hooks/use-tcgplayer";

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

type Master = Record<string, MasterEntry>;
type SetsMap = Record<string, { name: string; released_at: string }>;

interface EbayPickLineItem {
  title: string;
  imageUrl: string | null;
  quantity: number;
}

interface EbayPickOrder {
  id: string;
  lineItems: EbayPickLineItem[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scryfallDirectUrl(scryfallId?: string): string | null {
  if (!scryfallId || scryfallId.length < 2) return null;
  return `https://cards.scryfall.io/normal/front/${scryfallId[0]}/${scryfallId[1]}/${scryfallId}.jpg`;
}

function cardImageFromData(card?: ScryfallCard): string | null {
  if (!card) return null;
  if (card.image_uris)
    return (
      card.image_uris.normal ??
      card.image_uris.large ??
      card.image_uris.small ??
      null
    );
  const face = card.card_faces?.[0];
  if (face?.image_uris)
    return (
      face.image_uris.normal ??
      face.image_uris.large ??
      face.image_uris.small ??
      null
    );
  return null;
}

function entryImageUrl(entry: MasterEntry): string | null {
  return (
    cardImageFromData(entry.scryfall) ?? scryfallDirectUrl(entry.scryfall_id)
  );
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

const CACHE_KEY = "manapick-cache";

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

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
  const [cachedAt, setCachedAt] = useState<number | null>(null);

  const [loading, setLoading] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [tcgError, setTcgError] = useState<string | null>(null);
  const [tcgLoading, setTcgLoading] = useState(false);

  // Deduct from Manapool state
  const [tcgCards, setTcgCards] = useState<TcgPullCard[]>([]);
  const [deductPreview, setDeductPreview] = useState<DeductionResult | null>(
    null,
  );
  const [deductDialogOpen, setDeductDialogOpen] = useState(false);
  const deductMutation = useDeductFromManapool();

  // eBay orders state
  const [ebayOrders, setEbayOrders] = useState<EbayPickOrder[]>([]);
  const [ebayLoading, setEbayLoading] = useState(false);
  const [ebayError, setEbayError] = useState<string | null>(null);
  const [ebayPacked, setEbayPacked] = useState<Record<string, boolean>>({});

  const sessionIdRef = useRef("");
  const tcgFileInputRef = useRef<HTMLInputElement>(null);

  // ── Restore from localStorage cache on mount ──────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const cached = JSON.parse(raw) as {
        orders: Order[];
        master: Master;
        sets: SetsMap;
        cachedAt: number;
      };
      if (!Array.isArray(cached.orders) || !cached.master) return;

      const binMap: Record<string, number> = {};
      cached.orders.forEach((o, i) => {
        binMap[o.id] = i + 1;
      });
      const sid = [...cached.orders.map((o) => o.id)].sort().join("|");

      setOrders(cached.orders);
      setMaster(cached.master);
      setSets(cached.sets ?? {});
      setOrderToBin(binMap);
      setSessionId(sid);
      sessionIdRef.current = sid;
      setCachedAt(cached.cachedAt);

      if (sid) {
        fetch(`/api/manapick/picks?session=${encodeURIComponent(sid)}`)
          .then((r) => (r.ok ? r.json() : { picks: {} }))
          .then(({ picks }) => setPicked(picks ?? {}))
          .catch(() => console.warn("failed to load picks"));
      }
    } catch {
      // corrupt cache — ignore
    }
  }, []);

  // Auto-fetch orders on mount (placeholder or real data)
  useEffect(() => {
    fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fetch Manapool orders (and background-sync accounting) ────────────────

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    setEnrichProgress({ done: 0, total: 0 });

    try {
      // Fetch orders + kick off background Manapool accounting sync
      const [ordersRes] = await Promise.all([
        fetch("/api/manapick/orders"),
        fetch("/api/manapool/sync", { method: "POST" }).catch(() => console.warn("manapool sync failed")),
      ]);

      if (!ordersRes.ok) {
        const body = (await ordersRes.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${ordersRes.status}`);
      }

      const {
        orders: rawOrders,
        master: rawMaster,
        sets: rawSets,
      } = (await ordersRes.json()) as {
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
        const picksRes = await fetch(
          `/api/manapick/picks?session=${encodeURIComponent(sid)}`,
        );
        if (picksRes.ok) {
          const { picks: savedPicks } = (await picksRes.json()) as {
            picks: Record<string, boolean>;
          };
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

      const enrichedMaster = { ...rawMaster };
      for (const [key, card] of Object.entries(allResults)) {
        if (enrichedMaster[key])
          enrichedMaster[key] = { ...enrichedMaster[key]!, scryfall: card };
      }
      setMaster(enrichedMaster);
      setEnrichProgress({ done: 0, total: 0 });

      try {
        const ts = Date.now();
        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({
            orders: rawOrders,
            master: enrichedMaster,
            sets: rawSets,
            cachedAt: ts,
          }),
        );
        setCachedAt(ts);
      } catch {
        // quota exceeded or unavailable — ignore
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
      setEnrichProgress({ done: 0, total: 0 });
    }
  }, []);

  // ── Load TCGPlayer pull sheet CSV ─────────────────────────────────────────

  const handleTcgFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
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
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const { cards } = (await res.json()) as { cards: TcgPullCard[] };

        // Store cards for deduct-from-Manapool feature
        setTcgCards(cards);
        setDeductPreview(null);

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
            // Key: prefer resolved Scryfall set code; fall back to TCGPlayer set name slug
            const setSlug =
              card.setCode ||
              card.setName.toLowerCase().replace(/\s+/g, "-").slice(0, 6);
            const key = `${card.name}|tcg:${card.setName}|${card.collectorNumber}|${card.finish}`;
            if (!next[key]) {
              next[key] = {
                name: card.name,
                set: setSlug,
                collector_number: card.collectorNumber,
                finish: card.finish,
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
          const newSid = [
            ...(Object.keys(next).length > 0
              ? [
                  TCG_ORDER_ID,
                  ...orders
                    .filter((o) => o.id !== TCG_ORDER_ID)
                    .map((o) => o.id),
                ]
              : [TCG_ORDER_ID]),
          ]
            .sort()
            .join("|");
          sessionIdRef.current = newSid;
          setSessionId(newSid);

          return next;
        });

        // Enrich TCGPlayer cards via Scryfall.
        // When a set code was resolved, use set+collector_number for exact printing lookup.
        // Otherwise fall back to cleaned card name.
        const tcgIdentifiers = cards.map((c) => ({
          key: `${c.name}|tcg:${c.setName}|${c.collectorNumber}|${c.finish}`,
          name: c.scryfallName,
          set: c.setCode || undefined,
          collector_number: c.collectorNumber || undefined,
          scryfall_id: undefined,
        }));

        // Add set info for sorting — use resolved code when available
        setSets((prev) => {
          const next = { ...prev };
          for (const c of cards) {
            const code =
              c.setCode ||
              c.setName.toLowerCase().replace(/\s+/g, "-").slice(0, 6);
            if (!next[code]) {
              next[code] = {
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
                const { results } = (await r.json()) as {
                  results: Record<string, ScryfallCard>;
                };
                Object.assign(allResults, results);
              }
            } catch {
              /* continue */
            }
            setEnrichProgress({
              done: Math.min(i + BATCH, tcgIdentifiers.length),
              total: tcgIdentifiers.length,
            });
          }
          setMaster((prev) => {
            const next = { ...prev };
            for (const [key, card] of Object.entries(allResults)) {
              if (next[key])
                next[key] = {
                  ...next[key]!,
                  scryfall: card,
                  scryfall_id: card.id,
                };
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
    },
    [orders],
  );

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
    setTcgCards([]);
    setDeductPreview(null);
    setTcgError(null);
  }, []);

  const handleDeductPreview = useCallback(() => {
    if (tcgCards.length === 0) return;
    deductMutation.mutate(
      { cards: tcgCards, apply: false },
      {
        onSuccess: (result) => {
          setDeductPreview(result);
          setDeductDialogOpen(true);
        },
        onError: (err) => setTcgError(`Deduct preview failed: ${err.message}`),
      },
    );
  }, [tcgCards, deductMutation]);

  const handleDeductApply = useCallback(() => {
    if (tcgCards.length === 0) return;
    deductMutation.mutate(
      { cards: tcgCards, apply: true },
      {
        onSuccess: (result) => {
          setDeductPreview(result);
          // Keep dialog open showing the result
        },
        onError: (err) => setTcgError(`Deduct failed: ${err.message}`),
      },
    );
  }, [tcgCards, deductMutation]);

  const togglePick = useCallback((pk: string) => {
    setPicked((prev) => {
      const newVal = !prev[pk];
      const sid = sessionIdRef.current;
      if (sid) {
        fetch("/api/manapick/picks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session: sid, pickKey: pk, picked: newVal }),
        }).catch(() => console.warn("failed to save pick"));
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
        const r = await fetch(
          `/api/manapick/picks?session=${encodeURIComponent(sid)}`,
        );
        if (r.ok) {
          const { picks } = (await r.json()) as {
            picks: Record<string, boolean>;
          };
          setPicked(picks);
        }
      } catch {
        /* ignore */
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [sessionId, phase]);

  // ── Metrics ───────────────────────────────────────────────────────────────

  const { totalCards, pickedCards } = useMemo(() => {
    let total = 0,
      picked_ = 0;
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

  // ── Fetch eBay pick orders ─────────────────────────────────────────────────

  const fetchEbayOrders = useCallback(async () => {
    setEbayLoading(true);
    setEbayError(null);
    try {
      const res = await fetch("/api/ebay/pick-orders");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const { orders } = (await res.json()) as { orders: EbayPickOrder[] };
      setEbayOrders(orders);
      setEbayPacked({});
    } catch (err) {
      setEbayError(err instanceof Error ? err.message : String(err));
    } finally {
      setEbayLoading(false);
    }
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">ManaPick</h1>
          <p className="text-sm text-muted-foreground">
            Pick &amp; pack helper — Manapool + TCGPlayer, sorted by set, color,
            and collector number
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
              {loading
                ? "Fetching…"
                : isEmpty
                  ? "Fetch Manapool"
                  : "Refresh Manapool"}
            </span>
          </Button>
          {cachedAt !== null && !loading && (
            <span className="text-xs text-muted-foreground">
              Synced {formatRelativeTime(cachedAt)}
            </span>
          )}

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
              {tcgLoading
                ? "Loading…"
                : hasTcg
                  ? "Replace TCGPlayer CSV"
                  : "Add TCGPlayer CSV"}
            </span>
          </Button>

          {hasTcg && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDeductPreview}
              disabled={deductMutation.isPending}
              className="text-orange-600 border-orange-300 hover:bg-orange-50 dark:text-orange-400 dark:border-orange-700 dark:hover:bg-orange-950/30"
            >
              {deductMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MinusCircle className="h-4 w-4" />
              )}
              <span className="ml-1">Deduct from Manapool</span>
            </Button>
          )}

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

          <Button
            variant="outline"
            size="sm"
            onClick={fetchEbayOrders}
            disabled={ebayLoading}
            className="text-purple-600 border-purple-300 hover:bg-purple-50 dark:text-purple-400 dark:border-purple-700 dark:hover:bg-purple-950/30"
          >
            {ebayLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Tag className="h-4 w-4" />
            )}
            <span className="ml-1">
              {ebayLoading
                ? "Loading…"
                : ebayOrders.length > 0
                  ? "Refresh eBay"
                  : "Fetch eBay"}
            </span>
          </Button>

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
                setCachedAt(null);
                localStorage.removeItem(CACHE_KEY);
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
          <button
            onClick={() => setTcgError(null)}
            className="ml-4 underline text-xs opacity-70 hover:opacity-100"
          >
            dismiss
          </button>
        </div>
      )}
      {ebayError && (
        <div className="rounded-md bg-destructive/10 text-destructive border border-destructive/20 px-4 py-3 text-sm flex items-center justify-between">
          <span>eBay: {ebayError}</span>
          <button
            onClick={() => setEbayError(null)}
            className="ml-4 underline text-xs opacity-70 hover:opacity-100"
          >
            dismiss
          </button>
        </div>
      )}

      {/* Enrichment progress */}
      {isEnriching && (
        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">
            Enriching card data… {enrichProgress.done}/{enrichProgress.total}
          </p>
          <Progress
            value={(enrichProgress.done / enrichProgress.total) * 100}
          />
        </div>
      )}

      {/* Empty state */}
      {!loading && isEmpty && !error && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <ShoppingBag className="h-12 w-12 opacity-20" />
          <p className="text-sm text-center max-w-sm">
            Click <strong>Fetch Manapool</strong> to load your paid, unshipped
            Manapool orders, or <strong>Add TCGPlayer CSV</strong> to load a
            TCGPlayer pull sheet.
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
              <div
                key={label}
                className="rounded-lg border bg-card p-3 text-center"
              >
                <p className="text-2xl font-bold tabular-nums">{value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {totalCards > 0 && (
            <Progress
              value={(pickedCards / totalCards) * 100}
              className="h-2"
            />
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
                    <h2 className="text-lg font-bold">
                      {setInfo?.name ?? setCode.toUpperCase()}
                    </h2>
                    {setInfo?.name && (
                      <p className="text-xs text-muted-foreground">
                        {setCode.toUpperCase()}
                      </p>
                    )}
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
                    <span className="font-bold text-foreground">
                      Bin {orderToBin[o.id]}
                    </span>
                    <span className="text-muted-foreground">·</span>
                    <span className="font-mono text-muted-foreground">
                      {o.label ?? o.id.slice(0, 8)}
                    </span>
                    {o.shipping_address?.name && (
                      <span className="text-muted-foreground">
                        — {o.shipping_address.name}
                      </span>
                    )}
                    {o.source === "tcgplayer" && (
                      <span className="text-blue-500 font-medium">
                        TCGPlayer
                      </span>
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
                            <span className="text-sm font-bold">
                              Bin {binNum}
                            </span>
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
                                <p className="text-sm font-medium mt-1">
                                  {addr.name}
                                </p>
                              )}
                              {addr.line1 && (
                                <p className="text-xs text-muted-foreground">
                                  {addr.line1}
                                  {addr.line2 ? `, ${addr.line2}` : ""}
                                </p>
                              )}
                              {(addr.city ||
                                addr.state ||
                                addr.postal_code) && (
                                <p className="text-xs text-muted-foreground">
                                  {[addr.city, addr.state, addr.postal_code]
                                    .filter(Boolean)
                                    .join(", ")}
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

                      {/* Card images for this order */}
                      {(() => {
                        const orderCards = Object.entries(master).filter(
                          ([, e]) => (e.allocations[oid] ?? 0) > 0,
                        );
                        if (orderCards.length === 0) return null;
                        return (
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                            {orderCards.map(([key, entry]) => {
                              const img = entryImageUrl(entry);
                              const qty = entry.allocations[oid] ?? 0;
                              return (
                                <div
                                  key={key}
                                  className="relative flex-shrink-0"
                                >
                                  {img ? (
                                    <img
                                      src={img}
                                      alt={entry.name}
                                      className="w-full rounded-lg block"
                                    />
                                  ) : (
                                    <div className="w-full aspect-[63/88] rounded-lg bg-muted flex items-center justify-center text-[9px] text-muted-foreground px-1 text-center leading-tight">
                                      {entry.name}
                                    </div>
                                  )}
                                  {qty > 1 && (
                                    <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] font-bold rounded px-1 leading-tight">
                                      ×{qty}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}

                      {!isTcg && (
                        <div className="flex gap-2">
                          <Input
                            placeholder="Tracking number (optional)"
                            value={tracking[oid] ?? ""}
                            onChange={(e) =>
                              setTracking((prev) => ({
                                ...prev,
                                [oid]: e.target.value,
                              }))
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
                  <p className="text-sm font-medium">
                    All orders packed &amp; shipped!
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── eBay Orders ──────────────────────────────────────────────────── */}
      {ebayOrders.length > 0 && (
        <div className="space-y-4">
          <Separator />
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-purple-500" />
            <h2 className="text-lg font-bold">eBay Orders</h2>
            <span className="text-sm text-muted-foreground">
              ({ebayOrders.filter((o) => !ebayPacked[o.id]).length} pending)
            </span>
          </div>

          {ebayOrders
            .filter((o) => !ebayPacked[o.id])
            .map((order) => (
              <div
                key={order.id}
                className="rounded-lg border bg-card p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs font-mono text-muted-foreground">
                    {order.id.length > 14
                      ? `${order.id.slice(0, 14)}…`
                      : order.id}
                    <span className="ml-2 text-muted-foreground/60">
                      · {order.lineItems.length} item
                      {order.lineItems.length !== 1 ? "s" : ""}
                    </span>
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0"
                    onClick={() =>
                      setEbayPacked((prev) => ({ ...prev, [order.id]: true }))
                    }
                  >
                    Mark Packed
                  </Button>
                </div>

                <div className="space-y-2">
                  {order.lineItems.map((item, i) => (
                    <div key={i} className="flex items-center gap-3">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.title}
                          className="w-16 h-16 object-cover rounded-md border shrink-0"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-md border bg-muted flex items-center justify-center shrink-0">
                          <Tag className="h-5 w-5 text-muted-foreground opacity-50" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-tight line-clamp-3">
                          {item.title}
                        </p>
                        {item.quantity > 1 && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            ×{item.quantity}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

          {ebayOrders.every((o) => ebayPacked[o.id]) && (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
              <CheckCircle2 className="h-8 w-8 text-green-500 opacity-80" />
              <p className="text-sm font-medium">All eBay orders packed!</p>
            </div>
          )}
        </div>
      )}

      {/* ── Deduct from Manapool preview dialog ─────────────────────────── */}
      <Dialog open={deductDialogOpen} onOpenChange={setDeductDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MinusCircle className="h-5 w-5 text-orange-500" />
              {deductPreview?.applied
                ? "Manapool quantities updated"
                : "Preview: Deduct from Manapool"}
            </DialogTitle>
          </DialogHeader>

          {deductPreview && (
            <div className="flex-1 overflow-y-auto space-y-4 text-sm">
              <div className="grid grid-cols-3 gap-3">
                {[
                  {
                    label: "Will update",
                    value: deductPreview.plan.filter(
                      (r) => r.newQuantity !== r.currentQuantity,
                    ).length,
                  },
                  {
                    label: "No change needed",
                    value: deductPreview.plan.filter(
                      (r) => r.newQuantity === r.currentQuantity,
                    ).length,
                  },
                  {
                    label: "Not on Manapool",
                    value: deductPreview.notFound.length,
                  },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    className="rounded-lg border bg-muted/40 p-3 text-center"
                  >
                    <p className="text-xl font-bold tabular-nums">{value}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {label}
                    </p>
                  </div>
                ))}
              </div>

              {deductPreview.plan.filter(
                (r) => r.newQuantity !== r.currentQuantity,
              ).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    Quantity changes
                  </p>
                  <div className="rounded-lg border divide-y">
                    {deductPreview.plan
                      .filter((r) => r.newQuantity !== r.currentQuantity)
                      .map((row) => (
                        <div
                          key={row.tcgplayerSku}
                          className="flex items-center justify-between px-3 py-2 gap-3"
                        >
                          <span className="font-medium truncate flex-1">
                            {row.name}
                          </span>
                          <div className="flex items-center gap-2 shrink-0 text-xs tabular-nums">
                            {row.status === "insufficient" && (
                              <span className="text-amber-600 dark:text-amber-400">
                                (low stock)
                              </span>
                            )}
                            <span className="text-muted-foreground">
                              {row.currentQuantity}
                            </span>
                            <span className="text-muted-foreground">→</span>
                            <span
                              className={`font-bold ${row.newQuantity === 0 ? "text-red-600 dark:text-red-400" : "text-foreground"}`}
                            >
                              {row.newQuantity}
                            </span>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {deductPreview.notFound.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    Not found in Manapool inventory
                  </p>
                  <div className="rounded-lg border divide-y">
                    {deductPreview.notFound.map((item) => (
                      <div
                        key={item.tcgplayerSku}
                        className="px-3 py-2 text-xs text-muted-foreground"
                      >
                        {item.name}{" "}
                        <span className="opacity-50">
                          (SKU {item.tcgplayerSku})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {deductPreview.applied && (
                <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-4 py-3 text-green-700 dark:text-green-400 text-sm font-medium">
                  ✓ {deductPreview.updated} listing
                  {deductPreview.updated !== 1 ? "s" : ""} updated on Manapool.
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setDeductDialogOpen(false)}
            >
              {deductPreview?.applied ? "Done" : "Cancel"}
            </Button>
            {!deductPreview?.applied &&
              deductPreview &&
              deductPreview.plan.filter(
                (r) => r.newQuantity !== r.currentQuantity,
              ).length > 0 && (
                <Button
                  onClick={handleDeductApply}
                  disabled={deductMutation.isPending}
                  className="bg-orange-600 hover:bg-orange-700 text-white"
                >
                  {deductMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Updating…
                    </>
                  ) : (
                    <>
                      Apply{" "}
                      {
                        deductPreview.plan.filter(
                          (r) => r.newQuantity !== r.currentQuantity,
                        ).length
                      }{" "}
                      changes
                    </>
                  )}
                </Button>
              )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
