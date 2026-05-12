import { useState } from "react";
import { format, parseISO } from "date-fns";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useDashboard, useWeeklyStats } from "@/hooks/use-finance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowDownRight, ArrowUpRight, DollarSign, Activity, ShoppingCart, TrendingUp } from "lucide-react";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function shortCurrency(value: number) {
  if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

function weekLabel(iso: string) {
  try { return format(parseISO(iso), "MMM d"); } catch { return iso; }
}

const VIEWS = ["Revenue & Spending", "Profit", "Orders"] as const;
type View = typeof VIEWS[number];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border border-border rounded-lg shadow-lg p-3 text-sm min-w-[160px]">
      <p className="font-semibold mb-2 text-foreground">{weekLabel(label)} week</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
            <span className="text-muted-foreground capitalize">{p.name}</span>
          </span>
          <span className="font-mono font-medium" style={{ color: p.color }}>
            {p.dataKey === "orders" ? p.value : formatCurrency(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
};

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading, isError } = useDashboard();
  const { data: weekly, isLoading: weeklyLoading } = useWeeklyStats();
  const [activeView, setActiveView] = useState<View>("Revenue & Spending");

  const isProfitable = stats ? stats.netProfit >= 0 : true;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground mt-1">Your business at a glance.</p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Revenue</CardTitle>
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <DollarSign className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-24" /> : (
              <div className="text-3xl font-bold font-mono tracking-tight" data-testid="text-total-revenue">
                {formatCurrency(stats?.totalRevenue ?? 0)}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Net payout from all orders</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Spending</CardTitle>
            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-24" /> : (
              <div className="text-3xl font-bold font-mono tracking-tight" data-testid="text-total-expenses">
                {formatCurrency(stats?.totalExpenses ?? 0)}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Card purchases & expenses</p>
          </CardContent>
        </Card>

        <Card className={`border-l-4 ${isProfitable ? "border-l-green-500" : "border-l-red-500"}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Net Profit</CardTitle>
            <div className={`h-8 w-8 rounded-full flex items-center justify-center ${isProfitable ? "bg-green-500/10" : "bg-red-500/10"}`}>
              <Activity className={`h-4 w-4 ${isProfitable ? "text-green-500" : "text-red-500"}`} />
            </div>
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-24" /> : (
              <div className="flex items-center gap-2">
                <div
                  className={`text-3xl font-bold font-mono tracking-tight ${isProfitable ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                  data-testid="text-net-profit"
                >
                  {formatCurrency(stats?.netProfit ?? 0)}
                </div>
                {isProfitable
                  ? <ArrowUpRight className="h-5 w-5 text-green-500" />
                  : <ArrowDownRight className="h-5 w-5 text-red-500" />
                }
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Weekly chart */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <CardTitle className="text-base font-semibold">Week by Week</CardTitle>
              <span className="text-xs text-muted-foreground">last 16 weeks</span>
            </div>
            <div className="flex gap-1 bg-muted rounded-lg p-1">
              {VIEWS.map((v) => (
                <button
                  key={v}
                  onClick={() => setActiveView(v)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    activeView === v
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {weeklyLoading ? (
            <div className="h-64 flex items-center justify-center">
              <Skeleton className="h-48 w-full" />
            </div>
          ) : !weekly || weekly.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
              No data yet — sync some orders to see your weekly trends.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              {activeView === "Revenue & Spending" ? (
                <AreaChart data={weekly} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradSpending" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="week" tickFormatter={weekLabel} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={shortCurrency} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={52} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend formatter={(v) => <span className="text-xs capitalize">{v}</span>} />
                  <Area type="monotone" dataKey="revenue" name="revenue" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#gradRevenue)" dot={false} activeDot={{ r: 4 }} />
                  <Area type="monotone" dataKey="spending" name="spending" stroke="#f43f5e" strokeWidth={2} fill="url(#gradSpending)" dot={false} activeDot={{ r: 4 }} />
                </AreaChart>
              ) : activeView === "Profit" ? (
                <BarChart data={weekly} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="week" tickFormatter={weekLabel} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={shortCurrency} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={52} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="profit" name="profit" radius={[4, 4, 0, 0]}>
                    {weekly.map((entry, i) => (
                      <Cell key={i} fill={entry.profit >= 0 ? "hsl(var(--primary))" : "#f43f5e"} />
                    ))}
                  </Bar>
                </BarChart>
              ) : (
                <BarChart data={weekly} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="week" tickFormatter={weekLabel} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="orders" name="orders" radius={[4, 4, 0, 0]} fill="hsl(var(--primary))" />
                </BarChart>
              )}
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {isError && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-md text-sm">
          Failed to load dashboard statistics.
        </div>
      )}
    </div>
  );
}
