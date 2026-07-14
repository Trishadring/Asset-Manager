import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, MinusCircle } from "lucide-react";
import type { DeductionResult } from "@/hooks/use-tcgplayer";

export function DeductDialog({
  open,
  onOpenChange,
  deductPreview,
  isPending,
  onApply,
  skippedCount = 0,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deductPreview: DeductionResult | null;
  isPending: boolean;
  onApply: () => void;
  skippedCount?: number;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MinusCircle className="h-5 w-5 text-orange-500" />
            {deductPreview?.applied
              ? "Manapool quantities updated"
              : "Preview: Deduct from Manapool"}
          </DialogTitle>
        </DialogHeader>

        {deductPreview && (
          <div className="flex-1 overflow-y-auto space-y-4 text-sm">
            <div className="grid grid-cols-3 gap-3">
              {[
                {
                  label: "Will update",
                  value: deductPreview.plan.filter(
                    (r) => r.newQuantity !== r.currentQuantity,
                  ).length,
                },
                {
                  label: "No change needed",
                  value: deductPreview.plan.filter(
                    (r) => r.newQuantity === r.currentQuantity,
                  ).length,
                },
                {
                  label: "Not on Manapool",
                  value: deductPreview.notFound.length,
                },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="rounded-lg border bg-muted/40 p-3 text-center"
                >
                  <p className="text-xl font-bold tabular-nums">{value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {label}
                  </p>
                </div>
              ))}
            </div>

            {skippedCount > 0 && (
              <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 px-4 py-3 text-blue-700 dark:text-blue-400 text-sm">
                {skippedCount} card{skippedCount !== 1 ? "s" : ""} skipped — already deducted in a previous run.
              </div>
            )}

            {deductPreview.plan.filter(
              (r) => r.newQuantity !== r.currentQuantity,
            ).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Quantity changes
                </p>
                <div className="rounded-lg border divide-y">
                  {deductPreview.plan
                    .filter((r) => r.newQuantity !== r.currentQuantity)
                    .map((row) => (
                      <div
                        key={row.tcgplayerSku}
                        className="flex items-center justify-between px-3 py-2 gap-3"
                      >
                        <span className="font-medium truncate flex-1">
                          {row.name}
                        </span>
                        <div className="flex items-center gap-2 shrink-0 text-xs tabular-nums">
                          {row.status === "insufficient" && (
                            <span className="text-amber-600 dark:text-amber-400">
                              (low stock)
                            </span>
                          )}
                          <span className="text-muted-foreground">
                            {row.currentQuantity}
                          </span>
                          <span className="text-muted-foreground">→</span>
                          <span
                            className={`font-bold ${row.newQuantity === 0 ? "text-red-600 dark:text-red-400" : "text-foreground"}`}
                          >
                            {row.newQuantity}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {deductPreview.notFound.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Not found in Manapool inventory
                </p>
                <div className="rounded-lg border divide-y">
                  {deductPreview.notFound.map((item) => (
                    <div
                      key={item.tcgplayerSku}
                      className="px-3 py-2 text-xs text-muted-foreground"
                    >
                      {item.name}{" "}
                      <span className="opacity-50">
                        (SKU {item.tcgplayerSku})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {deductPreview.applied && (
              <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-4 py-3 text-green-700 dark:text-green-400 text-sm font-medium">
                ✓ {deductPreview.updated} listing
                {deductPreview.updated !== 1 ? "s" : ""} updated on Manapool.
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {deductPreview?.applied ? "Done" : "Cancel"}
          </Button>
          {!deductPreview?.applied &&
            deductPreview &&
            deductPreview.plan.filter(
              (r) => r.newQuantity !== r.currentQuantity,
            ).length > 0 && (
              <Button
                onClick={onApply}
                disabled={isPending}
                className="bg-orange-600 hover:bg-orange-700 text-white"
              >
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Updating…
                  </>
                ) : (
                  <>
                    Apply{" "}
                    {
                      deductPreview.plan.filter(
                        (r) => r.newQuantity !== r.currentQuantity,
                      ).length
                    }{" "}
                    changes
                  </>
                )}
              </Button>
            )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
