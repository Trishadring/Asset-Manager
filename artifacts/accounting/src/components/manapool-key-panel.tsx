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
  const status = checking ? "Checking" : connected ? "Connected" : "Offline";

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="manapool-connection-panel"
        onClick={() => onOpenChange(!open)}
        className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-accent"
      >
        <KeyRound size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        <span>Manapool</span>
        <span
          className={`inline-flex items-center gap-1 text-xs ${
            connected && !checking ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"
          }`}
        >
          {connected && !checking ? (
            <Check size={13} aria-hidden="true" />
          ) : (
            <span
              className="h-2 w-2 rounded-full bg-muted-foreground"
              aria-hidden="true"
            />
          )}
          {status}
        </span>
        <ChevronDown
          size={15}
          className={`text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          id="manapool-connection-panel"
          className="absolute right-0 top-full z-50 mt-2 w-64 space-y-3 rounded-lg border border-border bg-popover p-3 text-popover-foreground"
        >
          <p className="text-xs leading-relaxed text-muted-foreground">
            {checking
              ? "Checking this browser session…"
              : connected
                ? "Connected for this browser session. You can disconnect at any time."
                : "Authorize with your Manapool account for this browser session."}
          </p>
          {!checking && connected ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={onDisconnect}
            >
              Disconnect
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
    </div>
  );
}
