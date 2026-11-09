import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ManapoolKeyPanel } from "./manapool-key-panel";

describe("ManapoolKeyPanel", () => {
  it("keeps the key form collapsed, masks the key, and saves credentials", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    function Harness() {
      const [open, setOpen] = useState(false);

      return (
        <ManapoolKeyPanel
          credentials={null}
          open={open}
          onOpenChange={setOpen}
          onSave={(credentials) => {
            onSave(credentials);
            setOpen(false);
          }}
          onClear={vi.fn()}
        />
      );
    }

    render(<Harness />);

    expect(screen.queryByLabelText("App key")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Manapool key/i }));

    const emailInput = screen.getByLabelText("Email");
    const keyInput = screen.getByLabelText("App key");
    expect(keyInput).toHaveAttribute("type", "password");

    await user.type(emailInput, "seller@example.com");
    await user.type(keyInput, "sample-app-key");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(onSave).toHaveBeenCalledWith({
      email: "seller@example.com",
      token: "sample-app-key",
    });
    expect(screen.queryByLabelText("App key")).not.toBeInTheDocument();
  });
});
