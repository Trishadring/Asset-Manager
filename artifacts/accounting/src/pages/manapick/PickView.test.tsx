import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PickView, type SetGroup } from "./PickView";

const groups: SetGroup[] = [
  {
    setCode: "mmq",
    setInfo: { name: "Mercadian Masques", released_at: "1999-10-01" },
    cards: [
      [
        "Counterspell|mmq|71|nonfoil",
        {
          name: "Counterspell",
          set: "mmq",
          collector_number: "71",
          finish: "nonfoil",
          quantity: 3,
          allocations: { "order-1": 2 },
          scryfall_id: "abc",
        },
      ],
    ],
  },
  {
    setCode: "tmp",
    setInfo: undefined,
    cards: [
      [
        "Dark Ritual|tmp|1|nonfoil",
        {
          name: "Dark Ritual",
          set: "tmp",
          collector_number: "1",
          finish: "nonfoil",
          quantity: 1,
          allocations: { "order-2": 1 },
        },
      ],
    ],
  },
];

describe("PickView", () => {
  it("renders set names", () => {
    render(
      <PickView
        setGroups={groups}
        orderToBin={{}}
        picked={{}}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("Mercadian Masques")).toBeInTheDocument();
    expect(screen.getByText("TMP")).toBeInTheDocument();
  });

  it("renders set codes beneath names", () => {
    render(
      <PickView
        setGroups={groups}
        orderToBin={{}}
        picked={{}}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("MMQ")).toBeInTheDocument();
  });

  it("renders card items within each set", () => {
    render(
      <PickView
        setGroups={groups}
        orderToBin={{}}
        picked={{}}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Counterspell").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Dark Ritual").length).toBeGreaterThanOrEqual(1);
  });

  it("renders no sets when empty", () => {
    const { container } = render(
      <PickView
        setGroups={[]}
        orderToBin={{}}
        picked={{}}
        onToggle={vi.fn()}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("passes onToggle to CardItem", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(
      <PickView
        setGroups={groups}
        orderToBin={{ "order-1": 1 }}
        picked={{}}
        onToggle={onToggle}
      />,
    );
    await user.click(screen.getByText("○ Bin 1 ×2"));
    expect(onToggle).toHaveBeenCalledWith("Counterspell|mmq|71|nonfoil|order-1");
  });
});
