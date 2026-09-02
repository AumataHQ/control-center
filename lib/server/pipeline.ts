import "server-only";

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type {
  PipelineCheck,
  PipelineEdition,
  PipelineRoutePreflight,
  PipelineRunAttempt,
  PipelineSnapshot,
  PipelineSourceState,
  PipelineUsage,
  PipelineRouteUsage,
} from "@/lib/types";
import { type StoredSettings } from "@/lib/server/settings";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BYTES = 4_000_000;
const MAX_EDITIONS = 400;

/**
 * Resolve a path beneath the configured pipeline root.
 *
 * The root is operator-supplied and the segments below it come from artifact
 * names and request parameters, so every read is confined to the root rather
 * than trusting the join. A symlink pointing outside is refused too: the
 * dashboard reads whatever it is aimed at, and that must stay inside.
 */
export function resolveWithin(root: string, ...segments: string[]) {
  const base = path.resolve(root);
  const target = path.resolve(base, ...segments);
  const relative = path.relative(base, target);
  if (relative && (relative.startsWith("..") || path.isAbsolute(relative)))
    throw new Error("Refusing to read outside the configured pipeline directory.");
  return target;
}

function readTextWithin(root: string, ...segments: string[]) {
  const target = resolveWithin(root, ...segments);
  const info = statSync(target, { throwIfNoEntry: false });
  if (!info?.isFile() || info.size > MAX_BYTES) return "";
  // statSync follows symlinks and path.resolve does not, so containment has to
  // be rechecked against the real path: otherwise a link inside the directory
  // reads a file outside it.
  let real: string;
  try {
    real = realpathSync(target);
  } catch {
    return "";
  }
  const base = realpathSync(path.resolve(root));
  const relative = path.relative(base, real);
  if (relative && (relative.startsWith("..") || path.isAbsolute(relative))) return "";
  return readFileSync(real, "utf8");
}

