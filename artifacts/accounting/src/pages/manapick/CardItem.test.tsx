import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CardItem } from "./CardItem";
import type { MasterEntry } from "./types";

const baseEntry: MasterEntry = {
  name: "Counterspell",
  set: "mmq",
  collector_number: "71",
  finish: "nonfoil",
  quantity: 3,
  allocations: { "order-1": 2, "order-2": 1 },
  scryfall_id: "abc123",
};

describe("CardItem", () => {
  it("renders card name and set info", () => {
    render(
      <CardItem
        cardKey="Counterspell|mmq|71|nonfoil"
        entry={baseEntry}
        orderToBin={{ "order-1": 1, "order-2": 2 }}
        picked={{}}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("Counterspell")).toBeInTheDocument();
    expect(screen.getByText(/MMQ/)).toBeInTheDocument();
  });

  it("renders allocation buttons for each order", () => {
    render(
      <CardItem
        cardKey="Counterspell|mmq|71|nonfoil"
        entry={baseEntry}
        orderToBin={{ "order-1": 1, "order-2": 2 }}
        picked={{}}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("○ Bin 1 ×2")).toBeInTheDocument();
    expect(screen.getByText("○ Bin 2 ×1")).toBeInTheDocument();
  });

  it("shows picked state as checked", () => {
    render(
      <CardItem
        cardKey="Counterspell|mmq|71|nonfoil"
        entry={baseEntry}
        orderToBin={{ "order-1": 1, "order-2": 2 }}
        picked={{
          "Counterspell|mmq|71|nonfoil|order-1": true,
        }}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("✓ Bin 1 ×2")).toBeInTheDocument();
  });

  it("calls onToggle when allocation button clicked", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(
      <CardItem
        cardKey="Counterspell|mmq|71|nonfoil"
        entry={baseEntry}
        orderToBin={{ "order-1": 1, "order-2": 2 }}
        picked={{}}
        onToggle={onToggle}
      />,
    );
    await user.click(screen.getByText("○ Bin 1 ×2"));
    expect(onToggle).toHaveBeenCalledWith("Counterspell|mmq|71|nonfoil|order-1");
  });

  it("shows TCGPlayer badge for tcgplayer source", () => {
    render(
      <CardItem
        cardKey="key"
        entry={{ ...baseEntry, source: "tcgplayer" }}
        orderToBin={{}}
        picked={{}}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("TCG")).toBeInTheDocument();
  });

  it("renders card image when available", () => {
    render(
      <CardItem
        cardKey="key"
        entry={baseEntry}
        orderToBin={{ "order-1": 1 }}
        picked={{}}
        onToggle={vi.fn()}
      />,
    );
    const img = screen.getByAltText("Counterspell") as HTMLImageElement;
    expect(img.src).toContain("cards.scryfall.io");
  });

  it("shows placeholder when no image", () => {
    render(
      <CardItem
        cardKey="key"
        entry={{ ...baseEntry, scryfall_id: undefined }}
        orderToBin={{ "order-1": 1 }}
        picked={{}}
        onToggle={vi.fn()}
      />,
    );
    const all = screen.getAllByText("Counterspell");
    expect(all.length).toBe(2);
    expect(screen.queryByRole("img")).toBeNull();
  });
});
