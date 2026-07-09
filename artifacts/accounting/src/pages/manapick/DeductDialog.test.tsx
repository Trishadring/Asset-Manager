import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeductDialog } from "./DeductDialog";
import type { DeductionResult } from "@/hooks/use-tcgplayer";

const basePreview: DeductionResult = {
  preview: true,
  plan: [
    {
      name: "Counterspell",
      tcgplayerSku: 123,
      orderQuantity: 2,
      currentQuantity: 5,
      newQuantity: 3,
      priceCents: 200,
      inventoryId: "inv-1",
      status: "ok",
    },
    {
      name: "Dark Ritual",
      tcgplayerSku: 456,
      orderQuantity: 1,
      currentQuantity: 1,
      newQuantity: 0,
      priceCents: 100,
      inventoryId: "inv-2",
      status: "insufficient",
    },
  ],
  notFound: [{ name: "Mox Ruby", tcgplayerSku: 789 }],
};

describe("DeductDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <DeductDialog
        open={false}
        onOpenChange={vi.fn()}
        deductPreview={null}
        isPending={false}
        onApply={vi.fn()}
      />,
    );
    expect(container.textContent).toBeFalsy();
  });

  it("renders title when open with preview", () => {
    render(
      <DeductDialog
        open={true}
        onOpenChange={vi.fn()}
        deductPreview={basePreview}
        isPending={false}
        onApply={vi.fn()}
      />,
    );
    const titles = screen.getAllByText("Preview: Deduct from Manapool");
    expect(titles.length).toBeGreaterThanOrEqual(1);
  });

  it("shows stats counts", () => {
    render(
      <DeductDialog
        open={true}
        onOpenChange={vi.fn()}
        deductPreview={basePreview}
        isPending={false}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Will update")).toBeInTheDocument();
    expect(screen.getByText("No change needed")).toBeInTheDocument();
    expect(screen.getByText("Not on Manapool")).toBeInTheDocument();
  });

  it("shows quantity changes", () => {
    render(
      <DeductDialog
        open={true}
        onOpenChange={vi.fn()}
        deductPreview={basePreview}
        isPending={false}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByText("Counterspell")).toBeInTheDocument();
    expect(screen.getByText("Dark Ritual")).toBeInTheDocument();
    expect(screen.getByText("(low stock)")).toBeInTheDocument();
  });

  it("shows not found items", () => {
    render(
      <DeductDialog
        open={true}
        onOpenChange={vi.fn()}
        deductPreview={basePreview}
        isPending={false}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByText(/Mox Ruby/)).toBeInTheDocument();
    expect(screen.getByText(/SKU 789/)).toBeInTheDocument();
  });

  it("renders Cancel and Apply buttons", () => {
    render(
      <DeductDialog
        open={true}
        onOpenChange={vi.fn()}
        deductPreview={basePreview}
        isPending={false}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Cancel").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Apply/).length).toBeGreaterThanOrEqual(1);
  });

  it("calls onApply when Apply clicked", async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(
      <DeductDialog
        open={true}
        onOpenChange={vi.fn()}
        deductPreview={basePreview}
        isPending={false}
        onApply={onApply}
      />,
    );
    await user.click(screen.getAllByText(/Apply/)[0]);
    expect(onApply).toHaveBeenCalledOnce();
  });

  it("calls onOpenChange(false) when Cancel clicked", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DeductDialog
        open={true}
        onOpenChange={onOpenChange}
        deductPreview={basePreview}
        isPending={false}
        onApply={vi.fn()}
      />,
    );
    await user.click(screen.getAllByText("Cancel")[0]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows applied state when deduction applied", () => {
    const appliedPreview: DeductionResult = {
      ...basePreview,
      preview: false,
      applied: true,
      updated: 1,
    };
    render(
      <DeductDialog
        open={true}
        onOpenChange={vi.fn()}
        deductPreview={appliedPreview}
        isPending={false}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByText("Manapool quantities updated")).toBeInTheDocument();
    expect(
      screen.getByText((c) => c.includes("updated on Manapool")),
    ).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("shows Updating text when isPending", () => {
    render(
      <DeductDialog
        open={true}
        onOpenChange={vi.fn()}
        deductPreview={basePreview}
        isPending={true}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByText("Updating…")).toBeInTheDocument();
  });
});
