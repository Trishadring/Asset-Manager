import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

describe("ManaPick home page credentials", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("links the home-page connect action to the OAuth start route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          connected: false,
          scopes: [],
          expiresAt: null,
        }),
      }),
    );
    render(<App />);

    const connectLink = await screen.findByRole("link", {
      name: /Connect with Manapool/i,
    });
    expect(connectLink).toHaveAttribute("href", "/api/manapick/oauth/start");
  });
});
