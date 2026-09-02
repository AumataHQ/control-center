import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
  const root = mkdtempSync(path.join(tmpdir(), "newsroom-"));
  const write = (relative: string, body: unknown) => {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, typeof body === "string" ? body : JSON.stringify(body));
  };
  return { root, write };
}

const settings = (root: string) => ({ pipeline: { root, publicUrl: "" } }) as never;

const TRAIL_BRIEF = {
  generated_at: "2026-09-02T18:51:37+00:00",
  writer: "llm",
  writer_model: "openai/gpt-5.6-terra",
  publication_state: "degraded",
  stories: {
    hn: [{ _sid: "cand_hn_kept", source: "hn", headline: "A kept story", score: 9 }],
  },
  quarantined: [
    {
      source: "youtube",
      reason: "no_verified_primary_source",
      candidate_id: "cand_youtube_withheld",
      title: "A withheld video",
      url: "https://youtube.example/watch",
      score: 4,
    },
  ],
  also_noted: [{ source: "hn", sentence: "Noted", url: "https://example.com/noted", score: 2 }],
  trail: [
    {
      source: "hn",
      candidate_id: "cand_hn_kept",
      title: "A kept story",
      url: "https://example.com/kept",
      score: 9,
      disposition: "selected",
      merged_count: 2,
      merged_sources: ["https://example.com/dup"],
      primary_urls: ["https://vendor.example/announcement"],
    },
    {
      source: "youtube",
      candidate_id: "cand_youtube_withheld",
      title: "A withheld video",
      url: "https://youtube.example/watch",
      score: 4,
      disposition: "quarantined",
      reason: "no_verified_primary_source",
    },
    {
      source: "hn",
      candidate_id: "cand_hn_noted",
      title: "Noted",
      url: "https://example.com/noted",
      score: 2,
      disposition: "also_noted",
    },
  ],
};

const RESEARCH = {
  stats: { attempted: 3, succeeded: 1, failed: 2 },
  sources: [
    { candidate: "https://example.com/kept", url: "https://vendor.example/announcement", ok: true },
    {
      candidate: "https://youtube.example/watch",
      url: "https://sponsor.example/a",
      ok: false,
      error: "HttpError: HTTP 404 from https://sponsor.example/a",
    },
    {
      candidate: "https://youtube.example/watch",
      url: "https://sponsor.example/b",
      ok: false,
      error: "HttpError: HTTP 404 from https://sponsor.example/b",
    },
  ],
};

test("the newsroom reports every candidate and what became of it", async () => {
  const { root, write } = fixture();
  const { readNewsroom } = await import("../lib/server/newsroom");
  write("data/daily/2026-09-02/smart_brief.json", TRAIL_BRIEF);

  const snapshot = readNewsroom(settings(root), "2026-09-02");
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.complete, true);
  assert.deepEqual(snapshot.counts, {
    considered: 3,
    selected: 1,
    quarantined: 1,
    alsoNoted: 1,
    published: 1,
  });
  assert.equal(snapshot.writerModel, "openai/gpt-5.6-terra");
});

test("a withheld candidate names the fetches that failed for it", async () => {
  const { root, write } = fixture();
  const { readNewsroom } = await import("../lib/server/newsroom");
  write("data/daily/2026-09-02/smart_brief.json", TRAIL_BRIEF);
  write("data/research/2026-09-02.json", RESEARCH);

  const snapshot = readNewsroom(settings(root), "2026-09-02");
  const withheld = snapshot.candidates.find((c) => c.disposition === "quarantined");
  // This is the join the artifacts could not previously support: the quarantine
  // record named a candidate id, and the receipt is keyed by candidate URL.
  assert.equal(withheld?.reason, "no_verified_primary_source");
  assert.deepEqual(
    withheld?.fetches.map((attempt) => [attempt.url, attempt.ok]),
    [["https://sponsor.example/a", false], ["https://sponsor.example/b", false]],
  );
  assert.match(withheld?.fetches[0].error ?? "", /404/);
  assert.deepEqual(snapshot.research, { attempted: 3, succeeded: 1, failed: 2 });
});

