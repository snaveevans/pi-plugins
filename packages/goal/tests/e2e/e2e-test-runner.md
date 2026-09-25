---
name: e2e-test-runner
description: "Historical pi-goal end-to-end runner; unsupported on the 0.22 five-tool interface."
systemPromptMode: replace
inheritProjectContext: true
inheritSkills: true
defaultContext: fork
---

# Unsupported historical runner

This runner is intentionally disabled for 0.22. The previous protocol used
removed completion parameters, bypassed the real auditor, and assumed legacy
session state, so it did not validate the shipped interface.

Do not install or invoke this agent. Use the supported local checks:

```bash
npm run check
npm run test:serial
npm pack --dry-run
```

The handler-level integration suite is in
[`tests/integration/extension.test.ts`](../integration/extension.test.ts). It
calls the registered tools and uses auditor fixtures; run it with
`npm run test:integration`.
