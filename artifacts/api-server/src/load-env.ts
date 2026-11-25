import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Optionally loads <repo>/local.env for local development. This replaces the
// `node --env-file-if-exists` flag, which is missing from older supported Node
// versions. It must be imported before any module that reads process.env.
// Variables already set in the environment take precedence.
const here = path.dirname(fileURLToPath(import.meta.url));
const localEnv = path.resolve(here, "../../../local.env");

if (existsSync(localEnv)) {
  process.loadEnvFile(localEnv);
}
