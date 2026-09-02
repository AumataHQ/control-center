import "server-only";

import { statSync } from "node:fs";
import type {
  NewsroomCandidate,
  NewsroomDisposition,
  NewsroomFetch,
  NewsroomSnapshot,
  NewsroomSourceTally,
} from "@/lib/types";
import type { StoredSettings } from "@/lib/server/settings";
import {
  listDirectory,
  pipelineDay,
  readJsonWithin,
} from "@/lib/server/pipeline";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 400;

type TrailEntry = {
  source?: unknown;
  candidate_id?: unknown;
  title?: unknown;
  url?: unknown;
  score?: unknown;
  disposition?: unknown;
  reason?: unknown;
  merged_count?: unknown;
  merged_sources?: unknown;
  primary_urls?: unknown;
};

type BriefFile = {
  generated_at?: unknown;
  writer?: unknown;
  writer_model?: unknown;
  publication_state?: unknown;
  trail?: unknown;
  quarantined?: unknown;
  also_noted?: unknown;
  stories?: unknown;
};

type ResearchFile = {
  stats?: { attempted?: unknown; succeeded?: unknown; failed?: unknown };
  sources?: unknown;
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const list = (value: unknown) => (Array.isArray(value) ? value : []);

function disposition(value: unknown): NewsroomDisposition {
  const raw = text(value);
  if (raw === "selected" || raw === "quarantined" || raw === "also_noted") return raw;
  return "also_noted";
}

/**
 * The research receipt records one row per link fetched, keyed by the URL of
 * the candidate it was fetched for. Grouping by that key is what turns "eight
 * fetches failed today" into "this candidate was withheld because both of its
 * links 404'd".
 */
function fetchesByCandidate(research: ResearchFile | undefined) {
  const grouped = new Map<string, NewsroomFetch[]>();
  for (const row of list(research?.sources)) {
    if (!row || typeof row !== "object") continue;
    const entry = row as Record<string, unknown>;
    const candidate = text(entry.candidate);
    if (!candidate) continue;
    const attempt: NewsroomFetch = {
      url: text(entry.url),
      ok: entry.ok === true,
    };
    const error = text(entry.error);
    if (error) attempt.error = error;
    const existing = grouped.get(candidate);
    if (existing) existing.push(attempt);
    else grouped.set(candidate, [attempt]);
  }
  return grouped;
}

/** Headlines for candidates that reached the page, keyed by candidate id. */
function headlinesBySid(brief: BriefFile) {
  const headlines = new Map<string, string>();
  const stories = brief.stories;
  if (!stories || typeof stories !== "object") return headlines;
  for (const group of Object.values(stories as Record<string, unknown>)) {
    for (const story of list(group)) {
      if (!story || typeof story !== "object") continue;
      const entry = story as Record<string, unknown>;
      const sid = text(entry._sid);
      const headline = text(entry.headline);
      if (sid && headline) headlines.set(sid, headline);
    }
  }
  return headlines;
}

function fromTrail(brief: BriefFile): NewsroomCandidate[] {
  return list(brief.trail).flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const entry = row as TrailEntry;
    const candidateId = text(entry.candidate_id);
    if (!candidateId) return [];
    const candidate: NewsroomCandidate = {
      candidateId,
      source: text(entry.source) || "unknown",
      title: text(entry.title),
      url: text(entry.url),
      score: number(entry.score),
      disposition: disposition(entry.disposition),
      mergedCount: number(entry.merged_count),
      mergedSources: list(entry.merged_sources).map(text).filter(Boolean),
      primaryUrls: list(entry.primary_urls).map(text).filter(Boolean),
      fetches: [],
    };
    const reason = text(entry.reason);
    if (reason) candidate.reason = reason;
    return [candidate];
  });
}

/**
 * Editions written before the trail existed. Their artifact still holds what
 * was published, what was noted, and what was quarantined — but the quarantine
 * record of that era carries only an id, so those entries have no title or URL
 * and cannot be joined to a fetch. Reconstructing what is there beats showing
 * nothing; the caller marks the result incomplete so it is never mistaken for
 * the full picture.
 */
