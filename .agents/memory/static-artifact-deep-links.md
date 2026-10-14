---
name: Static artifact deep links
description: Replit routing behavior for nested URLs on path-mounted static artifacts.
---

When a static artifact is mounted under a path prefix, production may serve the artifact root and its assets but still 404 direct nested page URLs, even with a rewrite in `artifact.toml`. Try a root-level, prefix-scoped `.replit` deployment rewrite to the artifact's `index.html`.

**Why:** Production served `/accounting/` and static assets but returned 404 for `/accounting/manapick`; the artifact-level rewrite change alone did not fix the deployed route. The root rewrite must be republished and its effect verified.

**How to apply:** Confirm the artifact's path prefix, add a narrow `.replit` `[[deployment.rewrites]]` rule for that prefix, validate with `verifyAndReplaceDotReplit`, republish, then test the exact nested production URL.
