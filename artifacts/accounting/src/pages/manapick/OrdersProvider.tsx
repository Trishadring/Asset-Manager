import {
  createContext,
  useContext,
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { toast } from "@/hooks/use-toast";
import type {
  Order,
  Master,
  SetsMap,
  ScryfallCard,
  MasterEntry,
} from "./types";
import { colorSortIndex, isBasicLand, isToken, parseCollectorNumber } from "./utils";
import type { SetGroup } from "./PickView";

type Phase = "pick" | "pack";

const LEGACY_CACHE_KEY = "manapick-cache-v2";
const PICK_CACHE_KEY = "manapick-picks-v1";

function readSavedPicks(session: string): Record<string, boolean> {
  if (!session) return {};
  try {
    const raw = localStorage.getItem(PICK_CACHE_KEY);
    const allPicks = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const saved = allPicks[session];
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    return Object.fromEntries(
      Object.entries(saved as Record<string, unknown>).filter(
        ([, value]) => typeof value === "boolean",
      ),
    ) as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeSavedPicks(session: string, picks: Record<string, boolean>) {
  if (!session) return;
  try {
    const raw = localStorage.getItem(PICK_CACHE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const allPicks =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, Record<string, boolean>>)
        : {};
    allPicks[session] = picks;
    localStorage.setItem(PICK_CACHE_KEY, JSON.stringify(allPicks));
  } catch {
    // Local storage may be unavailable or full.
  }
}

function removeSavedPicks(session: string) {
  if (!session) return;
  try {
    const raw = localStorage.getItem(PICK_CACHE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    delete (parsed as Record<string, unknown>)[session];
    localStorage.setItem(PICK_CACHE_KEY, JSON.stringify(parsed));
  } catch {
    // Local storage may be unavailable.
  }
}

function clearLegacyOrderCache() {
  try {
    localStorage.removeItem(LEGACY_CACHE_KEY);
  } catch {
    // Local storage may be unavailable.
  }
}

interface OrdersContextValue {
  orders: Order[];
  master: Master;
  sets: SetsMap;
  orderToBin: Record<string, number>;
  picked: Record<string, boolean>;
  shipped: Record<string, boolean>;
  phase: Phase;
  tracking: Record<string, string>;
  sessionId: string;
  cachedAt: number | null;
  loading: boolean;
  enrichProgress: { done: number; total: number };
  error: string | null;
  totalCards: number;
  pickedCards: number;
  setGroups: SetGroup[];
  isEmpty: boolean;
  isEnriching: boolean;
  fetchOrders: () => Promise<void>;
  togglePick: (pk: string) => void;
  shipOrder: (oid: string) => Promise<void>;
  handleTrackingChange: (oid: string, value: string) => void;
  setPhase: (phase: Phase) => void;
  clearAll: () => void;
}

const OrdersContext = createContext<OrdersContextValue | null>(null);

export function useOrders(): OrdersContextValue {
  const ctx = useContext(OrdersContext);
  if (!ctx) throw new Error("useOrders must be used within OrdersProvider");
  return ctx;
}

export function OrdersProvider({
  children,
  onAccessExpired,
}: {
  children: ReactNode;
  onAccessExpired: () => void;
}) {
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
  const [enrichProgress, setEnrichProgress] = useState({
    done: 0,
    total: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef("");
  const pickedRef = useRef<Record<string, boolean>>({});

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    setEnrichProgress({ done: 0, total: 0 });

    try {
      const ordersRes = await fetch("/api/manapick/orders", {
        cache: "no-store",
        credentials: "same-origin",
      });

      if (!ordersRes.ok) {
        const body = (await ordersRes.json().catch(() => ({}))) as {
          error?: string;
        };
        if (ordersRes.status === 401) onAccessExpired();
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
      const savedPicks = readSavedPicks(sid);
      pickedRef.current = savedPicks;
      setPicked(savedPicks);
      setCachedAt(Date.now());

      setOrders(rawOrders);
      setMaster(rawMaster);
      setSets(rawSets);
      setOrderToBin(binMap);
      setShipped({});
      setLoading(false);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
      setEnrichProgress({ done: 0, total: 0 });
    }
  }, [onAccessExpired]);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  const togglePick = useCallback((pk: string) => {
    const nextPicks = { ...pickedRef.current, [pk]: !pickedRef.current[pk] };
    pickedRef.current = nextPicks;
    setPicked(nextPicks);
    writeSavedPicks(sessionIdRef.current, nextPicks);
  }, []);

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

  const setGroups: SetGroup[] = useMemo(() => {
    const bySet: Record<string, Array<[string, MasterEntry]>> = {};
    const basicLands: Array<[string, MasterEntry]> = [];
    const tokens: Array<[string, MasterEntry]> = [];
    for (const [key, entry] of Object.entries(master)) {
      if (isBasicLand(entry)) {
        basicLands.push([key, entry]);
        continue;
      }
      if (isToken(entry)) {
        tokens.push([key, entry]);
        continue;
      }
      const setKey = entry.set;
      if (!bySet[setKey]) bySet[setKey] = [];
      bySet[setKey]!.push([key, entry]);
    }
    const groups = Object.entries(bySet)
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
    if (tokens.length > 0) {
      groups.push({
        setCode: "tokens",
        setInfo: { name: "Tokens", released_at: "" },
        cards: tokens.sort(([, a], [, b]) =>
          a.name.localeCompare(b.name) || a.set.localeCompare(b.set),
        ),
      });
    }
    if (basicLands.length > 0) {
      groups.push({
        setCode: "basic-lands",
        setInfo: { name: "Basic Lands", released_at: "" },
        cards: basicLands.sort(([, a], [, b]) =>
          a.name.localeCompare(b.name) || a.set.localeCompare(b.set),
        ),
      });
    }
    return groups;
  }, [master, sets]);

  const isEmpty = Object.keys(master).length === 0;
  const isEnriching = enrichProgress.total > 0;

  async function shipOrder(oid: string) {
    const tn = tracking[oid] ?? "";
    try {
      const r = await fetch(`/api/manapick/orders/${oid}/ship`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tracking_number: tn }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        if (r.status === 401) onAccessExpired();
        toast({ variant: "destructive", title: "Failed to ship", description: body.error ?? `HTTP ${r.status}` });
        return;
      }
      setShipped((prev) => ({ ...prev, [oid]: true }));
      toast({ title: "Shipped", description: "Order marked as shipped" });
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to ship", description: String(err) });
    }
  }

  const handleTrackingChange = useCallback((oid: string, value: string) => {
    setTracking((prev) => ({ ...prev, [oid]: value }));
  }, []);

  const clearAll = useCallback(() => {
    removeSavedPicks(sessionIdRef.current);
    sessionIdRef.current = "";
    pickedRef.current = {};
    setSessionId("");
    setOrders([]);
    setMaster({});
    setPicked({});
    setShipped({});
    setOrderToBin({});
    setCachedAt(null);
    setTracking({});
    clearLegacyOrderCache();
  }, []);

  const value: OrdersContextValue = {
    orders,
    master,
    sets,
    orderToBin,
    picked,
    shipped,
    phase,
    tracking,
    sessionId,
    cachedAt,
    loading,
    enrichProgress,
    error,
    totalCards,
    pickedCards,
    setGroups,
    isEmpty,
    isEnriching,
    fetchOrders,
    togglePick,
    shipOrder,
    handleTrackingChange,
    setPhase,
    clearAll,
  };

  return (
    <OrdersContext.Provider value={value}>{children}</OrdersContext.Provider>
  );
}
