import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EbaySection } from "./EbaySection";
import type { EbayPickOrder } from "./types";

const baseOrders: EbayPickOrder[] = [
  {
    id: "order-1",
    lineItems: [
      { title: "Mox Ruby", quantity: 1, imageUrl: null },
      { title: "Black Lotus", quantity: 1, imageUrl: null },
    ],
  },
];

describe("EbaySection", () => {
  it("renders order id and item count", () => {
    render(
      <EbaySection
        orders={baseOrders}
        ebayPacked={{}}
        setEbayPacked={vi.fn()}
      />,
    );
    expect(screen.getByText(/order-1/)).toBeInTheDocument();
    expect(screen.getByText(/2 items?/)).toBeInTheDocument();
  });

  it("renders all line items", () => {
    render(
      <EbaySection
        orders={baseOrders}
        ebayPacked={{}}
        setEbayPacked={vi.fn()}
      />,
    );
    expect(screen.getByText("Mox Ruby")).toBeInTheDocument();
    expect(screen.getByText("Black Lotus")).toBeInTheDocument();
  });

  it("shows quantity when > 1", () => {
    const orders: EbayPickOrder[] = [
      {
        id: "order-1",
        lineItems: [
          { title: "Mox Ruby", quantity: 3, imageUrl: null },
        ],
      },
    ];
    render(
      <EbaySection
        orders={orders}
        ebayPacked={{}}
        setEbayPacked={vi.fn()}
      />,
    );
    expect(screen.getByText("×3")).toBeInTheDocument();
  });

  it("shows Mark Packed button for pending orders", () => {
    render(
      <EbaySection
        orders={baseOrders}
        ebayPacked={{}}
        setEbayPacked={vi.fn()}
      />,
    );
    expect(screen.getByText("Mark Packed")).toBeInTheDocument();
  });

  it("calls setEbayPacked when Mark Packed clicked", async () => {
    const setter = vi.fn();
    const user = userEvent.setup();
    render(
      <EbaySection
        orders={baseOrders}
        ebayPacked={{}}
        setEbayPacked={setter}
      />,
    );
    await user.click(screen.getByText("Mark Packed"));
    expect(setter).toHaveBeenCalled();
  });

  it("hides packed orders", () => {
    render(
      <EbaySection
        orders={baseOrders}
        ebayPacked={{ "order-1": true }}
        setEbayPacked={vi.fn()}
      />,
    );
    expect(screen.queryByText(/order-1/)).toBeNull();
    expect(screen.getByText("All eBay orders packed!")).toBeInTheDocument();
  });

  it("shows pending count", () => {
    const orders: EbayPickOrder[] = [
      { id: "a", lineItems: [{ title: "Card A", quantity: 1, imageUrl: null }] },
      { id: "b", lineItems: [{ title: "Card B", quantity: 1, imageUrl: null }] },
    ];
    render(
      <EbaySection
        orders={orders}
        ebayPacked={{ a: true }}
        setEbayPacked={vi.fn()}
      />,
    );
    expect(screen.getByText("(1 pending)")).toBeInTheDocument();
  });
});
