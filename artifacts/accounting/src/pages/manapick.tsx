import { Loader2, RefreshCw, Package, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatRelativeTime } from "./manapick/utils";
import { PickView } from "./manapick/PickView";
import { PackView } from "./manapick/PackView";
import { OrdersProvider, useOrders } from "./manapick/OrdersProvider";

export default function ManaPick() {
  return (
    <OrdersProvider>
      <ManaPickInner />
    </OrdersProvider>
  );
}

function ManaPickInner() {
  const {
    fetchOrders, loading, isEmpty, cachedAt,
    clearAll, error,
    isEnriching, enrichProgress,
    master, totalCards, pickedCards, orders,
    phase, setPhase,
    setGroups, orderToBin, picked, togglePick,
    shipped, tracking, shipOrder, handleTrackingChange,
  } = useOrders();

  return (
    <div className="space-y-6 max-w-screen-xl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">ManaPick</h1>
          <p className="text-sm text-muted-foreground">
            Pick &amp; pack Manapool orders, sorted by set, color, and collector number
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={fetchOrders} disabled={loading} size="sm">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-1">
              {loading
                ? "Fetching…"
                : isEmpty
                  ? "Fetch Manapool"
                  : "Refresh Manapool"}
            </span>
          </Button>
          {cachedAt !== null && !loading && (
            <span className="text-xs text-muted-foreground">
              Synced {formatRelativeTime(cachedAt)}
            </span>
          )}

          {!isEmpty && (
            <Button variant="outline" size="sm" onClick={clearAll}>
              Clear All
            </Button>
          )}
        </div>
      </div>

      {/* Errors */}
      {error && (
        <div className="rounded-md bg-destructive/10 text-destructive border border-destructive/20 px-4 py-3 text-sm">
          {error}
        </div>
      )}
      {/* Enrichment progress */}
      {isEnriching && (
        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">
            Enriching card data… {enrichProgress.done}/{enrichProgress.total}
          </p>
          <Progress
            value={(enrichProgress.done / enrichProgress.total) * 100}
          />
        </div>
      )}

      {/* Empty state */}
      {!loading && isEmpty && !error && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <ShoppingBag className="h-12 w-12 opacity-20" />
          <p className="text-sm text-center max-w-sm">
            Click <strong>Fetch Manapool</strong> to load your paid, unshipped
            Manapool orders.
          </p>
        </div>
      )}

      {/* Metrics + phase toggle */}
      {!isEmpty && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Unique cards", value: Object.keys(master).length },
              { label: "Total to pick", value: totalCards },
              { label: "Picked", value: pickedCards },
              { label: "Orders", value: orders.length },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="rounded-lg border bg-card p-3 text-center"
              >
                <p className="text-2xl font-bold tabular-nums">{value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {totalCards > 0 && (
            <Progress
              value={(pickedCards / totalCards) * 100}
              className="h-2"
            />
          )}

          {/* Phase toggle */}
          <div className="flex gap-2">
            <Button
              variant={phase === "pick" ? "default" : "outline"}
              size="sm"
              onClick={() => setPhase("pick")}
            >
              <ShoppingBag className="h-4 w-4 mr-1" /> Pick
            </Button>
            <Button
              variant={phase === "pack" ? "default" : "outline"}
              size="sm"
              onClick={() => setPhase("pack")}
            >
              <Package className="h-4 w-4 mr-1" /> Pack &amp; Ship
            </Button>
          </div>

          {/* ── PICK VIEW ────────────────────────────────────────────────── */}
          {phase === "pick" && (
            <PickView
              setGroups={setGroups}
              orderToBin={orderToBin}
              picked={picked}
              onToggle={togglePick}
            />
          )}

          {/* ── PACK VIEW ─────────────────────────────────────────────────── */}
          {phase === "pack" && (
            <PackView
              orders={orders}
              master={master}
              orderToBin={orderToBin}
              shipped={shipped}
              tracking={tracking}
              onShip={shipOrder}
              onTrackingChange={handleTrackingChange}
            />
          )}
        </>
      )}

    </div>
  );
}
