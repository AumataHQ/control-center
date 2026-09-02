import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  countUnreported,
  deleteBeat,
  initializeBeatsStore,
  listBeatMatches,
  listBeats,
  markBeatMatchesReported,
  recordBeatMatches,
  retireBeat,
  saveBeat,
} from "../lib/beats-store";

function store() {
  return initializeBeatsStore(new DatabaseSync(":memory:"));
}

const BUZZ = {
  id: "buzz",
  name: "Buzz",
  kind: "entity" as const,
  status: "active" as const,
  notes: "",
  terms: [
    { kind: "phrase" as const, value: "Buzz" },
    { kind: "anchor" as const, value: "personal assistant" },
  ],
};

const MATCH = {
  beatId: "buzz",
  category: "newsroom",
  itemKey: "2026-09-02:cand_x_buzz",
  matchedAt: "2026-09-02T10:00:00.000Z",
  confidence: "high" as const,
  why: '"Buzz" near "personal assistant"',
  evidence: "Buzz adds a personal assistant mode",
  title: "Buzz adds a personal assistant mode",
  url: "https://news.example/buzz",
  source: "x",
  day: "2026-09-02",
};

test("a beat round-trips with its terms", () => {
  const database = store();
  saveBeat(database, BUZZ);
  const [beat] = listBeats(database);
  assert.equal(beat.name, "Buzz");
  assert.equal(beat.kind, "entity");
  assert.deepEqual(beat.terms.map((term) => term.value).sort(), ["Buzz", "personal assistant"]);
});

test("saving replaces a beat's terms rather than merging them", () => {
  // A partial update is how a removed negative term silently stays in force.
  const database = store();
  saveBeat(database, {
    ...BUZZ,
    terms: [...BUZZ.terms, { kind: "negative" as const, value: "Buzz Aldrin" }],
  });
  saveBeat(database, BUZZ);
  const [beat] = listBeats(database);
  assert.equal(beat.terms.some((term) => term.kind === "negative"), false);
});

test("a beat keeps its creation time across edits", () => {
  const database = store();
  saveBeat(database, BUZZ, "2026-08-01T00:00:00.000Z");
  saveBeat(database, { ...BUZZ, name: "Buzz (renamed)" }, "2026-09-02T00:00:00.000Z");
  const [beat] = listBeats(database);
  assert.equal(beat.createdAt, "2026-08-01T00:00:00.000Z");
  assert.equal(beat.name, "Buzz (renamed)");
});

test("retiring a beat keeps its coverage", () => {
  const database = store();
  saveBeat(database, BUZZ);
  recordBeatMatches(database, [MATCH]);
  retireBeat(database, "buzz", "2026-09-03T00:00:00.000Z");
  const [beat] = listBeats(database);
  assert.equal(beat.status, "retired");
  assert.equal(beat.retiredAt, "2026-09-03T00:00:00.000Z");
  // The point of standing coverage is the record it built.
  assert.equal(listBeatMatches(database).length, 1);
  assert.equal(listBeats(database, "active").length, 0);
});

test("deleting a beat takes its matches with it", () => {
  const database = store();
  saveBeat(database, BUZZ);
  recordBeatMatches(database, [MATCH]);
  deleteBeat(database, "buzz");
  assert.equal(listBeats(database).length, 0);
  assert.equal(listBeatMatches(database).length, 0);
});

test("re-scanning does not resurface a match that was already reported", () => {
  const database = store();
  saveBeat(database, BUZZ);
  recordBeatMatches(database, [MATCH]);
  markBeatMatchesReported(database, [
    { beatId: "buzz", category: "newsroom", itemKey: MATCH.itemKey },
  ], "2026-09-02T12:00:00.000Z");

  // A later scan finds the same item again — as it will, every day.
  const recorded = recordBeatMatches(database, [{ ...MATCH, matchedAt: "2026-09-03T10:00:00.000Z" }]);
  assert.equal(recorded, 0);
  assert.equal(listBeatMatches(database, { unreportedOnly: true }).length, 0);
  assert.equal(listBeatMatches(database)[0].reportedAt, "2026-09-02T12:00:00.000Z");
});

test("a beat report is its unreported matches", () => {
  const database = store();
  saveBeat(database, BUZZ);
  recordBeatMatches(database, [
    MATCH,
    { ...MATCH, itemKey: "2026-09-03:cand_x_buzz2", matchedAt: "2026-09-03T10:00:00.000Z" },
  ]);
  assert.deepEqual(countUnreported(database), { buzz: 2 });
  markBeatMatchesReported(database, [
    { beatId: "buzz", category: "newsroom", itemKey: MATCH.itemKey },
  ]);
  // A quiet beat produces nothing, which is what keeps it from becoming noise.
  assert.equal(listBeatMatches(database, { unreportedOnly: true }).length, 1);
  assert.deepEqual(countUnreported(database), { buzz: 1 });
});

test("matches carry the beat's name so a report reads without a second query", () => {
  const database = store();
  saveBeat(database, BUZZ);
  recordBeatMatches(database, [MATCH]);
  assert.equal(listBeatMatches(database)[0].beatName, "Buzz");
});

test("the same item matched by two beats is recorded once per beat", () => {
  const database = store();
  saveBeat(database, BUZZ);
  saveBeat(database, { ...BUZZ, id: "assistants", name: "Personal assistants", kind: "theme" });
  const recorded = recordBeatMatches(database, [
    MATCH,
    { ...MATCH, beatId: "assistants" },
  ]);
  assert.equal(recorded, 2);
  assert.equal(listBeatMatches(database, { beatId: "assistants" }).length, 1);
});
