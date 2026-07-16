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
import {
  useDeductFromManapool,
  type TcgPullCard,
  type DeductionResult,
} from "@/hooks/use-tcgplayer";
import type {
  Order,
  Master,
  SetsMap,
  EbayPickOrder,
  ScryfallCard,
  MasterEntry,
} from "./types";
import { colorSortIndex, parseCollectorNumber } from "./utils";
import type { SetGroup } from "./PickView";

type Phase = "pick" | "pack";

const CACHE_KEY = "manapick-cache";
const DEDUCTED_SKUS_KEY = "manapick-deducted-skus";

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
  tcgError: string | null;
  tcgLoading: boolean;
  ebayOrders: EbayPickOrder[];
  ebayLoading: boolean;
  ebayError: string | null;
  ebayPacked: Record<string, boolean>;
  tcgCards: TcgPullCard[];
  deductPreview: DeductionResult | null;
  deductDialogOpen: boolean;
  deductMutation: ReturnType<typeof useDeductFromManapool>;
  deductedSkus: Set<number>;
  totalCards: number;
  pickedCards: number;
  setGroups: SetGroup[];
  isEmpty: boolean;
  isEnriching: boolean;
  hasTcg: boolean;
  tcgFileInputRef: React.RefObject<HTMLInputElement | null>;
  fetchOrders: () => Promise<void>;
  handleTcgFile: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  removeTcgCards: () => void;
  handleDeductPreview: () => void;
  handleDeductApply: () => void;
  togglePick: (pk: string) => void;
  shipOrder: (oid: string) => Promise<void>;
  handleTrackingChange: (oid: string, value: string) => void;
  fetchEbayOrders: () => Promise<void>;
  setPhase: (phase: Phase) => void;
  clearAll: () => void;
  setEbayPacked: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setDeductDialogOpen: (open: boolean) => void;
  setTcgError: React.Dispatch<React.SetStateAction<string | null>>;
  setEbayError: React.Dispatch<React.SetStateAction<string | null>>;
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
  const [tcgError, setTcgError] = useState<string | null>(null);
  const [tcgLoading, setTcgLoading] = useState(false);
  const [tcgCards, setTcgCards] = useState<TcgPullCard[]>([]);
  const [deductPreview, setDeductPreview] = useState<DeductionResult | null>(
    null,
  );
  const [deductDialogOpen, setDeductDialogOpen] = useState(false);
  const deductMutation = useDeductFromManapool();
  const [deductedSkus, setDeductedSkus] = useState<Set<number>>(() => {
    try {
      const raw = localStorage.getItem(DEDUCTED_SKUS_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });

  const persistDeductedSkus = useCallback((skus: Set<number>) => {
    localStorage.setItem(DEDUCTED_SKUS_KEY, JSON.stringify([...skus]));
  }, []);
  const [ebayOrders, setEbayOrders] = useState<EbayPickOrder[]>([]);
  const [ebayLoading, setEbayLoading] = useState(false);
  const [ebayError, setEbayError] = useState<string | null>(null);
  const [ebayPacked, setEbayPacked] = useState<Record<string, boolean>>({});
  const sessionIdRef = useRef("");
  const tcgFileInputRef = useRef<HTMLInputElement>(null);
  const tcgCardsRef = useRef<TcgPullCard[]>([]);

  // Restore from localStorage cache on mount
  const restoredRef = useRef(false);
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
      restoredRef.current = true;

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

  // Auto-fetch orders on mount (skip if cache was restored with data)
  useEffect(() => {
    if (!restoredRef.current) fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    setEnrichProgress({ done: 0, total: 0 });

    const tcgCardsAtStart = tcgCardsRef.current;

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

      // Re-merge TCGPlayer data that was loaded before sync
      if (tcgCardsAtStart.length > 0) {
        const TCG_ORDER_ID = "tcgplayer-pullsheet";
        setOrders((prev) => {
          if (prev.some((o) => o.id === TCG_ORDER_ID)) return prev;
          return [
            ...prev,
            { id: TCG_ORDER_ID, label: "TCGPlayer", source: "tcgplayer" },
          ];
        });
        setOrderToBin((prev) => {
          if (prev[TCG_ORDER_ID]) return prev;
          const maxBin = Math.max(0, ...Object.values(prev));
          return { ...prev, [TCG_ORDER_ID]: maxBin + 1 };
        });
        setMaster((prev) => {
          const next = { ...prev };
          for (const card of tcgCardsAtStart) {
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
          return next;
        });
        setSets((prev) => {
          const next = { ...prev };
          for (const card of tcgCardsAtStart) {
            const code =
              card.setCode ||
              card.setName.toLowerCase().replace(/\s+/g, "-").slice(0, 6);
            if (!next[code]) {
              next[code] = {
                name: card.setName,
                released_at: card.setReleaseDate || "1900-01-01",
              };
            }
          }
          return next;
        });
        // Update sessionId to include TCG data
        const tcgSid = [...rawOrders.map((o) => o.id), TCG_ORDER_ID]
          .sort()
          .join("|");
        sessionIdRef.current = tcgSid;
        setSessionId(tcgSid);
      }

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
      if (cardKeys.length === 0 && tcgCardsAtStart.length === 0) return;

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
        const tcgMergedOrders = rawOrders.map((o) => ({
          ...o,
          shipping_address: undefined,
        }));
        if (tcgCardsAtStart.length > 0) {
          const TCG_ORDER_ID = "tcgplayer-pullsheet";
          if (!tcgMergedOrders.some((o) => o.id === TCG_ORDER_ID)) {
            tcgMergedOrders.push({
              id: TCG_ORDER_ID,
              label: "TCGPlayer",
              source: "tcgplayer",
              shipping_address: undefined,
            });
          }
        }
        const tcgMergedMaster = { ...enrichedMaster };
        for (const card of tcgCardsAtStart) {
          const setSlug =
            card.setCode ||
            card.setName.toLowerCase().replace(/\s+/g, "-").slice(0, 6);
          const key = `${card.name}|tcg:${card.setName}|${card.collectorNumber}|${card.finish}`;
          if (!tcgMergedMaster[key]) {
            tcgMergedMaster[key] = {
              name: card.name,
              set: setSlug,
              collector_number: card.collectorNumber,
              finish: card.finish,
              quantity: 0,
              allocations: {},
              source: "tcgplayer",
            };
          }
          tcgMergedMaster[key].quantity += card.orderQuantity;
          tcgMergedMaster[key].allocations["tcgplayer-pullsheet"] =
            (tcgMergedMaster[key].allocations["tcgplayer-pullsheet"] ?? 0) +
            card.orderQuantity;
        }
        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({
            orders: tcgMergedOrders,
            master: tcgMergedMaster,
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

        setTcgCards(cards);
        tcgCardsRef.current = cards;
        setDeductPreview(null);

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

        const tcgIdentifiers = cards.map((c) => ({
          key: `${c.name}|tcg:${c.setName}|${c.collectorNumber}|${c.finish}`,
          name: c.scryfallName,
          set: c.setCode || undefined,
          collector_number: c.collectorNumber || undefined,
          scryfall_id: undefined as string | undefined,
        }));

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
    tcgCardsRef.current = [];
    setDeductPreview(null);
    setTcgError(null);
  }, []);

  const handleDeductPreview = useCallback(() => {
    if (tcgCards.length === 0) return;
    const remaining = tcgCards.filter(
      (c) => c.tcgplayerSku === null || !deductedSkus.has(c.tcgplayerSku),
    );
    if (remaining.length === 0) {
      setTcgError("All cards in this CSV have already been deducted.");
      return;
    }
    deductMutation.mutate(
      { cards: remaining, apply: false },
      {
        onSuccess: (result) => {
          setDeductPreview(result);
          setDeductDialogOpen(true);
        },
        onError: (err) => setTcgError(`Deduct preview failed: ${err.message}`),
      },
    );
  }, [tcgCards, deductMutation, deductedSkus]);

  const handleDeductApply = useCallback(() => {
    if (tcgCards.length === 0) return;
    const remaining = tcgCards.filter(
      (c) => c.tcgplayerSku === null || !deductedSkus.has(c.tcgplayerSku),
    );
    deductMutation.mutate(
      { cards: remaining, apply: true },
      {
        onSuccess: (result) => {
          setDeductPreview(result);
          const newlyDeducted = new Set(deductedSkus);
          for (const row of result.plan) {
            if (row.newQuantity !== row.currentQuantity) {
              newlyDeducted.add(row.tcgplayerSku);
            }
          }
          setDeductedSkus(newlyDeducted);
          persistDeductedSkus(newlyDeducted);
        },
        onError: (err) => setTcgError(`Deduct failed: ${err.message}`),
      },
    );
  }, [tcgCards, deductMutation, deductedSkus, persistDeductedSkus]);

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

  const fetchEbayOrders = useCallback(async () => {
    setEbayLoading(true);
    setEbayError(null);
    try {
      const res = await fetch("/api/ebay/pick-orders");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const { orders: fetchedOrders } = (await res.json()) as {
        orders: EbayPickOrder[];
      };
      setEbayOrders(fetchedOrders);
      setEbayPacked({});
    } catch (err) {
      setEbayError(err instanceof Error ? err.message : String(err));
    } finally {
      setEbayLoading(false);
    }
  }, []);

  const clearAll = useCallback(() => {
    setOrders([]);
    setMaster({});
    setPicked({});
    setShipped({});
    setOrderToBin({});
    setTcgError(null);
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
    tcgError,
    tcgLoading,
    ebayOrders,
    ebayLoading,
    ebayError,
    ebayPacked,
    tcgCards,
    deductPreview,
    deductDialogOpen,
    deductMutation,
    deductedSkus,
    totalCards,
    pickedCards,
    setGroups,
    isEmpty,
    isEnriching,
    hasTcg,
    tcgFileInputRef,
    fetchOrders,
    handleTcgFile,
    removeTcgCards,
    handleDeductPreview,
    handleDeductApply,
    togglePick,
    shipOrder,
    handleTrackingChange,
    fetchEbayOrders,
    setPhase,
    clearAll,
    setEbayPacked,
    setDeductDialogOpen,
    setTcgError,
    setEbayError,
  };

  return (
    <OrdersContext.Provider value={value}>{children}</OrdersContext.Provider>
  );
}
