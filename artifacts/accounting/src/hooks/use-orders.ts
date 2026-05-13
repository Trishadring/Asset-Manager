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

  return useMutation<{ message: string; upserted: number; total: number }, Error, void>({
    mutationFn: async () => {
      const res = await fetch(`${getBaseUrl()}/api/manapool/sync`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Failed to sync orders");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["weekly"] });
    },
  });
}

export function useInspectOrder() {
  return useMutation<unknown, Error, void>({
    mutationFn: async () => {
      const res = await fetch(`${getBaseUrl()}/api/manapool/inspect`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Inspect failed");
      }
      return res.json();
    },
  });
}
