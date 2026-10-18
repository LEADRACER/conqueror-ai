import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentLoop } from "/root/Builds/Alex/node_modules/@alex-ai/runtime/dist/index.js";
import { defineTool } from "/root/Builds/Alex/node_modules/@alex-ai/core/dist/types.js";

// scripted fake provider: returns queued responses per chat() call
function fakeProvider(responses) {
  let calls = 0;
  const seenSizes = [];
  return {
    id: "fake",
    name: "Fake",
    models: ["fake-model"],
    async chat(history, opts) {
      calls++;
      seenSizes.push(history.length);
      const resp = responses[Math.min(calls - 1, responses.length - 1)];
      return {
        role: "assistant",
        content: resp.content ?? "",
        ...(resp.toolCalls ? { toolCalls: resp.toolCalls } : {}),
        finishReason: resp.finishReason ?? "stop",
        usage: { input: history.length * 10, output: 3 },
      };
    },
    meta: { calls: () => calls, seenSizes },
  };
}

const longTool = defineTool({
  name: "big_output",
  description: "returns a long fake result",
  args: {},
  handler: async () => "x".repeat(5000),
});

async function makeAgent(compactPolicy, responses) {
  const { ctx, agent } = await AgentLoop.createDefault("/tmp", {
    provider: "fake", // resolved at run() time, after registration
    model: "fake-model",
    compact: compactPolicy,
  });
  ctx.providers.register(fakeProvider(responses));
  ctx.tools.register(longTool);
  return { ctx, agent };
}

test("compaction keeps history bounded during long tool loops", async () => {
  // 10 rounds of tool calls, then final answer
  const responses = [];
  for (let i = 0; i < 10; i++) {
    responses.push({
      content: "",
      toolCalls: [{ id: `c${i}`, name: "big_output", arguments: {} }],
      finishReason: "tool_calls",
    });
  }
  responses.push({ content: "loop finished", finishReason: "stop" });

  const { agent } = await makeAgent(
    { thresholdTokens: 1, keepRecentUnits: 4, toolResultMaxChars: 300 },
    responses
  );
  const history = await agent.run("do the loop");
  const assistantFinal = history.at(-1);
  assert.equal(assistantFinal.content, "loop finished");

  // compaction metadata recorded
  const comp = assistantFinal.metadata?.compaction;
  assert.ok(comp && comp.unitsRemoved >= 5, JSON.stringify(comp));
  assert.ok(comp.charsSaved > 0);

  // history was actually compressed: far shorter than the 10 full tool rounds
  assert.ok(history.length < 12, `history length ${history.length}`);

  // system + request preserved
  assert.equal(history[0].role, "system");
  const req = history.find((m) => m.role === "user" && m.content === "do the loop");
  assert.ok(req, "original request survived compaction");
});

test("compaction keeps tool-call protocol intact after dropping", async () => {
  const responses = [];
  for (let i = 0; i < 8; i++) {
    responses.push({
      content: "",
      toolCalls: [{ id: `t${i}`, name: "big_output", arguments: {} }],
      finishReason: "tool_calls",
    });
  }
  responses.push({ content: "all done", finishReason: "stop" });
  const { agent } = await makeAgent({ thresholdTokens: 1, keepRecentUnits: 4 }, responses);
  const history = await agent.run("protocol check");
  // every remaining tool message must follow its matching assistant toolCalls
  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    if (m.role === "tool") {
      const prev = history[i - 1];
      assert.ok(prev && prev.role === "assistant" && prev.toolCalls?.some((tc) => tc.id === m.metadata.toolCallId), `dangling tool msg at ${i}`);
    }
  }
});

test("tool-result cap truncates oversized outputs", async () => {
  const responses = [
    { content: "", toolCalls: [{ id: "a1", name: "big_output", arguments: {} }], finishReason: "tool_calls" },
    { content: "ok", finishReason: "stop" },
  ];
  const { agent } = await makeAgent({ thresholdTokens: 999999, toolResultMaxChars: 100 }, responses);
  const history = await agent.run("cap test");
  const toolMsg = history.find((m) => m.role === "tool");
  assert.ok(toolMsg.content.length === 100 + "\n…[truncated by context compaction]".length, `len=${toolMsg.content.length}`);
});

test("no compaction below threshold", async () => {
  const responses = [{ content: "quick answer", finishReason: "stop" }];
  const { agent } = await makeAgent({ thresholdTokens: 999999 }, responses);
  const history = await agent.run("hello");
  assert.equal(history.at(-1).content, "quick answer");
  assert.ok(!history.at(-1).metadata?.compaction);
  assert.equal(history.length, 4); // system + memory system + user + assistant
});
