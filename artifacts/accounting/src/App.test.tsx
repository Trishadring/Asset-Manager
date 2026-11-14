import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("ManaPick home page credentials", () => {
  it("opens and focuses the sidebar key form from Enter credentials", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Enter credentials" }));

    const emailInput = screen.getByLabelText("Email");
    expect(emailInput).toBeVisible();
    expect(emailInput).toHaveFocus();
    expect(screen.getByRole("button", { name: /Manapool key/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
