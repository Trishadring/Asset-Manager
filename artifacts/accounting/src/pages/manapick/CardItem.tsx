import { Button } from "@/components/ui/button";
import type { MasterEntry } from "./types";
import { entryImageUrl } from "./utils";

export function CardItem({
  cardKey,
  entry,
  orderToBin,
  picked,
  onToggle,
}: {
  cardKey: string;
  entry: MasterEntry;
  orderToBin: Record<string, number>;
  picked: Record<string, boolean>;
  onToggle: (pk: string) => void;
}) {
  const img = entryImageUrl(entry);
  const allPicked = Object.keys(entry.allocations).every(
    (oid) => picked[`${cardKey}|${oid}`],
  );
  const isFormatted = entry.finish === "foil" || entry.finish === "etched";

  return (
    <div
      className={`flex flex-col gap-1 transition-opacity duration-200 ${allPicked ? "opacity-30" : ""}`}
    >
      <div
        className={
          isFormatted
            ? "p-0.5 rounded-xl bg-gradient-to-br from-yellow-300 via-pink-400 via-cyan-300 to-green-300"
            : ""
        }
      >
        {img ? (
          <img loading="lazy" src={img} alt={entry.name} className="w-full rounded-xl block" />
        ) : (
          <div className="w-full aspect-[63/88] rounded-xl bg-muted flex items-center justify-center text-xs text-muted-foreground px-2 text-center">
            {entry.name}
          </div>
        )}
      </div>

      <div className="text-xs leading-tight mt-0.5">
        <p
          className={`font-semibold truncate ${allPicked ? "line-through text-muted-foreground" : ""}`}
        >
          {entry.name}
        </p>
        <p className="text-muted-foreground">
          {entry.set.toUpperCase()} #{entry.collector_number}
          {entry.finish === "foil"
            ? " ✨"
            : entry.finish === "etched"
              ? " 🔮"
              : ""}
          {entry.source === "tcgplayer" && (
            <span className="ml-1 text-blue-500 font-medium">TCG</span>
          )}
        </p>
      </div>

      {Object.entries(entry.allocations).map(([oid, qty]) => {
        const binNum = orderToBin[oid] ?? "?";
        const pk = `${cardKey}|${oid}`;
        const isPicked = picked[pk];
        return (
          <Button
            key={pk}
            size="sm"
            variant={isPicked ? "secondary" : "default"}
            className={`w-full text-xs h-7 ${isPicked ? "line-through text-muted-foreground" : ""}`}
            onClick={() => onToggle(pk)}
          >
            {isPicked ? "✓" : "○"} Bin {binNum} ×{qty}
          </Button>
        );
      })}
    </div>
  );
}
