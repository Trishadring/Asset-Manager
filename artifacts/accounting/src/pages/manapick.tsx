import { useEffect } from "react";
import { Loader2, RefreshCw, Package, ShoppingBag, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatRelativeTime } from "./manapick/utils";
import { PickView } from "./manapick/PickView";
import { PackView } from "./manapick/PackView";
import { OrdersProvider, useOrders } from "./manapick/OrdersProvider";

interface ManaPickProps {
  connected: boolean;
  checking: boolean;
  connectionError: string | null;
  onDisconnect: () => void;
  onAccessExpired: () => void;
}

export default function ManaPick({
  connected,
  checking,
  connectionError,
  onDisconnect,
  onAccessExpired,
}: ManaPickProps) {
  useEffect(() => {
    try {
      localStorage.removeItem("manapick-cache-v2");
    } catch {
      // Local storage may be unavailable.
    }
  }, []);

  if (checking) {
    return (
      <div className="flex min-h-56 items-center gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Checking Manapool connection…</span>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="space-y-6 max-w-screen-xl">
        {connectionError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {connectionError}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold">ManaPick</h1>
          <p className="text-sm text-muted-foreground">
            Pick and pack Manapool orders without Replit sign-in.
          </p>
        </div>
        <div className="max-w-xl rounded-xl border bg-card p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <KeyRound size={19} />
            </div>
            <div className="space-y-1">
              <h2 className="font-semibold">Connect your Manapool account</h2>
              <p className="text-sm text-muted-foreground">
                Authorize ManaPick to read your seller orders and mark them shipped.
                The connection lasts for this browser session or until the access
                token expires.
              </p>
            </div>
          </div>
          <Button asChild className="mt-5">
            <a href="/api/manapick/oauth/start">
            <KeyRound className="mr-2 h-4 w-4" />
              Connect with Manapool
            </a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <OrdersProvider onAccessExpired={onAccessExpired}>
      <ManaPickInner onDisconnect={onDisconnect} />
    </OrdersProvider>
  );
}

function ManaPickInner({ onDisconnect }: { onDisconnect: () => void }) {
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
          <Button variant="outline" size="sm" onClick={onDisconnect}>
            <KeyRound className="h-4 w-4 mr-1" />
            Disconnect Manapool
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
