---
name: ManaPick standalone shell
description: Project-specific UI constraint when ManaPick is shown without Accounting pages.
---

When ManaPick is the only app route, omit the TCG Accounting sidebar but retain a standalone shell with the existing theme background, centered content width, and responsive padding.

**Why:** The user explicitly noted that removing the shared layout also removed ManaPick's visual framing and padding.

**How to apply:** Keep the root route focused on ManaPick and wrap it in a ManaPick-only content shell equivalent to the shared layout's main content area; verify the root preview after changes.
