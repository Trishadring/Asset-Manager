import { useState } from "react";
import { Check, ChevronDown, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ManaPoolCredentials } from "@/pages/manapick/OrdersProvider";

interface ManapoolKeyPanelProps {
  credentials: ManaPoolCredentials | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (credentials: ManaPoolCredentials) => void;
  onClear: () => void;
}

export function ManapoolKeyPanel({
  credentials,
  open,
  onOpenChange,
  onSave,
  onClear,
}: ManapoolKeyPanelProps) {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedEmail = email.trim();
    const trimmedToken = token.trim();
    if (!trimmedEmail || !trimmedToken) return;

    onSave({ email: trimmedEmail, token: trimmedToken });
    setEmail("");
    setToken("");
  }

  function clearCredentials() {
    onClear();
    setEmail("");
    setToken("");
  }

  return (
    <section className="space-y-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="manapool-key-panel"
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-sidebar-border bg-card px-3 py-3 text-left text-sm transition-colors hover:bg-sidebar-accent/50"
      >
        <span className="flex min-w-0 items-center gap-2">
          <KeyRound size={17} className="shrink-0 text-primary" />
          <span className="truncate font-medium">Manapool key</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {credentials ? (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
              <Check size={13} aria-hidden="true" />
              Active
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Not set</span>
          )}
          <ChevronDown
            size={15}
            className={`text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </span>
      </button>

      {open && (
        <div
          id="manapool-key-panel"
          className="space-y-3 rounded-lg border border-sidebar-border bg-card p-3"
        >
          <p className="text-xs leading-relaxed text-muted-foreground">
            Entered for this visit only. The app key is masked and not saved.
          </p>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="mp-side-email" className="text-xs">Email</Label>
              <Input
                id="mp-side-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="off"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mp-side-token" className="text-xs">App key</Label>
              <Input
                id="mp-side-token"
                type="password"
                placeholder="Manapool app key"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                autoComplete="off"
                required
              />
            </div>
            <Button type="submit" size="sm" className="w-full">
              {credentials ? "Update key" : "Connect"}
            </Button>
          </form>
          {credentials && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={clearCredentials}
            >
              Clear session key
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
