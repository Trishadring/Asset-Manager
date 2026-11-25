// Bundles src/**/*.test.ts with esbuild and runs them with the Node test runner.
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(artifactDir, "src");

async function findTests(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await findTests(full)));
    else if (entry.name.endsWith(".test.ts")) found.push(full);
  }
  return found;
}

const tests = await findTests(srcDir);
if (tests.length === 0) {
  console.error("No tests found");
  process.exit(1);
}

const outDir = await mkdtemp(path.join(tmpdir(), "api-server-test-"));
try {
  await build({
    entryPoints: tests,
    outdir: outDir,
    outbase: srcDir,
    outExtension: { ".js": ".mjs" },
    platform: "node",
    format: "esm",
    bundle: true,
    packages: "external",
    logLevel: "warning",
  });
  const files = (await readdir(outDir, { recursive: true }))
    .filter((f) => f.endsWith(".test.mjs"))
    .map((f) => path.join(outDir, f));
  const result = spawnSync(process.execPath, ["--test", ...files], {
    stdio: "inherit",
  });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(outDir, { recursive: true, force: true });
}
