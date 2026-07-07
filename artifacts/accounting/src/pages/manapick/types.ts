import type { DeductionResult, TcgPullCard } from "@/hooks/use-tcgplayer";

export interface ScryfallCard {
  id: string;
  name: string;
  colors?: string[];
  type_line?: string;
  set: string;
  collector_number: string;
  image_uris?: { normal?: string; large?: string; small?: string };
  card_faces?: Array<{
    image_uris?: { normal?: string; large?: string; small?: string };
  }>;
}

export interface MasterEntry {
  name: string;
  set: string;
  collector_number: string;
  finish: "nonfoil" | "foil" | "etched" | string;
  quantity: number;
  scryfall_id?: string;
  allocations: Record<string, number>;
  scryfall?: ScryfallCard;
  source?: "manapool" | "tcgplayer";
}

export interface ShippingAddress {
  name?: string;
  line1?: string;
  line2?: string;
  line3?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

export interface OrderItem {
  quantity?: number;
  product?: {
    single?: {
      name?: string;
      set?: string;
      number?: string;
      finish_id?: string;
      scryfall_id?: string;
    };
  };
}

export interface Order {
  id: string;
  label?: string;
  shipping_address?: ShippingAddress;
  shipping_method?: string;
  items?: OrderItem[];
  source?: "manapool" | "tcgplayer";
}

export type Master = Record<string, MasterEntry>;
export type SetsMap = Record<string, { name: string; released_at: string }>;

export interface EbayPickLineItem {
  title: string;
  imageUrl: string | null;
  quantity: number;
}

export interface EbayPickOrder {
  id: string;
  lineItems: EbayPickLineItem[];
}

export type Phase = "pick" | "pack";

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function scryfallDirectUrl(scryfallId?: string): string | null {
  if (!scryfallId || scryfallId.length < 2) return null;
  return `https://cards.scryfall.io/normal/front/${scryfallId[0]}/${scryfallId[1]}/${scryfallId}.jpg`;
}

export function cardImageFromData(card?: ScryfallCard): string | null {
  if (!card) return null;
  if (card.image_uris)
    return (
      card.image_uris.normal ??
      card.image_uris.large ??
      card.image_uris.small ??
      null
    );
  const face = card.card_faces?.[0];
  if (face?.image_uris)
    return (
      face.image_uris.normal ??
      face.image_uris.large ??
      face.image_uris.small ??
      null
    );
  return null;
}

export function entryImageUrl(entry: MasterEntry): string | null {
  return (
    cardImageFromData(entry.scryfall) ?? scryfallDirectUrl(entry.scryfall_id)
  );
}

export function colorSortIndex(card?: ScryfallCard): number {
  if (!card) return 9;
  if (card.type_line?.includes("Land")) return 8;
  const c = card.colors ?? [];
  if (c.length === 0) return 7;
  if (c.length > 1) return 6;
  return (
    ({ W: 1, U: 2, B: 3, R: 4, G: 5 } as Record<string, number>)[c[0]!] ?? 9
  );
}

export function parseCollectorNumber(cn: string): [number, string] {
  const m = String(cn).match(/(\d+)/);
  return m ? [parseInt(m[1]!), cn] : [0, cn];
}

export function formatDate(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