function readJsonWithin<T>(root: string, ...segments: string[]): T | undefined {
  try {
    const raw = readTextWithin(root, ...segments);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function listDirectory(root: string, ...segments: string[]) {
  try {
    return readdirSync(resolveWithin(root, ...segments), { withFileTypes: true });
  } catch {
    return [];
  }
}

function metaContent(html: string, name: string) {
  const match = html.match(new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`, "i"));
  return match?.[1]?.trim() || undefined;
}

/** Strip a site-name prefix so the list reads as titles, not repeated branding. */
function cleanTitle(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/^[A-Za-z][\w .]{0,40}?\s*[\u2014\u2013|:-]\s+/, "")
    .trim();
}

function titleOf(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? cleanTitle(match[1]) : undefined;
}

export function readEditions(root: string, today: string): PipelineEdition[] {
  const editions = new Map<string, PipelineEdition>();
  for (const entry of listDirectory(root, "briefs")) {
    const day = entry.name.replace(/\.md$/, "");
    if (!entry.isFile() || !entry.name.endsWith(".md") || !DATE.test(day)) continue;
    const heading = readTextWithin(root, "briefs", entry.name).match(/^#\s+(.+)$/m)?.[1];
    editions.set(day, {
      date: day,
      title: (heading ? cleanTitle(heading) : "") || "Daily intelligence brief",
      format: "markdown",
      isToday: day === today,
    });
  }
  for (const entry of listDirectory(root, "site")) {
    if (!entry.isDirectory() || !DATE.test(entry.name)) continue;
    const html = readTextWithin(root, "site", entry.name, "index.html");
    if (!html) continue;
    editions.set(entry.name, {
      date: entry.name,
      title: titleOf(html) || "Daily intelligence brief",
      format: "html",
      isToday: entry.name === today,
      writerModel: metaContent(html, "signalscribe-writer-model"),
    });
  }
  const latest = readTextWithin(root, "site", "index.html");
  const latestDay = latest ? metaContent(latest, "signalscribe-brief-date") : undefined;
  if (latestDay && DATE.test(latestDay) && !editions.has(latestDay))
    editions.set(latestDay, {
      date: latestDay,
      title: titleOf(latest) || "Daily intelligence brief",
      format: "html",
      isToday: latestDay === today,
      writerModel: metaContent(latest, "signalscribe-writer-model"),
    });
  return [...editions.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_EDITIONS);
}

type StatusFile = {
  brief_date?: string;
  writer_model?: string;
  checks?: { name?: string; ok?: boolean; detail?: string; message?: string }[];
};

export function readPublication(root: string, day: string) {
  const status =
    readJsonWithin<StatusFile>(root, "site", day, "status.json") ||
    readJsonWithin<StatusFile>(root, "site", "status.json");
  if (!status) return undefined;
  const checks: PipelineCheck[] = (Array.isArray(status.checks) ? status.checks : [])
    .map((check) => ({
      name: String(check?.name || "check"),
      ok: check?.ok !== false,
      detail: check?.detail || check?.message || undefined,
    }))
    .slice(0, 200);
  return {
    day: status.brief_date,
    writerModel: status.writer_model,
    checks,
    passed: checks.filter((check) => check.ok).length,
    failed: checks.filter((check) => !check.ok).length,
  };
}

export function readRun(root: string, day: string) {
  const receipt = readJsonWithin<{ status?: string; attempts?: Record<string, unknown>[] }>(
    root, "data", "scheduler-runs", `${day}.json`,
  );
  if (!receipt) return undefined;
  const attempts: PipelineRunAttempt[] = (Array.isArray(receipt.attempts) ? receipt.attempts : [])
    .map((attempt) => ({
      startedAt: String(attempt.started_at || ""),
      finishedAt: String(attempt.finished_at || ""),
      exitCode: Number(attempt.exit_code ?? -1),
      status: String(attempt.status || "unknown"),
    }))
    .slice(-20);
  return { status: String(receipt.status || "unknown"), attempts };
}

export function readSourceHealth(root: string, day: string): PipelineSourceState[] {
  const health = readJsonWithin<Record<string, unknown>>(root, "data", "daily", day, "source_health.json");
  if (!health) return [];
  const rows: PipelineSourceState[] = [];
  for (const category of ["sources", "dependencies"] as const) {
    const group = health[category];
    if (!group || typeof group !== "object") continue;
    for (const [name, value] of Object.entries(group as Record<string, Record<string, unknown>>)) {
      rows.push({
        name,
        category,
        state: String(value?.state || "unknown"),
        detail: value?.detail ? String(value.detail) : undefined,
        checkedAt: value?.checked_at ? String(value.checked_at) : undefined,
      });
    }
  }
  return rows.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export function readPreflight(root: string, day: string) {
  const payload = readJsonWithin<Record<string, unknown>>(root, "data", "daily", day, "preflight.json");
  if (!payload) return undefined;
  const routes: PipelineRoutePreflight[] = (Array.isArray(payload.routes) ? payload.routes : [])
    .map((row: Record<string, unknown>) => ({
      route: String(row.route || ""),
      role: String(row.role || ""),
      ok: row.ok === true,
      required: row.required === true,
      kind: row.kind ? String(row.kind) : undefined,
      detail: row.detail ? String(row.detail) : undefined,
    }))
    .filter((row) => row.route);
  return {
    ok: payload.ok === true,
    reachable: payload.reachable === true,
    checkedAt: payload.checked_at ? String(payload.checked_at) : undefined,
    routes,
  };
}

/** Roll a day of gateway receipts up. Mirrors scripts/llm_usage_report.py. */
export function readUsage(root: string, day: string): PipelineUsage | undefined {
  const raw = readTextWithin(root, "data", "llm-usage", `${day}.jsonl`);
  if (!raw.trim()) return undefined;
  const rows = raw.split("\n").flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    try { return [JSON.parse(trimmed) as Record<string, unknown>]; } catch { return []; }
  });
  if (!rows.length) return undefined;

  const routes = new Map<string, PipelineRouteUsage & { latencyTotal: number }>();
  const roles = new Map<string, { role: string; calls: number; totalTokens: number }>();
  let retriedAttempts = 0;
  for (const row of rows) {
    const name = String(row.route || "unknown");
    const entry = routes.get(name) || {
      route: name, calls: 0, ok: 0, failed: 0, totalTokens: 0, averageLatencyMs: 0, outcomes: {}, latencyTotal: 0,
    };
    const outcome = String(row.outcome || "unknown");
    entry.calls += 1;
    entry.outcomes[outcome] = (entry.outcomes[outcome] || 0) + 1;
    if (outcome === "ok") entry.ok += 1; else entry.failed += 1;
    entry.totalTokens += Number(row.total_tokens || 0);
    entry.latencyTotal += Number(row.latency_ms || 0);
    routes.set(name, entry);
    if (Number(row.attempt || 1) > 1) retriedAttempts += 1;
    const roleName = String(row.role || "");
    const role = roles.get(roleName) || { role: roleName, calls: 0, totalTokens: 0 };
    role.calls += 1;
    role.totalTokens += Number(row.total_tokens || 0);
    roles.set(roleName, role);
  }
  const rolled = [...routes.values()].map(({ latencyTotal, ...entry }) => ({
    ...entry,
    averageLatencyMs: entry.calls ? Math.round(latencyTotal / entry.calls) : 0,
  }));
  return {
    day,
    calls: rows.length,
    ok: rolled.reduce((total, entry) => total + entry.ok, 0),
    failed: rolled.reduce((total, entry) => total + entry.failed, 0),
    retriedAttempts,
    totalTokens: rolled.reduce((total, entry) => total + entry.totalTokens, 0),
    routes: rolled.sort((a, b) => b.calls - a.calls),
    roles: [...roles.values()].sort((a, b) => b.calls - a.calls),
  };
}

/**
 * Counts from the watchlist, read without a YAML parser.
 *
 * Only the shape this view reports is derived here — how many sources of each
 * kind, and how many are muted. Editing the watchlist stays with the pipeline's
 * own format-preserving writer, so the file is never rewritten from a guess.
 */
export function readRadar(root: string) {
  const raw = readTextWithin(root, "config", "radar.yaml");
  if (!raw) return undefined;
  const counts: Record<string, number> = {
    x: (raw.match(/^\s*-\s*handle:/gm) || []).length,
    youtube: (raw.match(/^\s*-\s*id:\s*UC/gm) || []).length,
    feeds: (raw.match(/^\s*-\s*url:\s*https?:/gm) || []).length,
  };
  const disabled = (raw.match(/^\s*enabled:\s*false\s*$/gm) || []).length;
  const total = counts.x + counts.youtube + counts.feeds;
  return { counts, enabled: Math.max(0, total - disabled), disabled };
}

/** Lane names, pain points, and score weights from the research profile. */
export function readProfile(root: string) {
  const raw = readTextWithin(root, "config", "research_profile.yaml");
  if (!raw) return undefined;
  const section = (name: string) => {
    const start = raw.indexOf(`\n${name}:`);
    if (start < 0) return "";
    const rest = raw.slice(start + 1);
    const end = rest.search(/\n[a-z_]+:/);
    return end < 0 ? rest : rest.slice(0, end);
  };
  const lanes = [...section("lanes").matchAll(/^\s{2}([a-z_]+):\s*$/gm)].map((match) => match[1]);
  const painPoints = [...section("pain_points").matchAll(/^\s*-?\s*label:\s*(.+)$/gm)]
    .map((match) => match[1].trim());
  const weights: Record<string, number> = {};
  for (const match of section("score_weights").matchAll(/^\s{2}([a-z_]+):\s*([0-9.]+)\s*$/gm))
    weights[match[1]] = Number(match[2]);
  return { lanes, painPoints, weights };
}

export function pipelineDay(now = new Date(), timeZone = "America/New_York") {
  // The pipeline's own day boundary is Eastern; using the server's local date
  // would show yesterday's edition as missing for most of the evening.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function readPipelineSnapshot(settings: StoredSettings, day?: string): PipelineSnapshot {
  const root = settings.pipeline.root;
  const today = day && DATE.test(day) ? day : pipelineDay();
  if (!root)
    return { configured: false, rootReadable: false, day: today, editions: [], sources: [] };
  let readable = false;
  try {
    readable = statSync(root, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    readable = false;
  }
  if (!readable)
    return {
      configured: true,
      rootReadable: false,
      day: today,
      error: "That pipeline directory could not be read. Check the path in Settings.",
      editions: [],
      sources: [],
    };
  const editions = readEditions(root, today);
  return {
    configured: true,
    rootReadable: true,
    day: today,
    publicUrl: settings.pipeline.publicUrl || undefined,
    editions,
    latestEdition: editions[0],
    publication: readPublication(root, today),
    run: readRun(root, today),
    sources: readSourceHealth(root, today),
    preflight: readPreflight(root, today),
    usage: readUsage(root, today),
    radar: readRadar(root),
    profile: readProfile(root),
  };
}
