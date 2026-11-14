import { Check, ChevronDown, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ManapoolKeyPanelProps {
  connected: boolean;
  checking: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDisconnect: () => void;
}

export function ManapoolKeyPanel({
  connected,
  checking,
  open,
  onOpenChange,
  onDisconnect,
}: ManapoolKeyPanelProps) {
  return (
    <section className="space-y-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="manapool-connection-panel"
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-sidebar-border bg-card px-3 py-3 text-left text-sm transition-colors hover:bg-sidebar-accent/50"
      >
        <span className="flex min-w-0 items-center gap-2">
          <KeyRound size={17} className="shrink-0 text-primary" />
          <span className="truncate font-medium">ManaPool</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {checking ? (
            <span className="text-xs text-muted-foreground">Checking</span>
          ) : connected ? (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
              <Check size={13} aria-hidden="true" />
              Connected
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Offline</span>
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
          id="manapool-connection-panel"
          className="space-y-3 rounded-lg border border-sidebar-border bg-card p-3"
        >
          <p className="text-xs leading-relaxed text-muted-foreground">
            {checking
              ? "Checking this browser session…"
              : connected
                ? "Connected for this browser session. You can disconnect at any time."
                : "Authorize ManaPick with your Manapool account for this browser session."}
          </p>
          {!checking && connected ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={onDisconnect}
            >
              Disconnect Manapool
            </Button>
          ) : !checking ? (
            <Button asChild size="sm" className="w-full">
              <a href="/api/manapick/oauth/start">
                <KeyRound className="mr-2 h-4 w-4" />
                Connect with Manapool
              </a>
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}
