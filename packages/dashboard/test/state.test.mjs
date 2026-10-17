import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateStore, emptyState, sanitizeText } from "../dist/state.js";
import { EventBus } from "../dist/events.js";
import { ApprovalGate } from "../dist/approvals.js";

function freshStore() {
  return new StateStore(mkdtempSync(join(tmpdir(), "alex-state-")));
}

test("StateStore persists and reloads entities across instances", () => {
  const dir = mkdtempSync(join(tmpdir(), "alex-persist-"));
  const store = new StateStore(dir);
  store.snapshot.missions.push({
    id: "m1",
    name: "Persist me",
    objective: "obj",
    priority: "high",
    status: "active",
    blockers: [],
    artifacts: [],
    runIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  store.flush();

  const reloaded = new StateStore(dir);
  assert.equal(reloaded.snapshot.missions.length, 1);
  assert.equal(reloaded.snapshot.missions[0]?.name, "Persist me");
  assert.equal(reloaded.snapshot.eventSeq >= 0, true);
});

test("StateStore keeps event order and caps the ring buffer", () => {
  const store = freshStore();
  for (let i = 0; i < 2100; i++) {
    store.addEvent({ id: i + 1, ts: new Date().toISOString(), type: "t", message: String(i) });
  }
  assert.equal(store.snapshot.events.length, 2000);
  assert.equal(store.snapshot.events[0]?.message, "100"); // oldest evicted
});

test("EventBus emits once and accumulates persistent events", () => {
  const store = freshStore();
  const bus = new EventBus(store);
  const seen = [];
  const off = bus.subscribe((e) => seen.push(e.type));
  bus.emit("a", "one");
  bus.emit("b", "two");
  off();
  bus.emit("c", "not seen");
  assert.deepEqual(seen, ["a", "b"]);
  assert.equal(store.snapshot.events.length, 3);
});

test("ApprovalGate creates, resolves and rejects pending records", async () => {
  const store = freshStore();
  const bus = new EventBus(store);
  const gate = new ApprovalGate(store, bus, new Set(["shell"]));

  assert.equal(gate.isRequired("shell"), true);
  assert.equal(gate.isRequired("web_fetch"), false);

  // no pending decision yet
  const p = gate.gate({ id: "1", name: "shell", arguments: { command: "ls" } }, { runId: "run-x" });
  assert.equal(gate.pending().length, 1);
  assert.equal(gate.pending()[0]?.argsPreview.includes("ls"), true);

  gate.decide(gate.pending()[0].id, false);
  const result = await p;
  assert.equal(result.approved, false);
  assert.equal(gate.pending().length, 0);
  assert.equal(store.snapshot.approvals[0]?.status, "rejected");
});

test("ApprovalGate setRequired applies the new policy immediately", () => {
  const store = freshStore();
  const bus = new EventBus(store);
  const gate = new ApprovalGate(store, bus, new Set());
  assert.equal(gate.isRequired("shell"), false);
  gate.setRequired(new Set(["shell"]));
  assert.equal(gate.isRequired("shell"), true);
});

test("sanitizeText strips control characters and truncates", () => {
  assert.equal(sanitizeText("a\x00b\x1f[31m"), "ab[31m");
  assert.equal(sanitizeText("x".repeat(50), 10).length, 10);
  assert.equal(sanitizeText("line\nkeep\ttabs"), "line\nkeep\ttabs");
});

test("emptyState provides defaults with approval policy", () => {
  const st = emptyState();
  assert.equal(st.settings.approvalTools.includes("shell"), true);
  assert.equal(st.settings.provider, "omniroute");
  assert.equal(st.runs.length, 0);
});

test("flush writes a valid JSON file on disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "alex-flush-"));
  const store = new StateStore(dir);
  store.addEvent({ id: store.nextEventId(), ts: "2025-01-01T00:00:00Z", type: "flush", message: "written" });
  store.flush();
  const raw = JSON.parse(readFileSync(join(dir, "dashboard-state.json"), "utf-8"));
  assert.equal(raw.events.length, 1);
  assert.equal(raw.events[0].type, "flush");
});
