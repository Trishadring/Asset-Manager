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
import { useQueryClient } from "@tanstack/react-query";
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

const CACHE_KEY = "manapick-cache-v2";

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

export function OrdersProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
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

  // Restore from localStorage cache on mount
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

  // Cached orders omit addresses, so always refresh the full order data.
  useEffect(() => {
    fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    setEnrichProgress({ done: 0, total: 0 });

    try {
      const [ordersRes] = await Promise.all([
        fetch("/api/manapick/orders"),
        fetch("/api/manapool/sync", { method: "POST" })
          .then(async (syncRes) => {
            if (!syncRes.ok) throw new Error(`HTTP ${syncRes.status}`);
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ["orders"] }),
              queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
              queryClient.invalidateQueries({ queryKey: ["weekly"] }),
            ]);
          })
          .catch(() => console.warn("manapool sync failed")),
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
        const cachedOrders = rawOrders.map((o) => ({
          ...o,
          shipping_address: undefined,
        }));
        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({
            orders: cachedOrders,
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
  }, [queryClient]);

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

  // Cross-device sync
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracking_number: tn }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
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
    setOrders([]);
    setMaster({});
    setPicked({});
    setShipped({});
    setOrderToBin({});
    setCachedAt(null);
    localStorage.removeItem(CACHE_KEY);
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
