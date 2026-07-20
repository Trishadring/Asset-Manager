import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiQuery, apiFetch } from "./use-api";

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
