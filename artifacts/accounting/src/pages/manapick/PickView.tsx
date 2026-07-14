import { CardItem } from "./CardItem";
import type { MasterEntry, SetsMap } from "./types";
import { formatDate } from "./utils";

export interface SetGroup {
  setCode: string;
  setInfo: SetsMap[string] | undefined;
  cards: Array<[string, MasterEntry]>;
}

export function PickView({
  setGroups,
  orderToBin,
  picked,
  onToggle,
}: {
  setGroups: SetGroup[];
  orderToBin: Record<string, number>;
  picked: Record<string, boolean>;
  onToggle: (pk: string) => void;
}) {
  return (
    <div className="space-y-8">
      {setGroups.map(({ setCode, setInfo, cards }) => (
        <div key={setCode}>
          <div className="mb-3">
            <h2 className="text-lg font-bold">
              {setInfo?.name ?? setCode.toUpperCase()}
            </h2>
            {setInfo && (
              <p className="text-xs text-muted-foreground">
                {setCode.toUpperCase()}
                {setInfo.released_at && setInfo.released_at !== "1900-01-01"
                  ? ` · ${formatDate(setInfo.released_at)}`
                  : ""}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {cards.map(([key, entry]) => (
              <CardItem
                key={key}
                cardKey={key}
                entry={entry}
                orderToBin={orderToBin}
                picked={picked}
                onToggle={onToggle}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
