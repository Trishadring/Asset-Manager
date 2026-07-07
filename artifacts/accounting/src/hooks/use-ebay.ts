import { useQuery } from "@tanstack/react-query";
import { EbayOrder } from "@/lib/types";
import { useApiQuery, useApiPost } from "./use-api";

export function useEbayAuthUrl() {
  return useQuery<{ url: string } | null>({
    queryKey: ["ebay-auth-url"],
    queryFn: async () => {
      const res = await fetch("/api/ebay/auth-url");
      if (!res.ok) return null;
      return res.json();
    },
    retry: false,
  });
}

export function useEbayOrders() {
  return useApiQuery<EbayOrder[]>(["ebay-orders"], "/api/ebay/orders");
}

export function useSyncEbayOrders() {
  return useApiPost<{ message: string; upserted: number; total: number }>(
    "/api/ebay/sync",
    [["ebay-orders"], ["dashboard"], ["weekly"]],
  );
}