function reconstruct(brief: BriefFile): NewsroomCandidate[] {
  const candidates: NewsroomCandidate[] = [];
  const seen = new Set<string>();

  const push = (candidate: NewsroomCandidate) => {
    const key = candidate.candidateId || candidate.url;
    if (!key || seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  const stories = brief.stories;
  if (stories && typeof stories === "object") {
    for (const [source, group] of Object.entries(stories as Record<string, unknown>)) {
      for (const story of list(group)) {
        if (!story || typeof story !== "object") continue;
        const entry = story as Record<string, unknown>;
        push({
          candidateId: text(entry._sid) || text(entry.id),
          source: text(entry.source) || source,
          title: text(entry.headline),
          url: "",
          score: number(entry.score),
          disposition: "selected",
          mergedCount: number(entry.merged_count),
          mergedSources: list(entry.merged_sources).map(text).filter(Boolean),
          primaryUrls: [],
          fetches: [],
          headline: text(entry.headline) || undefined,
        });
      }
    }
  }

  for (const row of list(brief.quarantined)) {
    if (!row || typeof row !== "object") continue;
    const entry = row as Record<string, unknown>;
    push({
      candidateId: text(entry.candidate_id),
      source: text(entry.source) || "unknown",
      title: text(entry.title),
      url: text(entry.url),
      score: number(entry.score),
      disposition: "quarantined",
      reason: text(entry.reason) || undefined,
      mergedCount: 0,
      mergedSources: [],
      primaryUrls: [],
      fetches: [],
    });
  }

  for (const row of list(brief.also_noted)) {
    if (!row || typeof row !== "object") continue;
    const entry = row as Record<string, unknown>;
    push({
      candidateId: "",
      source: text(entry.source) || "unknown",
      title: text(entry.sentence),
      url: text(entry.url),
      score: number(entry.score),
      disposition: "also_noted",
      mergedCount: 0,
      mergedSources: [],
      primaryUrls: [],
      fetches: [],
    });
  }

  return candidates;
}

function tally(candidates: NewsroomCandidate[]): NewsroomSourceTally[] {
  const tallies = new Map<string, NewsroomSourceTally>();
  for (const candidate of candidates) {
    const row =
      tallies.get(candidate.source) ||
      { source: candidate.source, considered: 0, selected: 0, quarantined: 0, alsoNoted: 0 };
    row.considered += 1;
    if (candidate.disposition === "selected") row.selected += 1;
    else if (candidate.disposition === "quarantined") row.quarantined += 1;
    else row.alsoNoted += 1;
    tallies.set(candidate.source, row);
  }
  return [...tallies.values()].sort((a, b) => b.considered - a.considered);
}

/** Days with a readable brief artifact, newest first. */
export function newsroomDays(root: string): string[] {
  return listDirectory(root, "data", "daily")
    .filter((entry) => entry.isDirectory() && DATE.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .slice(0, MAX_DAYS);
}

export function readNewsroom(settings: StoredSettings, day?: string): NewsroomSnapshot {
  const root = settings.pipeline.root;
  const today = day && DATE.test(day) ? day : pipelineDay();
  const empty = {
    day: today,
    available: false,
    complete: false,
    counts: { considered: 0, selected: 0, quarantined: 0, alsoNoted: 0, published: 0 },
    tallies: [],
    candidates: [],
    days: [],
  };
  if (!root) return { configured: false, rootReadable: false, ...empty };

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
      error: "That pipeline directory could not be read. Check the path in Settings.",
      ...empty,
    };

  const days = newsroomDays(root);
  const brief = readJsonWithin<BriefFile>(root, "data", "daily", today, "smart_brief.json");
  if (!brief)
    return {
      configured: true,
      rootReadable: true,
      ...empty,
      days,
      reason: "No brief was assembled for this day.",
    };

  const trail = fromTrail(brief);
  const complete = trail.length > 0;
  const candidates = complete ? trail : reconstruct(brief);

  const research = readJsonWithin<ResearchFile>(root, "data", "research", `${today}.json`);
  const fetches = fetchesByCandidate(research);
  const headlines = headlinesBySid(brief);
  for (const candidate of candidates) {
    if (candidate.url) candidate.fetches = fetches.get(candidate.url) || [];
    const headline = headlines.get(candidate.candidateId);
    if (headline) candidate.headline = headline;
  }

  const counts = {
    considered: candidates.length,
    selected: candidates.filter((c) => c.disposition === "selected").length,
    quarantined: candidates.filter((c) => c.disposition === "quarantined").length,
    alsoNoted: candidates.filter((c) => c.disposition === "also_noted").length,
    published: headlines.size,
  };

  return {
    configured: true,
    rootReadable: true,
    day: today,
    available: true,
    complete,
    generatedAt: text(brief.generated_at) || undefined,
    writer: text(brief.writer) || undefined,
    writerModel: text(brief.writer_model) || undefined,
    publicationState: text(brief.publication_state) || undefined,
    counts,
    research: research?.stats
      ? {
          attempted: number(research.stats.attempted),
          succeeded: number(research.stats.succeeded),
          failed: number(research.stats.failed),
        }
      : undefined,
    tallies: tally(candidates),
    candidates: candidates.sort((a, b) => b.score - a.score),
    days,
  };
}
