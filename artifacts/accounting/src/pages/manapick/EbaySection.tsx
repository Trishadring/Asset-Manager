import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tag, CheckCircle2 } from "lucide-react";
import type { EbayPickOrder } from "./types";

export function EbaySection({
  orders,
  ebayPacked,
  setEbayPacked,
}: {
  orders: EbayPickOrder[];
  ebayPacked: Record<string, boolean>;
  setEbayPacked: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
  if (orders.length === 0) return null;

  return (
    <div className="space-y-4">
      <Separator />
      <div className="flex items-center gap-2">
        <Tag className="h-4 w-4 text-purple-500" />
        <h2 className="text-lg font-bold">eBay Orders</h2>
        <span className="text-sm text-muted-foreground">
          ({orders.filter((o) => !ebayPacked[o.id]).length} pending)
        </span>
      </div>

      {orders
        .filter((o) => !ebayPacked[o.id])
        .map((order) => (
          <div
            key={order.id}
            className="rounded-lg border bg-card p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-mono text-muted-foreground">
                {order.id.length > 14
                  ? `${order.id.slice(0, 14)}…`
                  : order.id}
                <span className="ml-2 text-muted-foreground/60">
                  · {order.lineItems.length} item
                  {order.lineItems.length !== 1 ? "s" : ""}
                </span>
              </p>
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0"
                onClick={() =>
                  setEbayPacked((prev) => ({ ...prev, [order.id]: true }))
                }
              >
                Mark Packed
              </Button>
            </div>

            <div className="space-y-2">
              {order.lineItems.map((item, i) => (
                <div key={i} className="flex items-center gap-3">
                  {item.imageUrl ? (
                    <img
                      loading="lazy"
                      src={item.imageUrl}
                      alt={item.title}
                      className="w-16 h-16 object-cover rounded-md border shrink-0"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-md border bg-muted flex items-center justify-center shrink-0">
                      <Tag className="h-5 w-5 text-muted-foreground opacity-50" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-tight line-clamp-3">
                      {item.title}
                    </p>
                    {item.quantity > 1 && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        ×{item.quantity}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

      {orders.every((o) => ebayPacked[o.id]) && (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
          <CheckCircle2 className="h-8 w-8 text-green-500 opacity-80" />
          <p className="text-sm font-medium">All eBay orders packed!</p>
        </div>
      )}
    </div>
  );
}