test("a kept candidate carries the primary source it was kept for", async () => {
  const { root, write } = fixture();
  const { readNewsroom } = await import("../lib/server/newsroom");
  write("data/daily/2026-09-02/smart_brief.json", TRAIL_BRIEF);
  write("data/research/2026-09-02.json", RESEARCH);

  const snapshot = readNewsroom(settings(root), "2026-09-02");
  const kept = snapshot.candidates.find((c) => c.disposition === "selected");
  assert.deepEqual(kept?.primaryUrls, ["https://vendor.example/announcement"]);
  assert.equal(kept?.headline, "A kept story");
  assert.equal(kept?.mergedCount, 2);
});

test("candidates are ordered by score and tallied by source", async () => {
  const { root, write } = fixture();
  const { readNewsroom } = await import("../lib/server/newsroom");
  write("data/daily/2026-09-02/smart_brief.json", TRAIL_BRIEF);

  const snapshot = readNewsroom(settings(root), "2026-09-02");
  assert.deepEqual(snapshot.candidates.map((c) => c.score), [9, 4, 2]);
  assert.deepEqual(snapshot.tallies, [
    { source: "hn", considered: 2, selected: 1, quarantined: 0, alsoNoted: 1 },
    { source: "youtube", considered: 1, selected: 0, quarantined: 1, alsoNoted: 0 },
  ]);
});

test("an edition older than the trail is reconstructed and marked incomplete", async () => {
  const { root, write } = fixture();
  const { readNewsroom } = await import("../lib/server/newsroom");
  // The shape written before the trail existed: quarantine records carried only
  // an id, and there was no record of the candidates that were merely outranked
  // beyond the 24 the page prints.
  write("data/daily/2026-08-20/smart_brief.json", {
    stories: { hn: [{ _sid: "cand_hn_old", source: "hn", headline: "An older story", score: 7 }] },
    quarantined: [{ source: "x", reason: "no_verified_primary_source", candidate_id: "cand_x_old" }],
    also_noted: [{ source: "hn", sentence: "Older note", url: "https://example.com/old", score: 1 }],
  });

  const snapshot = readNewsroom(settings(root), "2026-08-20");
  assert.equal(snapshot.available, true);
  // The UI must not present a reconstruction as the whole picture.
  assert.equal(snapshot.complete, false);
  assert.equal(snapshot.counts.considered, 3);
  assert.equal(snapshot.counts.selected, 1);
  assert.equal(snapshot.counts.quarantined, 1);
  const withheld = snapshot.candidates.find((c) => c.disposition === "quarantined");
  // Honest about what that era's artifact does not hold.
  assert.equal(withheld?.url, "");
  assert.deepEqual(withheld?.fetches, []);
});

test("a day with no brief says so rather than showing an empty newsroom", async () => {
  const { root, write } = fixture();
  const { readNewsroom } = await import("../lib/server/newsroom");
  write("data/daily/2026-09-01/smart_brief.json", TRAIL_BRIEF);

  const snapshot = readNewsroom(settings(root), "2026-09-02");
  assert.equal(snapshot.available, false);
  assert.match(snapshot.reason ?? "", /No brief/);
  assert.deepEqual(snapshot.days, ["2026-09-01"]);
});

test("an unconfigured or unreadable pipeline is reported, not guessed at", async () => {
  const { readNewsroom } = await import("../lib/server/newsroom");
  const unconfigured = readNewsroom(settings(""), "2026-09-02");
  assert.equal(unconfigured.configured, false);
  assert.equal(unconfigured.rootReadable, false);

  const missing = readNewsroom(settings("/nonexistent-newsroom-root"), "2026-09-02");
  assert.equal(missing.configured, true);
  assert.equal(missing.rootReadable, false);
  assert.match(missing.error ?? "", /could not be read/);
});

test("days are listed newest first", async () => {
  const { root, write } = fixture();
  const { readNewsroom } = await import("../lib/server/newsroom");
  for (const day of ["2026-08-30", "2026-09-01", "2026-08-31"])
    write(`data/daily/${day}/smart_brief.json`, TRAIL_BRIEF);
  write("data/daily/latest_status.json", { ok: true });

  const snapshot = readNewsroom(settings(root), "2026-09-01");
  assert.deepEqual(snapshot.days, ["2026-09-01", "2026-08-31", "2026-08-30"]);
});
