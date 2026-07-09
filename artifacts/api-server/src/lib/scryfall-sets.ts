interface SetInfo {
  name: string;
  released_at: string;
}

interface CacheEntry {
  byCode: Record<string, SetInfo>;
  nameToCode: Map<string, string>;
  fetchedAt: number;
}

let cache: CacheEntry | null = null;
const TTL_MS = 3_600_000;

async function fetchSets(): Promise<CacheEntry> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < TTL_MS) return cache;

  try {
    const r = await fetch("https://api.scryfall.com/sets", {
      headers: { "User-Agent": "TCGAccounting/1.0" },
    });
    if (!r.ok) return cache ?? { byCode: {}, nameToCode: new Map(), fetchedAt: now };

    const body = (await r.json()) as {
      data: Array<{ code: string; name: string; released_at: string }>;
    };
    const byCode: Record<string, SetInfo> = {};
    const nameToCode = new Map<string, string>();

    for (const s of body.data) {
      const code = s.code.toLowerCase();
      byCode[code] = { name: s.name, released_at: s.released_at ?? "1900-01-01" };
      nameToCode.set(s.name.toLowerCase(), s.code);
    }

    cache = { byCode, nameToCode, fetchedAt: now };
    return cache;
  } catch {
    return cache ?? { byCode: {}, nameToCode: new Map(), fetchedAt: now };
  }
}

export async function getScryfallSets(): Promise<Record<string, SetInfo>> {
  const c = await fetchSets();
  return c.byCode;
}

export async function getScryfallSetCodeMap(): Promise<Map<string, string>> {
  const c = await fetchSets();
  return c.nameToCode;
}

export async function resolveSetCode(setName: string): Promise<string> {
  const codes = await getScryfallSetCodeMap();
  const lower = setName.toLowerCase();
  const exact = codes.get(lower);
  if (exact) return exact;
  for (const [sfName, sfCode] of codes) {
    if (sfName.includes(lower) || lower.includes(sfName)) return sfCode;
  }
  return "";
}
