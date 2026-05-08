import { useDashboard } from "@/hooks/use-finance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowDownRight, ArrowUpRight, DollarSign, Activity } from "lucide-react";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export default function Dashboard() {
  const { data: stats, isLoading, isError } = useDashboard();

  if (isError) {
    return (
      <div className="p-6 bg-destructive/10 text-destructive rounded-md">
        Failed to load dashboard statistics.
      </div>
    );
  }

  const isProfitable = stats ? stats.netProfit >= 0 : true;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground mt-1">Your business at a glance.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="hover-elevate-2 transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Revenue</CardTitle>
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <DollarSign className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div 
                className="text-3xl font-bold font-mono tracking-tight"
                data-testid="text-total-revenue"
              >
                {formatCurrency(stats?.totalRevenue ?? 0)}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">From all synced orders</p>
          </CardContent>
        </Card>

        <Card className="hover-elevate-2 transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Expenses</CardTitle>
            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
              <ShoppingCartIcon className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div 
                className="text-3xl font-bold font-mono tracking-tight"
                data-testid="text-total-expenses"
              >
                {formatCurrency(stats?.totalExpenses ?? 0)}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Purchases and fees</p>
          </CardContent>
        </Card>

        <Card className={`border-l-4 hover-elevate-2 transition-shadow ${isProfitable ? 'border-l-green-500' : 'border-l-red-500'}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Net Profit</CardTitle>
            <div className={`h-8 w-8 rounded-full flex items-center justify-center ${isProfitable ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
              <Activity className={`h-4 w-4 ${isProfitable ? 'text-green-500' : 'text-red-500'}`} />
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="flex items-center gap-2">
                <div 
                  className={`text-3xl font-bold font-mono tracking-tight ${isProfitable ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                  data-testid="text-net-profit"
                >
                  {formatCurrency(stats?.netProfit ?? 0)}
                </div>
                {isProfitable ? (
                  <ArrowUpRight className="h-5 w-5 text-green-500" />
                ) : (
                  <ArrowDownRight className="h-5 w-5 text-red-500" />
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ShoppingCartIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="21" r="1" />
      <circle cx="19" cy="21" r="1" />
      <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
    </svg>
  );
}
