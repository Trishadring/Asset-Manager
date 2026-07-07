import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiQuery, useApiPost, apiFetch } from "./use-api";

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
  return useApiQuery<TcgplayerOrder[]>(["tcgplayer-orders"], "/api/tcgplayer/orders");
}

export function useImportTcgplayerOrders() {
  const queryClient = useQueryClient();
  return useMutation<{ message: string; upserted: number }, Error, string>({
    mutationFn: (csv) => apiFetch("/api/tcgplayer/import-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tcgplayer-orders"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["weekly"] });
    },
  });
}

export function useParseTcgplayerPullSheet() {
  return useMutation<{ cards: TcgPullCard[] }, Error, string>({
    mutationFn: (csv) => apiFetch("/api/tcgplayer/parse-pullsheet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv }),
    }),
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
    mutationFn: ({ cards, apply }) => apiFetch("/api/tcgplayer/deduct-manapool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cards, apply }),
    }),
  });
}
