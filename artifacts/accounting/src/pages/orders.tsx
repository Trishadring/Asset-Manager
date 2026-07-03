import { useState, useRef } from "react";
import { format } from "date-fns";
import { RefreshCw, Search, Upload, X } from "lucide-react";

import { useOrders, useSyncOrders, useInspectOrder } from "@/hooks/use-orders";
import { useEbayOrders, useSyncEbayOrders, useEbayAuthUrl } from "@/hooks/use-ebay";
import { useTcgplayerOrders, useImportTcgplayerOrders } from "@/hooks/use-tcgplayer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

type Tab = "manapool" | "ebay" | "tcgplayer";

export default function Orders() {
  const [activeTab, setActiveTab] = useState<Tab>("manapool");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: mpOrders, isLoading: mpLoading } = useOrders();
  const syncOrders = useSyncOrders();
  const inspectOrder = useInspectOrder();

  const { data: ebayOrders, isLoading: ebayLoading } = useEbayOrders();
  const syncEbay = useSyncEbayOrders();
  const { data: ebayAuthData } = useEbayAuthUrl();

  const { data: tcgOrders, isLoading: tcgLoading } = useTcgplayerOrders();
  const importTcg = useImportTcgplayerOrders();

  const { toast } = useToast();
  const [inspectResult, setInspectResult] = useState<Record<string, unknown> | null>(null);

  const handleMpSync = () => {
    syncOrders.mutate(undefined, {
      onSuccess: (data) => toast({ title: "Sync complete", description: data.message }),
      onError: (err) => toast({ variant: "destructive", title: "Sync failed", description: err.message }),
    });
  };

  const handleEbaySync = () => {
    syncEbay.mutate(undefined, {
      onSuccess: (data) => toast({ title: "eBay sync complete", description: data.message }),
      onError: (err) => toast({ variant: "destructive", title: "eBay sync failed", description: err.message }),
    });
  };

  const handleTcgFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const csv = ev.target?.result as string;
      importTcg.mutate(csv, {
        onSuccess: (data) => toast({ title: "Import complete", description: data.message }),
        onError: (err) => toast({ variant: "destructive", title: "Import failed", description: err.message }),
      });
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "manapool", label: "Manapool" },
    { id: "ebay", label: "eBay" },
    { id: "tcgplayer", label: "TCGPlayer" },
  ];

  const tabCount = (id: Tab) => {
    if (id === "manapool") return mpOrders?.length ?? 0;
    if (id === "ebay") return ebayOrders?.length ?? 0;
    return tcgOrders?.length ?? 0;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Orders</h2>
          <p className="text-muted-foreground mt-1">Sync and review your platform sales.</p>
        </div>

        {activeTab === "manapool" && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                inspectOrder.mutate(undefined, {
                  onSuccess: (data) => {
                    setInspectResult(data as Record<string, unknown>);
                    toast({ title: "Inspect complete — see panel below" });
                  },
                  onError: (err) => toast({ variant: "destructive", title: "Inspect failed", description: err.message }),
                });
              }}
              disabled={inspectOrder.isPending}
              data-testid="button-inspect-order"
            >
              <Search className="mr-1 h-3.5 w-3.5" />
              {inspectOrder.isPending ? "Inspecting…" : "Inspect"}
            </Button>
            <Button onClick={handleMpSync} disabled={syncOrders.isPending} data-testid="button-sync-orders">
              <RefreshCw className={`mr-2 h-4 w-4 ${syncOrders.isPending ? "animate-spin" : ""}`} />
              {syncOrders.isPending ? "Syncing..." : "Sync Orders"}
            </Button>
          </div>
        )}

        {activeTab === "ebay" && (
          <div className="flex gap-2">
            {ebayAuthData?.url && (
              <Button variant="outline" size="sm" asChild>
                <a href={ebayAuthData.url} target="_blank" rel="noreferrer">
                  Connect eBay Account
                </a>
              </Button>
            )}
            <Button onClick={handleEbaySync} disabled={syncEbay.isPending} data-testid="button-sync-ebay">
              <RefreshCw className={`mr-2 h-4 w-4 ${syncEbay.isPending ? "animate-spin" : ""}`} />
              {syncEbay.isPending ? "Syncing..." : "Sync eBay Orders"}
            </Button>
          </div>
        )}

        {activeTab === "tcgplayer" && (
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleTcgFileUpload}
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={importTcg.isPending}
              data-testid="button-import-tcgplayer"
            >
              <Upload className={`mr-2 h-4 w-4 ${importTcg.isPending ? "animate-spin" : ""}`} />
              {importTcg.isPending ? "Importing…" : "Import Order CSV"}
            </Button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b flex gap-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => { setActiveTab(t.id); setInspectResult(null); }}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            <span className="ml-2 text-xs tabular-nums opacity-60">{tabCount(t.id)}</span>
          </button>
        ))}
      </div>

      {/* Inspect panel */}
      {activeTab === "manapool" && inspectResult && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <div className="px-4 pt-3 pb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-amber-700 dark:text-amber-400">Raw API Structure (first order)</span>
            <button onClick={() => setInspectResult(null)} className="text-xs underline opacity-60 hover:opacity-100">dismiss</button>
          </div>
          <CardContent>
            <pre className="text-xs overflow-auto max-h-96 whitespace-pre-wrap break-all font-mono text-amber-900 dark:text-amber-200">
              {JSON.stringify(inspectResult, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Manapool table */}
      {activeTab === "manapool" && (
        <Card>
          <CardContent className="p-0">
            {mpLoading ? (
              <div className="p-6 space-y-4">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : !mpOrders || mpOrders.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <RefreshCw className="h-10 w-10 mx-auto text-muted mb-4 opacity-50" />
                <h3 className="font-medium text-foreground">No orders synced</h3>
                <p className="text-sm mt-1 mb-4 max-w-sm mx-auto">Click sync to pull in your Manapool orders.</p>
                <Button variant="outline" onClick={handleMpSync} disabled={syncOrders.isPending}>
                  Start initial sync
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Order ID</TableHead>
                      <TableHead className="text-right">Gross Total</TableHead>
                      <TableHead className="text-right">Shipping</TableHead>
                      <TableHead className="text-right">Platform Fees</TableHead>
                      <TableHead className="text-right font-bold">Net Payout</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mpOrders.map((order) => (
                      <TableRow key={order.id} data-testid={`row-order-${order.id}`}>
                        <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(order.date), "MMM d, yyyy HH:mm")}
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[120px] truncate" title={order.id}>
                          {order.id}
                        </TableCell>
                        <TableCell className="text-right font-mono">{formatCurrency(order.grossTotal)}</TableCell>
                        <TableCell className="text-right font-mono text-blue-600 dark:text-blue-400">
                          {formatCurrency(order.shippingTotal ?? 0)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-destructive">
                          -{formatCurrency(order.platformFees)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-bold text-primary">
                          {formatCurrency(order.netPayout)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* eBay table */}
      {activeTab === "ebay" && (
        <Card>
          <CardContent className="p-0">
            {ebayLoading ? (
              <div className="p-6 space-y-4">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : !ebayOrders || ebayOrders.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <RefreshCw className="h-10 w-10 mx-auto text-muted mb-4 opacity-50" />
                <h3 className="font-medium text-foreground">No eBay orders synced</h3>
                <p className="text-sm mt-1 mb-4 max-w-sm mx-auto">
                  {ebayAuthData?.url ? "Connect your eBay account first, then sync." : "Click sync to pull in your eBay orders."}
                </p>
                {ebayAuthData?.url && (
                  <Button variant="outline" size="sm" className="mb-3" asChild>
                    <a href={ebayAuthData.url} target="_blank" rel="noreferrer">Connect eBay Account</a>
                  </Button>
                )}
                <Button variant="outline" onClick={handleEbaySync} disabled={syncEbay.isPending}>
                  Sync eBay Orders
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Order ID</TableHead>
                      <TableHead className="text-right">Items</TableHead>
                      <TableHead className="text-right">Gross Total</TableHead>
                      <TableHead className="text-right">Shipping</TableHead>
                      <TableHead className="text-right">eBay Fees</TableHead>
                      <TableHead className="text-right font-bold">Net Payout</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ebayOrders.map((order) => (
                      <TableRow key={order.id} data-testid={`row-ebay-${order.id}`}>
                        <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(order.date), "MMM d, yyyy HH:mm")}
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[140px] truncate" title={order.id}>
                          {order.id}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{order.itemCount}</TableCell>
                        <TableCell className="text-right font-mono">{formatCurrency(order.grossTotal)}</TableCell>
                        <TableCell className="text-right font-mono text-blue-600 dark:text-blue-400">
                          {formatCurrency(order.shippingTotal ?? 0)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-destructive">
                          -{formatCurrency(order.platformFees)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-bold text-primary">
                          {formatCurrency(order.netPayout)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* TCGPlayer table */}
      {activeTab === "tcgplayer" && (
        <Card>
          <CardContent className="p-0">
            {tcgLoading ? (
              <div className="p-6 space-y-4">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : !tcgOrders || tcgOrders.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <Upload className="h-10 w-10 mx-auto text-muted mb-4 opacity-50" />
                <h3 className="font-medium text-foreground">No TCGPlayer orders imported</h3>
                <p className="text-sm mt-1 mb-4 max-w-sm mx-auto">
                  Export an Order CSV from TCGPlayer and upload it here. Orders are upserted by order number so re-importing is safe.
                </p>
                <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importTcg.isPending}>
                  <Upload className="mr-2 h-4 w-4" />
                  Import Order CSV
                </Button>
                <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleTcgFileUpload} />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Order #</TableHead>
                      <TableHead>Buyer</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Product</TableHead>
                      <TableHead className="text-right">Shipping</TableHead>
                      <TableHead className="text-right">TCG Fees (~10.25%)</TableHead>
                      <TableHead className="text-right font-bold">Net Payout</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tcgOrders.map((order) => (
                      <TableRow key={order.id} data-testid={`row-tcg-${order.id}`}>
                        <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(order.date), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{order.id}</TableCell>
                        <TableCell className="text-xs max-w-[120px] truncate" title={order.buyerName ?? ""}>
                          {order.buyerName ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                            order.status?.toLowerCase() === "cancelled"
                              ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                              : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          }`}>
                            {order.status ?? "—"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono">{formatCurrency(order.productAmt)}</TableCell>
                        <TableCell className="text-right font-mono text-blue-600 dark:text-blue-400">
                          {formatCurrency(order.shippingAmt)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-destructive">
                          -{formatCurrency(order.platformFees)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-bold text-primary">
                          {formatCurrency(order.netPayout)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
