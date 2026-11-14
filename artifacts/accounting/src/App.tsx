import { useCallback, useEffect, useState } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { Layout } from "@/components/layout";
import { ManapoolKeyPanel } from "@/components/manapool-key-panel";
import ManaPick from "@/pages/manapick";

interface ManapoolConnection {
  connected: boolean;
  scopes: string[];
  expiresAt: string | null;
}

const disconnected: ManapoolConnection = {
  connected: false,
  scopes: [],
  expiresAt: null,
};

function getOAuthErrorMessage(error: string | null): string | null {
  switch (error) {
    case "not_configured":
      return "ManaPick’s Manapool OAuth credentials are not configured yet.";
    case "invalid_scope":
      return "ManaPool rejected the requested permissions. Enable orders:read and orders:write in your OAuth app.";
    case "access_denied":
      return "You declined the ManaPick connection. No account was connected.";
    case "invalid_state":
      return "The connection request expired or could not be verified. Please try again.";
    case "connect_failed":
      return "ManaPick could not connect to Manapool. Please try again.";
    default:
      return null;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={ManaPickPage} />
      <Route path="/manapick" component={ManaPickPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function ManaPickPage() {
  const [connection, setConnection] = useState({
    ...disconnected,
    checking: true,
  });
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [keyPanelOpen, setKeyPanelOpen] = useState(false);

  const disconnect = useCallback(async (expired = false) => {
    try {
      const response = await fetch("/api/manapick/oauth/disconnect", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Disconnect failed.");
      setConnection({ ...disconnected, checking: false });
      setConnectionError(
        expired
          ? "Your ManaPool access has expired. Connect again to continue."
          : null,
      );
    } catch {
      setConnectionError("Could not disconnect from ManaPool. Please try again.");
    }
  }, []);

  const handleAccessExpired = useCallback(() => {
    void disconnect(true);
  }, [disconnect]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("manapool_error");
    setConnectionError(getOAuthErrorMessage(oauthError));

    if (params.has("manapool_error") || params.has("manapool_connected")) {
      params.delete("manapool_error");
      params.delete("manapool_connected");
      const search = params.toString();
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`,
      );
    }

    async function loadConnection() {
      try {
        const response = await fetch("/api/manapick/oauth/status", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error("Could not check the Manapool connection.");
        const body = (await response.json()) as ManapoolConnection;
        if (active) setConnection({ ...body, checking: false });
      } catch {
        if (active) {
          setConnection({ ...disconnected, checking: false });
          setConnectionError("Could not check the Manapool connection. Refresh this page to retry.");
        }
      }
    }

    void loadConnection();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!connection.connected || !connection.expiresAt) return;
    const expiresAt = Date.parse(connection.expiresAt);
    if (!Number.isFinite(expiresAt)) return;
    const timer = window.setTimeout(
      () => void disconnect(true),
      Math.max(0, expiresAt - Date.now() + 250),
    );
    return () => window.clearTimeout(timer);
  }, [connection.connected, connection.expiresAt, disconnect]);

  return (
    <Layout
      sidebarContent={
        <ManapoolKeyPanel
          connected={connection.connected}
          checking={connection.checking}
          open={keyPanelOpen}
          onOpenChange={setKeyPanelOpen}
          onDisconnect={disconnect}
        />
      }
    >
      <ManaPick
        connected={connection.connected}
        checking={connection.checking}
        connectionError={connectionError}
        onDisconnect={disconnect}
        onAccessExpired={handleAccessExpired}
      />
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
