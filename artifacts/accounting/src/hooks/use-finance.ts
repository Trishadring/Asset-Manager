import { DashboardStats, Purchase, WeeklyStats, CustomSale } from "@/lib/types";
import { useApiQuery, useApiPost, useApiDelete } from "./use-api";

export function useDashboard() {
  return useApiQuery<DashboardStats>(["dashboard"], "/api/dashboard");
}

export function usePurchases() {
  return useApiQuery<Purchase[]>(["purchases"], "/api/purchases");
}

export function useCreatePurchase() {
  return useApiPost<Purchase, { description: string; amount: number; date?: string }>(
    "/api/purchases",
    [["purchases"], ["dashboard"]],
  );
}

export function useCustomSales() {
  return useApiQuery<CustomSale[]>(["sales"], "/api/sales");
}

export function useCreateCustomSale() {
  return useApiPost<CustomSale, { description: string; amount: number; date?: string; notes?: string }>(
    "/api/sales",
    [["sales"], ["dashboard"], ["weekly"]],
  );
}

export function useDeleteCustomSale() {
  return useApiDelete("/api/sales/:id", [["sales"], ["dashboard"], ["weekly"]]);
}

export function useWeeklyStats() {
  return useApiQuery<WeeklyStats[]>(["weekly"], "/api/weekly");
}

export function useSyncEbayShipping() {
  return useApiPost<{ message: string; synced: number; total: number }>(
    "/api/ebay/sync-shipping",
    [["purchases"], ["dashboard"]],
  );
}

export function useDeletePurchase() {
  return useApiDelete("/api/purchases/:id", [["purchases"], ["dashboard"]]);
}
