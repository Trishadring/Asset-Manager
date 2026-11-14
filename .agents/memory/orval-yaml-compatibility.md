---
name: Orval YAML compatibility
description: The js-yaml major version required for API contract code generation.
---

Keep Orval's `js-yaml` dependency on the compatible 4.x line. Orval 8.5.3 imports the package's default export, which `js-yaml` 5.x does not provide.

**Why:** The workspace-wide `>=4.2.0` override resolved `js-yaml` 5.2.1 and stopped API code generation before the OpenAPI file was read. Resolving to 4.3.2 restored code generation.

**How to apply:** When changing the workspace `js-yaml` override or upgrading Orval, run `pnpm --filter @workspace/api-spec run codegen` and verify the generated types.
