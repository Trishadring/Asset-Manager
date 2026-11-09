---
name: Static artifact deep links
description: Replit routing behavior for nested URLs on path-mounted static artifacts.
---

In this pnpm artifact workspace, configure SPA fallback rewrites in the artifact's `artifact.toml`; the root `.replit` file is not the source of truth for per-artifact deployment routes.

**Why:** Artifact manifests define each deployed service and its route rules. Root-level deployment settings do not replace the per-artifact configuration.

**How to apply:** Confirm the artifact's path prefix, add the SPA fallback under its production service rewrites, validate with `verifyAndReplaceArtifactToml`, republish, and test the exact nested production URL.
