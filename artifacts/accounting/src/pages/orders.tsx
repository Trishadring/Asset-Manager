import { useState, useEffect } from "react";
import { format } from "date-fns";
import { RefreshCw, KeyRound, Mail, Search } from "lucide-react";

import { useOrders, useSyncOrders, useInspectOrder } from "@/hooks/use-orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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

export default function Orders() {
  const { data: orders, isLoading } = useOrders();
  const syncOrders = useSyncOrders();
  const inspectOrder = useInspectOrder();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [inspectResult, setInspectResult] = useState<unknown>(null);
  
  useEffect(() => {
    const savedEmail = localStorage.getItem("manapool_email");
    const savedToken = localStorage.getItem("manapool_token");
    if (savedEmail) setEmail(savedEmail);
    if (savedToken) setToken(savedToken);
  }, []);

  const handleSaveCredentials = () => {
    localStorage.setItem("manapool_email", email);
    localStorage.setItem("manapool_token", token);
    toast({
      title: "Credentials saved",
      description: "Stored securely in local storage.",
    });
  };

  const handleSync = () => {
    if (!email || !token) {
      toast({
        variant: "destructive",
        title: "Missing credentials",
        description: "Please enter your Manapool email and API token.",
      });
      return;
    }
    
    syncOrders.mutate({ email, token }, {
      onSuccess: (data) => {
        toast({
          title: "Sync complete",
          description: data.message,
        });
      },
      onError: (error) => {
        toast({
          variant: "destructive",
          title: "Sync failed",
          description: error.message,
        });
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Manapool Orders</h2>
          <p className="text-muted-foreground mt-1">Sync your sales data automatically.</p>
        </div>
        
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!email || !token) { toast({ variant: "destructive", title: "Enter credentials first" }); return; }
              inspectOrder.mutate({ email, token }, {
                onSuccess: (data) => {
                  setInspectResult(data);
                  console.log("[Manapool inspect]", JSON.stringify(data, null, 2));
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
          <Button 
            onClick={handleSync} 
            disabled={syncOrders.isPending}
            data-testid="button-sync-orders"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${syncOrders.isPending ? "animate-spin" : ""}`} />
            {syncOrders.isPending ? "Syncing..." : "Sync Orders"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <Card className="bg-muted/30 border-dashed">
          <CardHeader className="pb-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <KeyRound className="h-4 w-4" /> API Credentials
            </CardTitle>
            <CardDescription>Required to fetch orders from Manapool</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row gap-4 items-end">
              <div className="space-y-2 w-full md:w-1/3">
                <Label htmlFor="email" className="text-xs text-muted-foreground">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input 
                    id="email" 
                    placeholder="seller@example.com" 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-9 bg-background"
                    data-testid="input-manapool-email"
                  />
                </div>
              </div>
              <div className="space-y-2 w-full md:flex-1">
                <Label htmlFor="token" className="text-xs text-muted-foreground">API Token</Label>
                <Input 
                  id="token" 
                  type="password"
                  placeholder="sk_live_..." 
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="font-mono text-sm bg-background"
                  data-testid="input-manapool-token"
                />
              </div>
              <Button 
                variant="secondary" 
                onClick={handleSaveCredentials}
                className="w-full md:w-auto"
                data-testid="button-save-credentials"
              >
                Save
              </Button>
            </div>
          </CardContent>
        </Card>

        {inspectResult && (
          <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-amber-700 dark:text-amber-400 flex items-center justify-between">
                <span>Raw API Structure (first order)</span>
                <button onClick={() => setInspectResult(null)} className="text-xs underline opacity-60 hover:opacity-100">dismiss</button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs overflow-auto max-h-96 whitespace-pre-wrap break-all font-mono text-amber-900 dark:text-amber-200">
                {JSON.stringify(inspectResult, null, 2)}
              </pre>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : !orders || orders.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <RefreshCw className="h-10 w-10 mx-auto text-muted mb-4 opacity-50" />
                <h3 className="font-medium text-foreground">No orders synced</h3>
                <p className="text-sm mt-1 mb-4 max-w-sm mx-auto">Connect your Manapool account to start tracking revenue.</p>
                <Button variant="outline" onClick={handleSync} disabled={syncOrders.isPending}>
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
                    {orders.map((order) => (
                      <TableRow key={order.id} data-testid={`row-order-${order.id}`}>
                        <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(order.date), "MMM d, yyyy HH:mm")}
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[120px] truncate" title={order.id}>
                          {order.id}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(order.grossTotal)}
                        </TableCell>
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
      </div>
    </div>
  );
}
