import { render, screen, within } from "@testing-library/react";
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

  it("puts the workflow tabs in the header and names ManaPick once", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const body = url.includes("/oauth/status")
          ? { connected: true, scopes: [], expiresAt: null }
          : { orders: [], master: {}, sets: {} };
        return { ok: true, json: async () => body };
      }),
    );
    render(<App />);

    const workflow = await screen.findByRole("navigation", { name: "Workflow" });
    expect(within(workflow).getByRole("button", { name: "Pick" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(workflow).getByRole("button", { name: /Pack & Ship/ })).toBeInTheDocument();
    expect(screen.getAllByText("ManaPick")).toHaveLength(1);
    expect(screen.getByText("PICK · PACK · DONE")).toBeInTheDocument();
  });
});
