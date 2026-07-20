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
}

export type Master = Record<string, MasterEntry>;
export type SetsMap = Record<string, { name: string; released_at: string }>;

export type Phase = "pick" | "pack";
