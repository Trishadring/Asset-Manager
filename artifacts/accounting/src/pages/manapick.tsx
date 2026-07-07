import { Loader2, RefreshCw, Package, ShoppingBag, Upload, X, MinusCircle, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatRelativeTime } from "./manapick/utils";
import { PickView } from "./manapick/PickView";
import { PackView } from "./manapick/PackView";
import { EbaySection } from "./manapick/EbaySection";
import { DeductDialog } from "./manapick/DeductDialog";
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
    tcgFileInputRef, handleTcgFile, tcgLoading, hasTcg,
    handleDeductPreview, deductMutation, removeTcgCards,
    fetchEbayOrders, ebayLoading, ebayOrders, clearAll,
    error, tcgError, setTcgError, ebayError, setEbayError,
    isEnriching, enrichProgress,
    master, totalCards, pickedCards, orders,
    phase, setPhase,
    setGroups, orderToBin, picked, togglePick,
    shipped, tracking, shipOrder, handleTrackingChange,
    ebayPacked, setEbayPacked,
    deductDialogOpen, setDeductDialogOpen, deductPreview, handleDeductApply,
  } = useOrders();

  return (
    <div className="space-y-6 max-w-screen-xl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">ManaPick</h1>
          <p className="text-sm text-muted-foreground">
            Pick &amp; pack helper — Manapool + TCGPlayer, sorted by set, color,
            and collector number
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

          {/* TCGPlayer pull sheet upload */}
          <input
            ref={tcgFileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleTcgFile}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => tcgFileInputRef.current?.click()}
            disabled={tcgLoading}
          >
            {tcgLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            <span className="ml-1">
              {tcgLoading
                ? "Loading…"
                : hasTcg
                  ? "Replace TCGPlayer CSV"
                  : "Add TCGPlayer CSV"}
            </span>
          </Button>

          {hasTcg && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDeductPreview}
                disabled={deductMutation.isPending}
                className="text-orange-600 border-orange-300 hover:bg-orange-50 dark:text-orange-400 dark:border-orange-700 dark:hover:bg-orange-950/30"
              >
                {deductMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MinusCircle className="h-4 w-4" />
                )}
                <span className="ml-1">Deduct from Manapool</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={removeTcgCards}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-4 w-4" />
                <span className="ml-1">Remove TCG</span>
              </Button>
            </>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={fetchEbayOrders}
            disabled={ebayLoading}
            className="text-purple-600 border-purple-300 hover:bg-purple-50 dark:text-purple-400 dark:border-purple-700 dark:hover:bg-purple-950/30"
          >
            {ebayLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Tag className="h-4 w-4" />
            )}
            <span className="ml-1">
              {ebayLoading
                ? "Loading…"
                : ebayOrders.length > 0
                  ? "Refresh eBay"
                  : "Fetch eBay"}
            </span>
          </Button>

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
      {tcgError && (
        <div className="rounded-md bg-destructive/10 text-destructive border border-destructive/20 px-4 py-3 text-sm flex items-center justify-between">
          <span>TCGPlayer: {tcgError}</span>
          <button
            onClick={() => setTcgError(null)}
            className="ml-4 underline text-xs opacity-70 hover:opacity-100"
          >
            dismiss
          </button>
        </div>
      )}
      {ebayError && (
        <div className="rounded-md bg-destructive/10 text-destructive border border-destructive/20 px-4 py-3 text-sm flex items-center justify-between">
          <span>eBay: {ebayError}</span>
          <button
            onClick={() => setEbayError(null)}
            className="ml-4 underline text-xs opacity-70 hover:opacity-100"
          >
            dismiss
          </button>
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
            Manapool orders, or <strong>Add TCGPlayer CSV</strong> to load a
            TCGPlayer pull sheet.
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

          {/* Platform badges */}
          <div className="flex gap-2 text-xs">
            {orders.some((o) => o.source !== "tcgplayer") && (
              <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 font-medium">
                Manapool
              </span>
            )}
            {hasTcg && (
              <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 font-medium">
                TCGPlayer
              </span>
            )}
          </div>

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

      {/* ── eBay Orders ──────────────────────────────────────────────────── */}
      <EbaySection
        orders={ebayOrders}
        ebayPacked={ebayPacked}
        setEbayPacked={setEbayPacked}
      />

      {/* ── Deduct from Manapool preview dialog ─────────────────────────── */}
      <DeductDialog
        open={deductDialogOpen}
        onOpenChange={setDeductDialogOpen}
        deductPreview={deductPreview}
        isPending={deductMutation.isPending}
        onApply={handleDeductApply}
      />
    </div>
  );
}
