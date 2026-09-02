import type { DatabaseSync } from "node:sqlite";
import type { AiKeyProvider } from "./types";

export type AiUsageEntry = {
  provider: AiKeyProvider;
  model: string;
  job: string;
  outcome: "ok" | "failed";
  latencyMs: number;
  errorKind?: string;
};

export type AiUsageRow = {
  provider: string;
  model: string;
  job: string;
  calls: number;
  ok: number;
  failed: number;
  averageLatencyMs: number;
};

export type AiUsageSummary = {
  since: string;
  calls: number;
  ok: number;
  failed: number;
  rows: AiUsageRow[];
};

// Enough history to see a pattern without letting the table grow unbounded on a
// dashboard that runs collectors every fifteen minutes.
const RETAINED_DAYS = 30;

export function initializeAiUsageStore(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ai_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      job TEXT NOT NULL,
      outcome TEXT NOT NULL,
      latency_ms INTEGER NOT NULL,
      error_kind TEXT
    );
    CREATE INDEX IF NOT EXISTS ai_usage_at ON ai_usage (at);
  `);
  return database;
}

/**
 * Record one model call. Never throws: accounting must not turn a working
 * curation run into a failed one.
 */
export function recordAiUsage(database: DatabaseSync, entry: AiUsageEntry, at = new Date().toISOString()) {
  try {
    database
      .prepare(
        "INSERT INTO ai_usage (at, provider, model, job, outcome, latency_ms, error_kind) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(at, entry.provider, entry.model, entry.job, entry.outcome, Math.max(0, Math.round(entry.latencyMs)), entry.errorKind ?? null);
    const cutoff = new Date(Date.parse(at) - RETAINED_DAYS * 86_400_000).toISOString();
    database.prepare("DELETE FROM ai_usage WHERE at < ?").run(cutoff);
  } catch {
    // A dashboard that cannot write a receipt still has curated stories to show.
  }
}

export function readAiUsage(database: DatabaseSync, days = 7, now = new Date()): AiUsageSummary {
  const since = new Date(now.getTime() - Math.max(1, days) * 86_400_000).toISOString();
  let rows: Array<Record<string, unknown>> = [];
  try {
    rows = database
      .prepare(
        `SELECT provider, model, job,
                COUNT(*) AS calls,
                SUM(CASE WHEN outcome = 'ok' THEN 1 ELSE 0 END) AS ok,
                SUM(CASE WHEN outcome != 'ok' THEN 1 ELSE 0 END) AS failed,
                AVG(latency_ms) AS average_latency
           FROM ai_usage WHERE at >= ?
          GROUP BY provider, model, job
          ORDER BY calls DESC`,
      )
      .all(since) as unknown as Array<Record<string, unknown>>;
  } catch {
    rows = [];
  }
  const summary = rows.map((row) => ({
    provider: String(row.provider || ""),
    model: String(row.model || ""),
    job: String(row.job || ""),
    calls: Number(row.calls || 0),
    ok: Number(row.ok || 0),
    failed: Number(row.failed || 0),
    averageLatencyMs: Math.round(Number(row.average_latency || 0)),
  }));
  return {
    since,
    calls: summary.reduce((total, row) => total + row.calls, 0),
    ok: summary.reduce((total, row) => total + row.ok, 0),
    failed: summary.reduce((total, row) => total + row.failed, 0),
    rows: summary,
  };
}
