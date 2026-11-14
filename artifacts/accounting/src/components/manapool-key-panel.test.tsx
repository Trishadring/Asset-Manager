import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ManapoolKeyPanel } from "./manapool-key-panel";

describe("ManapoolKeyPanel", () => {
  it("keeps the connection panel collapsed and links to ManaPool authorization", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);

      return (
        <ManapoolKeyPanel
          connected={false}
          checking={false}
          open={open}
          onOpenChange={setOpen}
          onDisconnect={vi.fn()}
        />
      );
    }

    render(<Harness />);

    expect(
      screen.queryByRole("link", { name: /Connect with Manapool/i }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /ManaPool/i }),
    );

    expect(
      screen.getByRole("link", { name: /Connect with Manapool/i }),
    ).toHaveAttribute("href", "/api/manapick/oauth/start");
  });
});
