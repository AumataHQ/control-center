import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "data:text/javascript,export {};") return { format: "commonjs", source: "module.exports = {};", shortCircuit: true };
    return nextLoad(url, context);
  },
});

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "pipeline-"));
  const write = (relative: string, body: string) => {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, body);
  };
  return { root, write };
}

const EDITION = (day: string, model: string) => `<!doctype html><html><head>
<title>SignalScribe — ${day} edition</title>
<meta name="signalscribe-brief-date" content="${day}" />
<meta name="signalscribe-writer" content="llm" />
<meta name="signalscribe-writer-model" content="${model}" />
</head><body>edition</body></html>`;

test("editions are read from rendered pages, markdown, and the latest pointer", async () => {
  const { root, write } = fixture();
  const { readEditions } = await import("../lib/server/pipeline");
  write("site/2026-08-14/index.html", EDITION("2026-08-14", "signalscribe-reporter"));
  write("site/2026-08-13/index.html", EDITION("2026-08-13", "signalscribe-final-qa"));
  write("briefs/2026-08-12.md", "# Older markdown edition\n\nbody\n");
  write("site/index.html", EDITION("2026-08-15", "signalscribe-reporter"));

  const editions = readEditions(root, "2026-08-15");
  assert.deepEqual(editions.map((edition) => edition.date), ["2026-08-15", "2026-08-14", "2026-08-13", "2026-08-12"]);
  assert.equal(editions[0].isToday, true);
  // The route that wrote each edition is provable from the page itself.
  assert.equal(editions[1].writerModel, "signalscribe-reporter");
  assert.equal(editions[2].writerModel, "signalscribe-final-qa");
  assert.equal(editions[3].format, "markdown");
  assert.equal(editions[3].title, "Older markdown edition");
  // The SignalScribe prefix is stripped so the list reads as titles.
  assert.equal(editions[1].title, "2026-08-14 edition");
});

test("a directory with no pipeline artifacts yields an empty list, not an error", async () => {
  const { root } = fixture();
  const { readEditions } = await import("../lib/server/pipeline");
  assert.deepEqual(readEditions(root, "2026-08-15"), []);
});

test("reads are confined to the configured pipeline directory", async () => {
  const { root } = fixture();
  const { resolveWithin } = await import("../lib/server/pipeline");
  assert.equal(resolveWithin(root, "site", "index.html"), path.join(root, "site/index.html"));
  for (const escape of [["..", "..", "etc", "passwd"], ["../outside"], ["site", "..", "..", "secrets"]])
    assert.throws(() => resolveWithin(root, ...escape), /outside the configured pipeline directory/);
});

test("a symlink out of the directory is refused rather than followed", async () => {
  const { root, write } = fixture();
  const { readEditions } = await import("../lib/server/pipeline");
  const outside = mkdtempSync(path.join(tmpdir(), "outside-"));
  writeFileSync(path.join(outside, "index.html"), EDITION("2026-08-14", "leaked"));
  mkdirSync(path.join(root, "site", "2026-08-14"), { recursive: true });
  symlinkSync(path.join(outside, "index.html"), path.join(root, "site", "2026-08-14", "index.html"));
  write("site/2026-08-13/index.html", EDITION("2026-08-13", "signalscribe-reporter"));
  // The escaping edition is skipped; the contained one still reads.
  assert.deepEqual(readEditions(root, "2026-08-14").map((e) => e.date), ["2026-08-13"]);
});

test("publication checks are summarized from the status receipt", async () => {
  const { root, write } = fixture();
  const { readPublication } = await import("../lib/server/pipeline");
  write("site/2026-08-14/status.json", JSON.stringify({
    brief_date: "2026-08-14",
    writer_model: "signalscribe-reporter",
    checks: [
      { name: "x.coverage", ok: true },
      { name: "brief.writer", ok: true },
      { name: "x.items", ok: false, detail: "X items=2 minimum=6" },
    ],
  }));
  const publication = readPublication(root, "2026-08-14");
  assert.equal(publication?.passed, 2);
  assert.equal(publication?.failed, 1);
  assert.equal(publication?.checks[2].detail, "X items=2 minimum=6");
});

test("run attempts and source health carry their failure detail", async () => {
  const { root, write } = fixture();
  const { readRun, readSourceHealth } = await import("../lib/server/pipeline");
  write("data/scheduler-runs/2026-08-14.json", JSON.stringify({
    status: "succeeded",
    attempts: [
      { started_at: "T1", finished_at: "T2", exit_code: 1, status: "failed" },
      { started_at: "T3", finished_at: "T4", exit_code: 0, status: "succeeded" },
    ],
  }));
  write("data/daily/2026-08-14/source_health.json", JSON.stringify({
    sources: { x: { state: "failed", detail: "xAI Search ingest failed", checked_at: "T1" }, hn: { state: "ok" } },
    dependencies: { radar_sync: { state: "ok" } },
  }));
  const run = readRun(root, "2026-08-14");
  assert.equal(run?.status, "succeeded");
  assert.equal(run?.attempts.length, 2);
  assert.equal(run?.attempts[0].exitCode, 1);

  const sources = readSourceHealth(root, "2026-08-14");
  assert.deepEqual(sources.map((s) => s.name), ["radar_sync", "hn", "x"]);
  assert.equal(sources.find((s) => s.name === "x")?.detail, "xAI Search ingest failed");
});

