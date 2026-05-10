import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  ShoppingCart, 
  ListOrdered,
  PackageSearch,
  Check,
  Save,
} from "lucide-react";
import { useCredentials } from "@/lib/credentials-context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { email, token, setEmail, setToken, save, saved } = useCredentials();

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/purchases", label: "Purchases", icon: ShoppingCart },
    { href: "/orders", label: "Orders", icon: ListOrdered },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      <aside className="w-full md:w-64 bg-sidebar border-b md:border-b-0 md:border-r border-sidebar-border flex-shrink-0 flex flex-col">
        <div className="p-6 flex-shrink-0">
          <h1 className="text-xl font-bold tracking-tight text-sidebar-foreground">TCG Accounting</h1>
          <p className="text-xs text-muted-foreground mt-1 font-mono">SOLO SELLER TRACKER</p>
        </div>
        <nav className="px-4 flex flex-row md:flex-col gap-2 overflow-x-auto md:overflow-visible">
          {navItems.map((item) => {
            const isActive = location === item.href;
            const Icon = item.icon;
            return (
              <Link 
                key={item.href} 
                href={item.href}
                data-testid={`link-nav-${item.label.toLowerCase()}`}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive 
                    ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <Icon size={18} className={isActive ? "text-primary" : "text-muted-foreground"} />
                <span>{item.label}</span>
              </Link>
            );
          })}

          <div className="hidden md:block my-2 border-t border-sidebar-border" />

          <Link
            href="/manapick"
            data-testid="link-nav-picker"
            className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              location === "/manapick"
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            }`}
          >
            <PackageSearch size={18} className={location === "/manapick" ? "text-primary" : "text-muted-foreground"} />
            <span>ManaPick</span>
          </Link>
        </nav>

        {/* Manapool credentials — shared across Orders sync and ManaPick */}
        <div className="hidden md:block mt-auto p-4 border-t border-sidebar-border space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Manapool Credentials</p>
          <div className="space-y-1">
            <Label htmlFor="sidebar-email" className="text-xs text-sidebar-foreground">Seller Email</Label>
            <Input
              id="sidebar-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="h-8 text-xs bg-sidebar-accent/30 border-sidebar-border"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sidebar-token" className="text-xs text-sidebar-foreground">API Key</Label>
            <Input
              id="sidebar-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="••••••••"
              className="h-8 text-xs bg-sidebar-accent/30 border-sidebar-border"
            />
          </div>
          <Button
            size="sm"
            className="w-full h-8 text-xs"
            onClick={save}
            variant={saved ? "outline" : "default"}
          >
            {saved ? <><Check size={12} className="mr-1" /> Saved</> : <><Save size={12} className="mr-1" /> Save credentials</>}
          </Button>
        </div>
      </aside>
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {location === "/manapick" ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {children}
          </div>
        ) : (
          <div className="p-6 md:p-8 flex-1 w-full max-w-6xl mx-auto">
            {children}
          </div>
        )}
      </main>
    </div>
  );
}
