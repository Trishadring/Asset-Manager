import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Package, ShoppingBag, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Layout } from "@/components/layout";
import { ManapoolKeyPanel } from "@/components/manapool-key-panel";
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
      <Layout header={<AccountMenu checking connected={false} onDisconnect={onDisconnect} />}>
        <div className="flex min-h-56 items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Checking Manapool connection…</span>
        </div>
      </Layout>
    );
  }

  if (!connected) {
    return (
      <Layout header={<AccountMenu checking={false} connected={false} onDisconnect={onDisconnect} />}>
        <div className="max-w-xl">
          {connectionError && (
            <div
              role="alert"
              className="mb-6 rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {connectionError}
            </div>
          )}
          <div className="rounded-xl border bg-card p-6 shadow-sm">
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
      </Layout>
    );
  }

  return (
    <OrdersProvider onAccessExpired={onAccessExpired}>
      <Layout header={<ConnectedControls onDisconnect={onDisconnect} />}>
        <ManaPickBody />
      </Layout>
    </OrdersProvider>
  );
}

function AccountMenu({
  connected,
  checking,
  onDisconnect,
}: {
  connected: boolean;
  checking: boolean;
  onDisconnect: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ml-auto">
      <ManapoolKeyPanel
        connected={connected}
        checking={checking}
        open={open}
        onOpenChange={setOpen}
        onDisconnect={onDisconnect}
      />
    </div>
  );
}

function ConnectedControls({ onDisconnect }: { onDisconnect: () => void }) {
  const { phase, setPhase, fetchOrders, loading, isEmpty } = useOrders();

  const phases = [
    { id: "pick" as const, label: "Pick", icon: ShoppingBag },
    { id: "pack" as const, label: "Pack & Ship", icon: Package },
  ];

  return (
    <>
      <nav
        aria-label="Workflow"
        className="order-3 flex w-full items-stretch gap-1 self-stretch md:order-none md:w-auto"
      >
        {phases.map(({ id, label, icon: Icon }) => {
          const active = phase === id;
          return (
            <button
              key={id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => setPhase(id)}
              className={`inline-flex items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors ${
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <Button onClick={fetchOrders} disabled={loading} size="sm">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="ml-1">
            {loading ? "Fetching…" : isEmpty ? "Fetch orders" : "Refresh"}
          </span>
        </Button>
        <AccountMenu checking={false} connected onDisconnect={onDisconnect} />
      </div>
    </>
  );
}

function ManaPickBody() {
  const {
    loading, isEmpty, cachedAt,
    clearAll, error,
    isEnriching, enrichProgress,
    master, totalCards, pickedCards, orders,
    phase,
    setGroups, orderToBin, picked, togglePick,
    shipped, tracking, shipOrder, handleTrackingChange,
  } = useOrders();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-sm text-muted-foreground">
          {phase === "pick"
            ? "Orders sorted by set, color, and collector number."
            : "Pack each bin and mark the order shipped."}
        </p>
        <div className="flex items-center gap-3">
          {cachedAt !== null && !loading && (
            <span className="text-xs text-muted-foreground">
              Synced {formatRelativeTime(cachedAt)}
            </span>
          )}
          {!isEmpty && (
            <Button variant="outline" size="sm" onClick={clearAll}>
              Clear all
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
            Click <strong>Fetch orders</strong> to load your paid, unshipped
            Manapool orders.
          </p>
        </div>
      )}

      {/* Metrics */}
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
