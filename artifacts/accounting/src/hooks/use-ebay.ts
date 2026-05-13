import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { EbayOrder } from "@/lib/types";

const getBaseUrl = () => "";

export function useEbayAuthUrl() {
  return useQuery<{ url: string } | null>({
    queryKey: ["ebay-auth-url"],
    queryFn: async () => {
      const res = await fetch(`${getBaseUrl()}/api/ebay/auth-url`);
      if (!res.ok) return null;
      return res.json();
    },
    retry: false,
  });
}

export function useEbayOrders() {
  return useQuery<EbayOrder[]>({
    queryKey: ["ebay-orders"],
    queryFn: async () => {
      const res = await fetch(`${getBaseUrl()}/api/ebay/orders`);
      if (!res.ok) throw new Error("Failed to fetch eBay orders");
      return res.json();
    },
  });
}

export function useSyncEbayOrders() {
  const queryClient = useQueryClient();

  return useMutation<{ message: string; upserted: number; total: number }, Error, void>({
    mutationFn: async () => {
      const res = await fetch(`${getBaseUrl()}/api/ebay/sync`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Sync failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ebay-orders"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["weekly"] });
    },
  });
}
