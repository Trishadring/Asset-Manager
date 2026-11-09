import { useState } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { Layout } from "@/components/layout";
import { ManapoolKeyPanel } from "@/components/manapool-key-panel";
import ManaPick from "@/pages/manapick";
import type { ManaPoolCredentials } from "@/pages/manapick/OrdersProvider";

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
  const [credentials, setCredentials] = useState<ManaPoolCredentials | null>(null);
  const [keyPanelOpen, setKeyPanelOpen] = useState(false);

  function openKeyPanel() {
    setKeyPanelOpen(true);
  }

  function changeCredentials() {
    setCredentials(null);
    setKeyPanelOpen(true);
  }

  return (
    <Layout
      sidebarContent={
        <ManapoolKeyPanel
          credentials={credentials}
          open={keyPanelOpen}
          onOpenChange={setKeyPanelOpen}
          onSave={(nextCredentials) => {
            setCredentials(nextCredentials);
            setKeyPanelOpen(false);
          }}
          onClear={() => setCredentials(null)}
        />
      }
    >
      <ManaPick
        credentials={credentials}
        onOpenCredentials={openKeyPanel}
        onChangeCredentials={changeCredentials}
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
