import { Link, useLocation } from "wouter";
import { PackageSearch } from "lucide-react";

export function Layout({
  children,
  sidebarContent,
}: {
  children: React.ReactNode;
  sidebarContent?: React.ReactNode;
}) {
  const [location] = useLocation();

  const isManaPickActive = location === "/" || location === "/manapick";

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      <aside className="w-full md:w-64 bg-sidebar border-b md:border-b-0 md:border-r border-sidebar-border flex-shrink-0 flex flex-col">
        <div className="p-6 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
              <PackageSearch size={20} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-sidebar-foreground">ManaPick</h1>
              <p className="text-xs text-muted-foreground mt-1 font-mono">PICK · PACK · SHIP</p>
            </div>
          </div>
        </div>
        <nav className="px-4 flex flex-row md:flex-col gap-2 overflow-x-auto md:overflow-visible">
          <Link
            href="/"
            data-testid="link-nav-picker"
            className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              isManaPickActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            }`}
          >
            <PackageSearch size={18} className={isManaPickActive ? "text-primary" : "text-muted-foreground"} />
            <span>ManaPick</span>
          </Link>

        </nav>
        {sidebarContent && (
          <div className="px-4 pb-5 pt-3">
            {sidebarContent}
          </div>
        )}
      </aside>
      <main className="flex-1 flex flex-col min-w-0 max-h-screen overflow-y-auto">
        <div className="p-6 md:p-8 flex-1 w-full max-w-6xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
