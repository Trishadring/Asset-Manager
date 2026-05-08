import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardStats, Purchase } from "@/lib/types";

const getBaseUrl = () => "";

export function useDashboard() {
  return useQuery<DashboardStats>({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const res = await fetch(`${getBaseUrl()}/api/dashboard`);
      if (!res.ok) throw new Error("Failed to fetch dashboard");
      return res.json();
    },
  });
}

export function usePurchases() {
  return useQuery<Purchase[]>({
    queryKey: ["purchases"],
    queryFn: async () => {
      const res = await fetch(`${getBaseUrl()}/api/purchases`);
      if (!res.ok) throw new Error("Failed to fetch purchases");
      return res.json();
    },
  });
}

export function useCreatePurchase() {
  const queryClient = useQueryClient();
  
  return useMutation<Purchase, Error, { description: string; amount: number; date?: string }>({
    mutationFn: async (data) => {
      const res = await fetch(`${getBaseUrl()}/api/purchases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create purchase");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchases"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDeletePurchase() {
  const queryClient = useQueryClient();
  
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const res = await fetch(`${getBaseUrl()}/api/purchases/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete purchase");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchases"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
