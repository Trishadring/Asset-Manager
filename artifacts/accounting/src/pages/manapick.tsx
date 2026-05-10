export default function ManaPick() {
  return (
    <div className="-m-6 md:-m-8 h-[calc(100vh-0px)] flex flex-col">
      <div className="px-6 md:px-8 py-4 border-b flex-shrink-0">
        <h2 className="text-xl font-bold tracking-tight">ManaPick</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Order picking tool — sorted by physical box</p>
      </div>
      <iframe
        src="/"
        className="flex-1 w-full border-0"
        title="ManaPick"
      />
    </div>
  );
}
