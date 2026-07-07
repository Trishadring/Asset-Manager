import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2 } from "lucide-react";
import type { Order, Master } from "./types";
import { entryImageUrl } from "./types";

export function PackView({
  orders,
  master,
  orderToBin,
  shipped,
  tracking,
  onShip,
  onTrackingChange,
}: {
  orders: Order[];
  master: Master;
  orderToBin: Record<string, number>;
  shipped: Record<string, boolean>;
  tracking: Record<string, string>;
  onShip: (oid: string) => void;
  onTrackingChange: (oid: string, value: string) => void;
}) {
  const unshipped = orders.filter((o) => !shipped[o.id]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3 text-sm space-y-1">
        <p className="font-semibold text-xs text-muted-foreground uppercase tracking-wide mb-2">
          Bin Reference
        </p>
        {orders.map((o) => (
          <div key={o.id} className="flex items-center gap-2 text-xs">
            <span className="font-bold text-foreground">
              Bin {orderToBin[o.id]}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="font-mono text-muted-foreground">
              {o.label ?? o.id.slice(0, 8)}
            </span>
            {o.shipping_address?.name && (
              <span className="text-muted-foreground">
                — {o.shipping_address.name}
              </span>
            )}
            {o.source === "tcgplayer" && (
              <span className="text-blue-500 font-medium">TCGPlayer</span>
            )}
            {shipped[o.id] && (
              <CheckCircle2 className="h-3 w-3 text-green-500 ml-auto" />
            )}
          </div>
        ))}
      </div>

      {unshipped.map((order) => {
        const oid = order.id;
        const binNum = orderToBin[oid];
        const addr = order.shipping_address ?? {};
        const isTcg = order.source === "tcgplayer";
        const cardCount = isTcg
          ? Object.values(master)
              .filter((e) => e.source === "tcgplayer")
              .reduce((s, e) => s + (e.allocations[oid] ?? 0), 0)
          : (order.items ?? [])
              .filter((i) => i.product?.single)
              .reduce((s, i) => s + (i.quantity ?? 1), 0);

        const orderCards = Object.entries(master).filter(
          ([, e]) => (e.allocations[oid] ?? 0) > 0,
        );

        return (
          <div
            key={oid}
            className="rounded-lg border bg-card p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">Bin {binNum}</span>
                  {isTcg && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 font-medium">
                      TCGPlayer
                    </span>
                  )}
                </div>
                {!isTcg && (
                  <>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">
                      {order.label ?? oid.slice(0, 10)}
                    </p>
                    {addr.name && (
                      <p className="text-sm font-medium mt-1">{addr.name}</p>
                    )}
                    {addr.line1 && (
                      <p className="text-xs text-muted-foreground">
                        {addr.line1}
                        {addr.line2 ? `, ${addr.line2}` : ""}
                      </p>
                    )}
                    {(addr.city || addr.state || addr.postal_code) && (
                      <p className="text-xs text-muted-foreground">
                        {[addr.city, addr.state, addr.postal_code]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                    )}
                    {order.shipping_method && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        via {order.shipping_method}
                      </p>
                    )}
                  </>
                )}
                {isTcg && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Ship via your normal TCGPlayer process
                  </p>
                )}
              </div>
              <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                {cardCount} card{cardCount !== 1 ? "s" : ""}
              </span>
            </div>

            {orderCards.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {orderCards.map(([key, entry]) => {
                  const img = entryImageUrl(entry);
                  const qty = entry.allocations[oid] ?? 0;
                  return (
                    <div key={key} className="relative flex-shrink-0">
                      {img ? (
                        <img
                          src={img}
                          alt={entry.name}
                          className="w-full rounded-lg block"
                        />
                      ) : (
                        <div className="w-full aspect-[63/88] rounded-lg bg-muted flex items-center justify-center text-[9px] text-muted-foreground px-1 text-center leading-tight">
                          {entry.name}
                        </div>
                      )}
                      {qty > 1 && (
                        <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] font-bold rounded px-1 leading-tight">
                          ×{qty}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {!isTcg && (
              <div className="flex gap-2">
                <Input
                  placeholder="Tracking number (optional)"
                  value={tracking[oid] ?? ""}
                  onChange={(e) => onTrackingChange(oid, e.target.value)}
                  className="h-8 text-xs"
                />
                <Button
                  size="sm"
                  className="h-8 shrink-0"
                  onClick={() => onShip(oid)}
                >
                  Mark Shipped
                </Button>
              </div>
            )}

            {isTcg && (
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => onShip(oid)}
              >
                Mark Packed
              </Button>
            )}
          </div>
        );
      })}

      {unshipped.length === 0 && orders.length > 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
          <CheckCircle2 className="h-10 w-10 text-green-500 opacity-80" />
          <p className="text-sm font-medium">All orders packed & shipped!</p>
        </div>
      )}
    </div>
  );
}
