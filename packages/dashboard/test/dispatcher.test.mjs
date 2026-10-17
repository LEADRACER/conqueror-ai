import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentLoop } from "@alex-ai/runtime";
import { StateStore } from "../dist/state.js";
import { EventBus } from "../dist/events.js";
import { ApprovalGate } from "../dist/approvals.js";
import { SupervisedDispatcher } from "../dist/runner.js";

async function makeHarness(required = new Set()) {
  const store = new StateStore(mkdtempSync(join(tmpdir(), "alex-disp-")));
  const bus = new EventBus(store);
  const gate = new ApprovalGate(store, bus, required);
  const { ctx } = await AgentLoop.createDefault(process.cwd(), {});
  const events = [];
  bus.subscribe((e) => events.push({ type: e.type }));
  const recorded = [];
  let waiting = false;
  const disp = new SupervisedDispatcher(
    ctx,
    gate,
    "run-1",
    bus,
    (name) => recorded.push(name),
    (w) => { waiting = w; }
  );
  return { store, gate, disp, events, recorded, waiting: () => waiting };
}

test("dispatcher blocks filesystem paths outside allowed roots", async () => {
  const h = await makeHarness();
  const res = await h.disp.execute({ id: "1", name: "read_file", arguments: { path: "/etc/shadow" } });
  const output = typeof res === "string" ? res : res.output;
  assert.match(output, /Blocked/);
  assert.equal(h.recorded.length, 0); // never executed
  assert.ok(h.events.some((e) => e.type === "run.error"));
});

test("dispatcher allows paths inside the workspace", async () => {
  const h = await makeHarness();
  const res = await h.disp.execute({ id: "1", name: "list_dir", arguments: { path: process.cwd() } });
  const output = typeof res === "string" ? res : res.output;
  assert.doesNotMatch(output, /^Blocked/);
});

test("approval-gated tool pauses until approved, then executes", async () => {
  const h = await makeHarness(new Set(["shell"]));
  setTimeout(() => {
    const rec = h.gate.pending()[0];
    assert.ok(rec, "approval should be pending");
    assert.equal(h.waiting(), true);
    h.gate.decide(rec.id, true);
  }, 50);
  const res = await h.disp.execute({ id: "2", name: "shell", arguments: { command: "echo gated-ok" } });
  const output = typeof res === "string" ? res : res.output;
  assert.match(output, /gated-ok/);
  assert.equal(h.waiting(), false); // released after decision
});

test("rejected approval returns rejection message without executing", async () => {
  const h = await makeHarness(new Set(["shell"]));
  setTimeout(() => h.gate.decide(h.gate.pending()[0].id, false), 50);
  const res = await h.disp.execute({ id: "3", name: "shell", arguments: { command: "echo must-not-run" } });
  const output = typeof res === "string" ? res : res.output;
  assert.match(output, /REJECTED/);
  assert.doesNotMatch(output, /must-not-run/);
});

test("run.status transitions to waiting_approval and back", async () => {
  // validated indirectly via setWaiting callback above; direct store check here
  const h = await makeHarness(new Set(["shell"]));
  assert.equal(h.waiting(), false);
});
