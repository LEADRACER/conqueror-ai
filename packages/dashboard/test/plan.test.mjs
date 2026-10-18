import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlanOutput } from "../dist/index.js";

test("parses JSON plan output", () => {
  const out = parsePlanOutput(`Here is the plan:\n{"tasks": ["Install deps", "Migrate scripts — one liner"]}\nDone.`);
  assert.deepEqual(out, ["Install deps", "Migrate scripts — one liner"]);
});

test("falls back to bulleted/numbered lines", () => {
  const out = parsePlanOutput("1. First step\n- Second step\n* Third step\nplain prose is not a task");
  assert.deepEqual(out, ["First step", "Second step", "Third step"]);
  assert.deepEqual(parsePlanOutput("• Bullet item here"), ["Bullet item here"]);
  assert.deepEqual(parsePlanOutput("1) Paren numbered"), ["Paren numbered"]);
});

test("ignores nonsense and enforces reasonable limits", () => {
  assert.deepEqual(parsePlanOutput("{broken json"), []);
  const long = "x".repeat(400);
  const out = parsePlanOutput(`1. ${long}`);
  assert.equal(out[0].length, 300);
});
