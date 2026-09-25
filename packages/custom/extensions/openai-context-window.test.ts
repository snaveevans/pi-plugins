import assert from "node:assert/strict";
import { test } from "node:test";
import contextExtension from "./openai-context-window.ts";

function harness() {
  const models = [
    { provider: "openai-codex", id: "gpt-6-sol", name: "GPT-6 Sol", contextWindow: 272000, maxTokens: 128000 },
    { provider: "openai", id: "gpt-6-astra", name: "GPT-6 Astra", contextWindow: 272000, maxTokens: 128000 },
    { provider: "openai-codex", id: "gpt-5.3-codex-spark", contextWindow: 128000 },
    { provider: "github-copilot", id: "gpt-6-sol", contextWindow: 272000 },
  ];
  const entries = [];
  const notifications = [];
  const handlers = {};
  let selected = models[0];
  let allowAuth = true;
  const ctx = {
    get model() { return selected; },
    modelRegistry: { find: (provider, id) => models.find((model) => model.provider === provider && model.id === id) },
    sessionManager: { getBranch: () => entries },
    ui: { notify: (message, level) => notifications.push({ message, level }) },
  };
  const pi = {
    on: (name, handler) => { handlers[name] = handler; },
    registerCommand: (_name, command) => { pi.command = command; },
    appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }),
    setModel: async (model) => {
      if (!allowAuth) return false;
      selected = model;
      return true;
    },
  };
  contextExtension(pi);
  return {
    ctx, pi, handlers, entries, notifications, models,
    command: (argument) => pi.command.handler(argument, ctx),
    start: () => handlers.session_start({}, ctx),
    select: async (model) => {
      selected = model;
      await handlers.model_select({ model }, ctx);
    },
    setAuth: (allowed) => { allowAuth = allowed; },
  };
}

test("272k is the default; 1m changes only the local model metadata and persists per session", async () => {
  const h = harness();
  await h.start();
  await h.command("1m");
  assert.equal(h.ctx.model.contextWindow, 1050000);
  assert.equal(h.ctx.model.id, "gpt-6-sol");
  assert.equal(h.models[0].contextWindow, 272000);
  assert.deepEqual(h.entries.at(-1).data, { selection: "1m" });
  await h.command("272k");
  assert.equal(h.ctx.model.contextWindow, 272000);
  assert.deepEqual(h.entries.at(-1).data, { selection: "272k" });
  await h.command("");
  assert.match(h.notifications.at(-1).message, /272000 tokens/);
});

test("switching models retains the choice only for eligible OpenAI models", async () => {
  const h = harness();
  await h.command("1m");
  await h.select(h.models[2]);
  assert.equal(h.ctx.model.contextWindow, 128000);
  await h.command("1m");
  assert.equal(h.notifications.at(-1).level, "error");
  await h.select(h.models[3]);
  assert.equal(h.ctx.model.contextWindow, 272000);
  await h.select(h.models[1]);
  assert.equal(h.ctx.model.contextWindow, 1050000);
});

test("resume restores the last branch choice, new sessions reset; invalid choices and auth failures do not persist", async () => {
  const h = harness();
  await h.command("1m");
  await h.select(h.models[0]);
  await h.start();
  assert.equal(h.ctx.model.contextWindow, 1050000);
  await h.command("bogus");
  assert.equal(h.entries.length, 1);
  h.entries.length = 0;
  await h.start();
  assert.equal(h.ctx.model.contextWindow, 272000);
  h.setAuth(false);
  await h.command("1m");
  assert.equal(h.ctx.model.contextWindow, 272000);
  assert.equal(h.entries.length, 0);
});
