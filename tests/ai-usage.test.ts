import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { initializeAiUsageStore, readAiUsage, recordAiUsage } from "@/lib/ai-usage-store";

function store() {
  return initializeAiUsageStore(new DatabaseSync(":memory:"));
}

test("calls are grouped by job, provider, and model", () => {
  const database = store();
  const now = new Date("2026-09-02T12:00:00Z");
  recordAiUsage(database, { provider: "gateway", model: "signalscribe-reporter", job: "industry-rerank", outcome: "ok", latencyMs: 800 }, now.toISOString());
  recordAiUsage(database, { provider: "gateway", model: "signalscribe-reporter", job: "industry-rerank", outcome: "ok", latencyMs: 1200 }, now.toISOString());
  recordAiUsage(database, { provider: "openai", model: "gpt-5-mini", job: "newsletter-extract", outcome: "ok", latencyMs: 500 }, now.toISOString());

  const usage = readAiUsage(database, 7, now);
  assert.equal(usage.calls, 3);
  assert.equal(usage.rows.length, 2);
  const rerank = usage.rows.find((row) => row.job === "industry-rerank");
  assert.equal(rerank?.calls, 2);
  assert.equal(rerank?.averageLatencyMs, 1000);
  assert.equal(rerank?.provider, "gateway");
});

test("failures are counted separately and keep their kind", () => {
  const database = store();
  const now = new Date("2026-09-02T12:00:00Z");
  recordAiUsage(database, { provider: "gateway", model: "r", job: "mention-summary", outcome: "ok", latencyMs: 10 }, now.toISOString());
  recordAiUsage(database, { provider: "gateway", model: "r", job: "mention-summary", outcome: "failed", latencyMs: 20, errorKind: "http_429" }, now.toISOString());

  const usage = readAiUsage(database, 7, now);
  // A provider that quietly stopped answering looks like a quiet day in the
  // results alone; the failed count is what distinguishes them.
  assert.equal(usage.ok, 1);
  assert.equal(usage.failed, 1);
  assert.equal(usage.rows[0].failed, 1);
  const kinds = database.prepare("SELECT error_kind FROM ai_usage WHERE outcome = 'failed'").all() as unknown as { error_kind: string }[];
  assert.equal(kinds[0].error_kind, "http_429");
});

test("the window excludes older calls without deleting them prematurely", () => {
  const database = store();
  const now = new Date("2026-09-02T12:00:00Z");
  const tenDaysAgo = new Date(now.getTime() - 10 * 86_400_000).toISOString();
  recordAiUsage(database, { provider: "openai", model: "m", job: "old", outcome: "ok", latencyMs: 1 }, tenDaysAgo);
  recordAiUsage(database, { provider: "openai", model: "m", job: "recent", outcome: "ok", latencyMs: 1 }, now.toISOString());

  assert.deepEqual(readAiUsage(database, 7, now).rows.map((row) => row.job), ["recent"]);
  assert.equal(readAiUsage(database, 30, now).rows.length, 2);
});

test("history beyond the retention window is pruned on write", () => {
  const database = store();
  const now = new Date("2026-09-02T12:00:00Z");
  const longAgo = new Date(now.getTime() - 60 * 86_400_000).toISOString();
  recordAiUsage(database, { provider: "openai", model: "m", job: "ancient", outcome: "ok", latencyMs: 1 }, longAgo);
  recordAiUsage(database, { provider: "openai", model: "m", job: "recent", outcome: "ok", latencyMs: 1 }, now.toISOString());
  const rows = database.prepare("SELECT COUNT(*) AS total FROM ai_usage").get() as unknown as { total: number };
  // A dashboard running collectors every fifteen minutes would otherwise grow
  // this table without bound.
  assert.equal(rows.total, 1);
});

test("recording never throws, so accounting cannot fail a curation run", () => {
  const database = new DatabaseSync(":memory:");
  // No table: writing must be swallowed rather than propagate.
  assert.doesNotThrow(() => recordAiUsage(database, { provider: "openai", model: "m", job: "j", outcome: "ok", latencyMs: 1 }));
  const usage = readAiUsage(database, 7);
  assert.equal(usage.calls, 0);
  assert.deepEqual(usage.rows, []);
});
