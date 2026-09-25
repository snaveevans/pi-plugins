---
name: e2e-test
description: "Historical pi-goal E2E chain; unsupported on the 0.22 five-tool interface."
---

# Unsupported historical chain

Do not copy or run this chain. Its former completion protocol used removed tool
names and was not exercised by `npm test`.

Use `npm run test:serial` for the current local gate. The replacement integration suite exercises the registered goal tools in
[`tests/integration/extension.test.ts`](../integration/extension.test.ts).
Run it with `npm run test:integration`.
