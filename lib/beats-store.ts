import type { DatabaseSync } from "node:sqlite";
import type { BeatConfidence, BeatKind, BeatTerm, BeatTermKind } from "./beat-matching";

export type BeatStatus = "active" | "paused" | "retired";

export type StoredBeat = {
  id: string;
  name: string;
  kind: BeatKind;
  status: BeatStatus;
  notes: string;
  createdAt: string;
  retiredAt?: string;
  terms: BeatTerm[];
};

export type StoredBeatMatch = {
  beatId: string;
  beatName: string;
  category: string;
  itemKey: string;
  matchedAt: string;
  confidence: BeatConfidence;
  why: string;
  evidence: string;
  title: string;
  url: string;
  source: string;
  day: string;
  reportedAt?: string;
};

export type BeatMatchInput = Omit<StoredBeatMatch, "beatName" | "reportedAt">;

const TERM_KINDS: BeatTermKind[] = ["phrase", "anchor", "negative", "domain"];
const STATUSES: BeatStatus[] = ["active", "paused", "retired"];

export function initializeBeatsStore(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS beats (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      retired_at TEXT
    );
    CREATE TABLE IF NOT EXISTS beat_terms (
      beat_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (beat_id, kind, value)
    );
    CREATE TABLE IF NOT EXISTS beat_matches (
      beat_id TEXT NOT NULL,
      category TEXT NOT NULL,
      item_key TEXT NOT NULL,
      matched_at TEXT NOT NULL,
      confidence TEXT NOT NULL,
      why TEXT NOT NULL,
      evidence TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      source TEXT NOT NULL,
      day TEXT NOT NULL,
      reported_at TEXT,
      PRIMARY KEY (beat_id, category, item_key)
    );
    CREATE INDEX IF NOT EXISTS beat_matches_unreported
      ON beat_matches (beat_id, reported_at, matched_at);
  `);
  return database;
}

function readTerms(database: DatabaseSync, beatId: string): BeatTerm[] {
  return (
    database
      .prepare("SELECT kind, value FROM beat_terms WHERE beat_id = ? ORDER BY kind, value")
      .all(beatId) as unknown as { kind: string; value: string }[]
  ).flatMap((row) =>
    TERM_KINDS.includes(row.kind as BeatTermKind)
      ? [{ kind: row.kind as BeatTermKind, value: row.value }]
      : [],
  );
}

export function listBeats(database: DatabaseSync, status?: BeatStatus): StoredBeat[] {
  const rows = (
    status
      ? database.prepare("SELECT * FROM beats WHERE status = ? ORDER BY name").all(status)
      : database.prepare("SELECT * FROM beats ORDER BY status, name").all()
  ) as unknown as {
    id: string;
    name: string;
    kind: string;
    status: string;
    notes: string;
    created_at: string;
    retired_at: string | null;
  }[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind === "entity" ? "entity" : "theme",
    status: (STATUSES.includes(row.status as BeatStatus) ? row.status : "paused") as BeatStatus,
    notes: row.notes || "",
    createdAt: row.created_at,
    retiredAt: row.retired_at || undefined,
    terms: readTerms(database, row.id),
  }));
}

/**
 * Create or replace one beat and its terms.
 *
 * Terms are replaced wholesale rather than diffed: a beat's vocabulary is small
 * and edited as a unit, and a partial update is how a removed negative term
 * silently stays in force.
 */
export function saveBeat(
  database: DatabaseSync,
  beat: Omit<StoredBeat, "createdAt" | "retiredAt"> & { createdAt?: string },
  now = new Date().toISOString(),
) {
  const existing = database.prepare("SELECT created_at FROM beats WHERE id = ?").get(beat.id) as
    | unknown as { created_at: string } | undefined;
  const createdAt = existing?.created_at || beat.createdAt || now;
  const retiredAt = beat.status === "retired" ? now : null;
  database
    .prepare(
      `INSERT INTO beats (id, name, kind, status, notes, created_at, retired_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, kind = excluded.kind, status = excluded.status,
         notes = excluded.notes, retired_at = excluded.retired_at`,
    )
    .run(beat.id, beat.name, beat.kind, beat.status, beat.notes || "", createdAt, retiredAt);
  database.prepare("DELETE FROM beat_terms WHERE beat_id = ?").run(beat.id);
  const insert = database.prepare(
    "INSERT OR IGNORE INTO beat_terms (beat_id, kind, value) VALUES (?, ?, ?)",
  );
  for (const term of beat.terms) {
    const value = term.value.trim();
    if (value && TERM_KINDS.includes(term.kind)) insert.run(beat.id, term.kind, value);
  }
}

/**
 * Retire a beat without losing its coverage.
 *
 * A retired beat stops collecting and stops matching; what it already found
 * stays readable, because the point of standing coverage is the record it built.
 */
export function retireBeat(database: DatabaseSync, id: string, now = new Date().toISOString()) {
  database
    .prepare("UPDATE beats SET status = 'retired', retired_at = ? WHERE id = ?")
    .run(now, id);
}

export function deleteBeat(database: DatabaseSync, id: string) {
  database.prepare("DELETE FROM beat_matches WHERE beat_id = ?").run(id);
  database.prepare("DELETE FROM beat_terms WHERE beat_id = ?").run(id);
  database.prepare("DELETE FROM beats WHERE id = ?").run(id);
}

/**
 * Record what the beats found. Existing matches are left alone rather than
 * overwritten: re-running a scan must not reset `reported_at` and make old
 * matches look like news again.
 */
export function recordBeatMatches(database: DatabaseSync, matches: BeatMatchInput[]) {
  const insert = database.prepare(
    `INSERT OR IGNORE INTO beat_matches
       (beat_id, category, item_key, matched_at, confidence, why, evidence, title, url, source, day)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let recorded = 0;
  for (const match of matches) {
    const result = insert.run(
      match.beatId, match.category, match.itemKey, match.matchedAt, match.confidence,
      match.why, match.evidence, match.title, match.url, match.source, match.day,
    );
    if (result.changes) recorded += 1;
  }
  return recorded;
}

export function listBeatMatches(
  database: DatabaseSync,
  options: { beatId?: string; unreportedOnly?: boolean; limit?: number } = {},
): StoredBeatMatch[] {
  const clauses: string[] = [];
  const values: string[] = [];
  if (options.beatId) {
    clauses.push("m.beat_id = ?");
    values.push(options.beatId);
  }
  if (options.unreportedOnly) clauses.push("m.reported_at IS NULL");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(options.limit ?? 200, 1000));
  const rows = database
    .prepare(
      `SELECT m.*, b.name AS beat_name FROM beat_matches m
       JOIN beats b ON b.id = m.beat_id
       ${where}
       ORDER BY m.matched_at DESC, m.confidence LIMIT ${limit}`,
    )
    .all(...values) as unknown as Record<string, string | null>[];
  return rows.map((row) => ({
    beatId: String(row.beat_id),
    beatName: String(row.beat_name || ""),
    category: String(row.category),
    itemKey: String(row.item_key),
    matchedAt: String(row.matched_at),
    confidence: (row.confidence || "low") as BeatConfidence,
    why: String(row.why || ""),
    evidence: String(row.evidence || ""),
    title: String(row.title || ""),
    url: String(row.url || ""),
    source: String(row.source || ""),
    day: String(row.day || ""),
    reportedAt: row.reported_at || undefined,
  }));
}

/**
 * Mark matches as reported, so the next report covers only what is new.
 *
 * This is what keeps a quiet beat quiet: a beat report is its unreported
 * matches, and a beat with none produces nothing at all.
 */
export function markBeatMatchesReported(
  database: DatabaseSync,
  keys: { beatId: string; category: string; itemKey: string }[],
  now = new Date().toISOString(),
) {
  const update = database.prepare(
    "UPDATE beat_matches SET reported_at = ? WHERE beat_id = ? AND category = ? AND item_key = ? AND reported_at IS NULL",
  );
  let marked = 0;
  for (const key of keys) {
    const result = update.run(now, key.beatId, key.category, key.itemKey);
    if (result.changes) marked += 1;
  }
  return marked;
}

export function countUnreported(database: DatabaseSync): Record<string, number> {
  const rows = database
    .prepare(
      "SELECT beat_id, COUNT(*) AS pending FROM beat_matches WHERE reported_at IS NULL GROUP BY beat_id",
    )
    .all() as unknown as { beat_id: string; pending: number }[];
  return Object.fromEntries(rows.map((row) => [row.beat_id, Number(row.pending) || 0]));
}
