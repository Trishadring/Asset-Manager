import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  scryfallDirectUrl,
  cardImageFromData,
  entryImageUrl,
  colorSortIndex,
  parseCollectorNumber,
  formatDate,
  formatRelativeTime,
  type ScryfallCard,
  type MasterEntry,
} from "./types";

describe("scryfallDirectUrl", () => {
  it("returns null for undefined", () => {
    expect(scryfallDirectUrl(undefined)).toBeNull();
  });

  it("returns null for short id", () => {
    expect(scryfallDirectUrl("a")).toBeNull();
  });

  it("builds correct Scryfall CDN URL", () => {
    const url = scryfallDirectUrl("abc123");
    expect(url).toBe(
      "https://cards.scryfall.io/normal/front/a/b/abc123.jpg",
    );
  });
});

describe("cardImageFromData", () => {
  const baseCard: ScryfallCard = {
    id: "test",
    name: "Test Card",
    set: "test",
    collector_number: "1",
  };

  it("returns null for undefined", () => {
    expect(cardImageFromData(undefined)).toBeNull();
  });

  it("returns normal URI when available", () => {
    const card = { ...baseCard, image_uris: { normal: "https://example.com/normal.jpg", large: "https://example.com/large.jpg" } };
    expect(cardImageFromData(card)).toBe("https://example.com/normal.jpg");
  });

  it("falls back to large when normal missing", () => {
    const card = { ...baseCard, image_uris: { large: "https://example.com/large.jpg" } };
    expect(cardImageFromData(card)).toBe("https://example.com/large.jpg");
  });

  it("falls back to card_faces when image_uris missing", () => {
    const card = { ...baseCard, card_faces: [{ image_uris: { normal: "https://example.com/face.jpg" } }] };
    expect(cardImageFromData(card)).toBe("https://example.com/face.jpg");
  });

  it("returns null when no images available", () => {
    expect(cardImageFromData(baseCard)).toBeNull();
  });
});

describe("entryImageUrl", () => {
  it("prioritizes scryfall data over direct URL", () => {
    const entry: MasterEntry = {
      name: "Test",
      set: "test",
      collector_number: "1",
      finish: "nonfoil",
      quantity: 1,
      allocations: {},
      scryfall: {
        id: "test",
        name: "Test",
        set: "test",
        collector_number: "1",
        image_uris: { normal: "https://example.com/scryfall.jpg" },
      },
      scryfall_id: "abc123",
    };
    expect(entryImageUrl(entry)).toBe("https://example.com/scryfall.jpg");
  });

  it("falls back to scryfallDirectUrl when no scryfall data", () => {
    const entry: MasterEntry = {
      name: "Test",
      set: "test",
      collector_number: "1",
      finish: "nonfoil",
      quantity: 1,
      allocations: {},
      scryfall_id: "abc123",
    };
    expect(entryImageUrl(entry)).toBe(
      "https://cards.scryfall.io/normal/front/a/b/abc123.jpg",
    );
  });

  it("returns null when no image source", () => {
    const entry: MasterEntry = {
      name: "Test",
      set: "test",
      collector_number: "1",
      finish: "nonfoil",
      quantity: 1,
      allocations: {},
    };
    expect(entryImageUrl(entry)).toBeNull();
  });
});

describe("colorSortIndex", () => {
  it("returns 9 for undefined card", () => {
    expect(colorSortIndex(undefined)).toBe(9);
  });

  it("returns 8 for lands", () => {
    const card: ScryfallCard = {
      id: "1",
      name: "Forest",
      set: "test",
      collector_number: "1",
      type_line: "Land — Forest",
    };
    expect(colorSortIndex(card)).toBe(8);
  });

  it("returns 7 for colorless", () => {
    const card: ScryfallCard = {
      id: "1",
      name: "Artifact",
      set: "test",
      collector_number: "1",
      colors: [],
    };
    expect(colorSortIndex(card)).toBe(7);
  });

  it("returns 6 for multicolor", () => {
    const card: ScryfallCard = {
      id: "1",
      name: "Dual",
      set: "test",
      collector_number: "1",
      colors: ["W", "U"],
    };
    expect(colorSortIndex(card)).toBe(6);
  });

  it("returns correct index for mono-colors", () => {
    const colors: Array<[string[], number]> = [
      [["W"], 1],
      [["U"], 2],
      [["B"], 3],
      [["R"], 4],
      [["G"], 5],
    ];
    for (const [c, expected] of colors) {
      const card: ScryfallCard = {
        id: "1",
        name: "Test",
        set: "test",
        collector_number: "1",
        colors: c,
      };
      expect(colorSortIndex(card)).toBe(expected);
    }
  });
});

describe("parseCollectorNumber", () => {
  it("parses numeric prefix", () => {
    expect(parseCollectorNumber("123a")).toEqual([123, "123a"]);
  });

  it("handles pure numbers", () => {
    expect(parseCollectorNumber("42")).toEqual([42, "42"]);
  });

  it("returns 0 for non-numeric", () => {
    expect(parseCollectorNumber("ABC")).toEqual([0, "ABC"]);
  });

  it("handles empty string", () => {
    expect(parseCollectorNumber("")).toEqual([0, ""]);
  });
});

describe("formatDate", () => {
  it("formats ISO date", () => {
    const result = formatDate("2024-03-15");
    expect(result).toContain("Mar");
    expect(result).toContain("2024");
  });

  it("returns raw string on parse failure", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date");
  });
});

describe("formatRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for < 1 min', () => {
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    expect(formatRelativeTime(Date.now() - 1000)).toBe("just now");
  });

  it("returns minutes ago", () => {
    const then = Date.now() - 5 * 60 * 1000;
    expect(formatRelativeTime(then)).toBe("5m ago");
  });

  it("returns hours ago", () => {
    const then = Date.now() - 3 * 60 * 60 * 1000;
    expect(formatRelativeTime(then)).toBe("3h ago");
  });

  it("returns days ago", () => {
    const then = Date.now() - 2 * 24 * 60 * 60 * 1000;
    expect(formatRelativeTime(then)).toBe("2d ago");
  });
});
