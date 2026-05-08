import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ManapoolOrder } from "@/lib/types";

const getBaseUrl = () => "";

export function useOrders() {
  return useQuery<ManapoolOrder[]>({
    queryKey: ["orders"],
    queryFn: async () => {
      const res = await fetch(`${getBaseUrl()}/api/orders`);
      if (!res.ok) throw new Error("Failed to fetch orders");
      return res.json();
    },
  });
}

export function useSyncOrders() {
  const queryClient = useQueryClient();
  
  return useMutation<{ message: string; upserted: number; total: number }, Error, { email: string; token: string }>({
    mutationFn: async (data) => {
      const res = await fetch(`${getBaseUrl()}/api/manapool/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || "Failed to sync orders");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useInspectOrder() {
  return useMutation<unknown, Error, { email: string; token: string }>({
    mutationFn: async (data) => {
      const res = await fetch(`${getBaseUrl()}/api/manapool/inspect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || "Inspect failed");
      }
      return res.json();
    },
  });
}
