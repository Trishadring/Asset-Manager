import { PackageSearch } from "lucide-react";

export function Layout({
  children,
  header,
}: {
  children: React.ReactNode;
  header?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-screen-xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2 md:px-8">
          <div className="flex min-h-12 shrink-0 items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <PackageSearch size={18} aria-hidden="true" />
            </div>
            <span className="text-base font-semibold tracking-tight">ManaPick</span>
            <span className="font-mono text-xs tracking-wide text-muted-foreground">
              PICK · PACK · DONE
            </span>
          </div>
          {header}
        </div>
      </header>
      <main className="flex-1 w-full py-6">
        <div className="mx-auto w-full max-w-screen-xl px-4 md:px-8">
          {children}
        </div>
      </main>
    </div>
  );
}
