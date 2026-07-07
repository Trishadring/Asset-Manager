import { ManapoolOrder } from "@/lib/types";
import { useApiQuery, useApiPost } from "./use-api";

export function useOrders() {
  return useApiQuery<ManapoolOrder[]>(["orders"], "/api/orders");
}

export function useSyncOrders() {
  return useApiPost<{ message: string; upserted: number; total: number }>(
    "/api/manapool/sync",
    [["orders"], ["dashboard"], ["weekly"]],
  );
}

export function useInspectOrder() {
  return useApiPost<unknown>("/api/manapool/inspect");
}
