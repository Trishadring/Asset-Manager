import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const getBaseUrl = () => "";

export interface TcgplayerOrder {
  id: string;
  date: string;
  buyerName: string | null;
  status: string | null;
  productAmt: number;
  shippingAmt: number;
  totalAmt: number;
  platformFees: number;
  netPayout: number;
  itemCount: number;
}

export function useTcgplayerOrders() {
  return useQuery<TcgplayerOrder[]>({
    queryKey: ["tcgplayer-orders"],
    queryFn: async () => {
      const res = await fetch(`${getBaseUrl()}/api/tcgplayer/orders`);
      if (!res.ok) throw new Error("Failed to fetch TCGPlayer orders");
      return res.json();
    },
  });
}

export function useImportTcgplayerOrders() {
  const queryClient = useQueryClient();
  return useMutation<{ message: string; upserted: number }, Error, string>({
    mutationFn: async (csv: string) => {
      const res = await fetch(`${getBaseUrl()}/api/tcgplayer/import-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Import failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tcgplayer-orders"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["weekly"] });
    },
  });
}

export function useParseTcgplayerPullSheet() {
  return useMutation<{ cards: TcgPullCard[] }, Error, string>({
    mutationFn: async (csv: string) => {
      const res = await fetch(`${getBaseUrl()}/api/tcgplayer/parse-pullsheet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Parse failed");
      }
      return res.json();
    },
  });
}

export interface TcgPullCard {
  name: string;
  scryfallName: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  finish: "foil" | "nonfoil";
  quantity: number;
  orderQuantity: number;
  imageUrl: string;
  setReleaseDate: string;
  tcgplayerSku: number | null;
}

export interface DeductionRow {
  name: string;
  tcgplayerSku: number;
  orderQuantity: number;
  currentQuantity: number;
  newQuantity: number;
  priceCents: number;
  inventoryId: string;
  status: "ok" | "insufficient";
}

export interface DeductionResult {
  preview: boolean;
  applied?: boolean;
  updated?: number;
  plan: DeductionRow[];
  notFound: Array<{ name: string; tcgplayerSku: number }>;
}

export function useDeductFromManapool() {
  return useMutation<DeductionResult, Error, { cards: TcgPullCard[]; apply: boolean }>({
    mutationFn: async ({ cards, apply }) => {
      const res = await fetch(`${getBaseUrl()}/api/tcgplayer/deduct-manapool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cards, apply }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Deduct failed");
      }
      return res.json();
    },
  });
}
