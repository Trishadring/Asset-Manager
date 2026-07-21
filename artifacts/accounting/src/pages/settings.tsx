import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, KeyRound } from "lucide-react";

export default function Settings() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings/manapool", { credentials: "include" })
      .then((r) => r.json())
      .then((d: { email?: string; hasToken?: boolean }) => {
        setEmail(d.email ?? "");
        setHasToken(!!d.hasToken);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      toast({ title: "Email is required", variant: "destructive" });
      return;
    }
    if (!token.trim()) {
      toast({ title: "Access token is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/settings/manapool", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), token: token.trim() }),
      });
      if (!r.ok) throw new Error("Save failed");
      setHasToken(true);
      setToken("");
      toast({ title: "Credentials saved", description: "Manapool credentials have been saved to the database." });
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-lg space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure API credentials for external services.
        </p>
      </div>

      <section className="border rounded-lg p-6 space-y-5">
        <div className="flex items-center gap-2">
          <KeyRound size={18} className="text-muted-foreground" />
          <h2 className="font-semibold">Manapool Credentials</h2>
          {hasToken && (
            <span className="ml-auto flex items-center gap-1 text-xs text-green-600">
              <CheckCircle2 size={13} />
              Configured
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Your Manapool account email and access token. The token can be found in your Manapool seller account settings.
        </p>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="mp-email">Email</Label>
              <Input
                id="mp-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mp-token">
                Access Token
                {hasToken && <span className="ml-2 text-xs text-muted-foreground">(leave blank to keep existing)</span>}
              </Label>
              <Input
                id="mp-token"
                type="password"
                placeholder={hasToken ? "••••••••••••" : "Paste your access token"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
              />
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save credentials"}
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}