test("gateway receipts roll up the way the pipeline's own report does", async () => {
  const { root, write } = fixture();
  const { readUsage } = await import("../lib/server/pipeline");
  write("data/llm-usage/2026-08-14.jsonl", [
    JSON.stringify({ route: "signalscribe-reporter", role: "reporter", attempt: 1, outcome: "rate_limited", latency_ms: 200 }),
    JSON.stringify({ route: "signalscribe-reporter", role: "reporter", attempt: 2, outcome: "ok", total_tokens: 1200, latency_ms: 800 }),
    JSON.stringify({ route: "signalscribe-x-search", role: "x-search", attempt: 1, outcome: "ok", total_tokens: 400, latency_ms: 5000 }),
    "not json",
    "",
  ].join("\n"));
  const usage = readUsage(root, "2026-08-14");
  assert.equal(usage?.calls, 3);
  assert.equal(usage?.ok, 2);
  assert.equal(usage?.failed, 1);
  // A route failing over is invisible in the published edition, which only
  // records the model that finally answered.
  assert.equal(usage?.retriedAttempts, 1);
  assert.equal(usage?.totalTokens, 1600);
  const reporter = usage?.routes.find((route) => route.route === "signalscribe-reporter");
  assert.equal(reporter?.calls, 2);
  assert.equal(reporter?.outcomes.rate_limited, 1);
  assert.equal(reporter?.averageLatencyMs, 500);
});

test("watchlist and profile summaries are derived without a YAML parser", async () => {
  const { root, write } = fixture();
  const { readRadar, readProfile } = await import("../lib/server/pipeline");
  write("config/radar.yaml", `x:
  accounts:
    - handle: AnthropicAI
      enabled: true
    - handle: OpenAI
    - handle: Retired
      enabled: false
youtube:
  channels:
    - id: UCabc
    - id: UCdef
web:
  feeds:
    - url: https://example.com/feed.xml
`);
  const radar = readRadar(root);
  assert.deepEqual(radar?.counts, { x: 3, youtube: 2, feeds: 1 });
  assert.equal(radar?.disabled, 1);
  assert.equal(radar?.enabled, 5);

  write("config/research_profile.yaml", `version: 1
lanes:
  agentic_coding:
    weight: 1.0
  tools_repos:
    weight: 0.9
pain_points:
  - id: context_leakage
    label: Cross-project context leakage
    severity: high
score_weights:
  relevance: 0.25
  novelty: 0.15
`);
  const profile = readProfile(root);
  assert.deepEqual(profile?.lanes, ["agentic_coding", "tools_repos"]);
  assert.deepEqual(profile?.painPoints, ["Cross-project context leakage"]);
  assert.deepEqual(profile?.weights, { relevance: 0.25, novelty: 0.15 });
});

test("an unconfigured or unreadable directory reports state instead of throwing", async () => {
  const { readPipelineSnapshot } = await import("../lib/server/pipeline");
  const unconfigured = readPipelineSnapshot({ pipeline: { root: "", publicUrl: "" } } as never);
  assert.equal(unconfigured.configured, false);
  assert.equal(unconfigured.rootReadable, false);

  const missing = readPipelineSnapshot({ pipeline: { root: "/nonexistent-pipeline-root", publicUrl: "" } } as never);
  assert.equal(missing.configured, true);
  assert.equal(missing.rootReadable, false);
  assert.match(missing.error || "", /could not be read/);
});

test("the pipeline day follows the publication timezone, not the server's", async () => {
  const { pipelineDay } = await import("../lib/server/pipeline");
  // 03:30 UTC is still the previous day in New York, which is when a late
  // evening operator would otherwise see today's edition reported missing.
  assert.equal(pipelineDay(new Date("2026-08-15T03:30:00Z")), "2026-08-14");
  assert.equal(pipelineDay(new Date("2026-08-15T13:30:00Z")), "2026-08-15");
});

test("edition titles drop a repeated site-name prefix in either dash style", async () => {
  const { root, write } = fixture();
  const { readEditions } = await import("../lib/server/pipeline");
  write("briefs/2026-08-03.md", "# SignalScribe – 2026-08-03\n\nbody\n");
  write("briefs/2026-08-04.md", "# SignalScribe — Tuesday's AI brief\n\nbody\n");
  write("briefs/2026-08-05.md", "# Wednesday's AI brief\n\nbody\n");
  write("site/2026-08-06/index.html", "<html><head><title>SignalScribe: Thursday roundup</title></head><body>x</body></html>");
  const byDate = Object.fromEntries(readEditions(root, "2026-08-06").map((e) => [e.date, e.title]));
  assert.equal(byDate["2026-08-03"], "2026-08-03");
  assert.equal(byDate["2026-08-04"], "Tuesday's AI brief");
  // A title with no prefix is left alone, including its own hyphens.
  assert.equal(byDate["2026-08-05"], "Wednesday's AI brief");
  assert.equal(byDate["2026-08-06"], "Thursday roundup");
});
