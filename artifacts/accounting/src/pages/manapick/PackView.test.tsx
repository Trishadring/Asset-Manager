import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PackView } from "./PackView";
import type { Order, Master } from "./types";

const baseOrders: Order[] = [
  {
    id: "order-1",
    label: "ORD-001",
    shipping_address: {
      name: "Alice",
      line1: "123 Main St",
      city: "Portland",
      state: "OR",
      postal_code: "97201",
    },
    shipping_method: "USPS First Class",
    items: [
      {
        quantity: 2,
        product: {
          single: {
            name: "Counterspell",
            set: "mmq",
            number: "71",
            scryfall_id: "abc",
          },
        },
      },
    ],
  },
];

const baseMaster: Master = {
  "Counterspell|mmq|71|nonfoil": {
    name: "Counterspell",
    set: "mmq",
    collector_number: "71",
    finish: "nonfoil",
    quantity: 2,
    scryfall_id: "abc",
    allocations: { "order-1": 2 },
  },
};

describe("PackView", () => {
  it("renders bin reference", () => {
    render(
      <PackView
        orders={baseOrders}
        master={baseMaster}
        orderToBin={{ "order-1": 1 }}
        shipped={{}}
        tracking={{}}
        onShip={vi.fn()}
        onTrackingChange={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Bin 1").length).toBe(2);
  });

  it("renders shipping address", () => {
    render(
      <PackView
        orders={baseOrders}
        master={baseMaster}
        orderToBin={{ "order-1": 1 }}
        shipped={{}}
        tracking={{}}
        onShip={vi.fn()}
        onTrackingChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("123 Main St")).toBeInTheDocument();
    expect(screen.getByText("Portland, OR, 97201")).toBeInTheDocument();
    expect(screen.getByText(/USPS First Class/)).toBeInTheDocument();
  });

  it("renders card images for orders", () => {
    render(
      <PackView
        orders={baseOrders}
        master={baseMaster}
        orderToBin={{ "order-1": 1 }}
        shipped={{}}
        tracking={{}}
        onShip={vi.fn()}
        onTrackingChange={vi.fn()}
      />,
    );
    const alts = screen.getAllByAltText("Counterspell");
    expect(alts.length).toBeGreaterThanOrEqual(1);
  });

  it("shows Mark Shipped button", () => {
    render(
      <PackView
        orders={baseOrders}
        master={baseMaster}
        orderToBin={{ "order-1": 1 }}
        shipped={{}}
        tracking={{}}
        onShip={vi.fn()}
        onTrackingChange={vi.fn()}
      />,
    );
    const buttons = screen.getAllByText("Mark Shipped");
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it("calls onShip when Mark Shipped clicked", async () => {
    const onShip = vi.fn();
    const user = userEvent.setup();
    render(
      <PackView
        orders={baseOrders}
        master={baseMaster}
        orderToBin={{ "order-1": 1 }}
        shipped={{}}
        tracking={{}}
        onShip={onShip}
        onTrackingChange={vi.fn()}
      />,
    );
    await user.click(screen.getByText("Mark Shipped"));
    expect(onShip).toHaveBeenCalledWith("order-1");
  });

  it("calls onTrackingChange when tracking input changes", () => {
    const onTrackingChange = vi.fn();
    render(
      <PackView
        orders={baseOrders}
        master={baseMaster}
        orderToBin={{ "order-1": 1 }}
        shipped={{}}
        tracking={{}}
        onShip={vi.fn()}
        onTrackingChange={onTrackingChange}
      />,
    );
    const inputs = screen.getAllByPlaceholderText("Tracking number (optional)");
    fireEvent.change(inputs[0], { target: { value: "TRACK123" } });
    expect(onTrackingChange).toHaveBeenCalledWith("order-1", "TRACK123");
  });

  it("hides shipped orders", () => {
    render(
      <PackView
        orders={baseOrders}
        master={baseMaster}
        orderToBin={{ "order-1": 1 }}
        shipped={{ "order-1": true }}
        tracking={{}}
        onShip={vi.fn()}
        onTrackingChange={vi.fn()}
      />,
    );
    expect(screen.getByText("All orders packed & shipped!")).toBeInTheDocument();
    expect(screen.queryByText("Mark Shipped")).toBeNull();
  });
});
