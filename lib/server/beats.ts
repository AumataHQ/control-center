import "server-only";

import type { DatabaseSync } from "node:sqlite";
import { matchBeats, type BeatDefinition } from "@/lib/beat-matching";
import {
  listBeats,
  recordBeatMatches,
  type BeatMatchInput,
  type StoredBeat,
} from "@/lib/beats-store";
import { listContentItems, type ContentCategory } from "@/lib/archive-store";
import { newsroomDays, readNewsroom } from "@/lib/server/newsroom";
import type { StoredSettings } from "@/lib/server/settings";
import { statSync } from "node:fs";

/** How far back a scan reaches. Enough to cover a beat turned on mid-week. */
const DEFAULT_DAYS = 30;
const CONTENT_CATEGORIES: ContentCategory[] = ["industry", "mentions", "newsletters"];

type ScanItem = {
  category: string;
  itemKey: string;
  title: string;
  body: string;
  url: string;
  source: string;
  day: string;
};

function definitionOf(beat: StoredBeat): BeatDefinition {
  return { id: beat.id, name: beat.name, kind: beat.kind, terms: beat.terms };
}

/**
 * Everything the pipeline considered, not only what it published.
 *
 * A beat exists to catch news you would otherwise miss, and the candidates that
 * lost their slot are exactly where that news hides — an item outranked on a
 * busy day is invisible in the edition and completely visible here.
 */
function newsroomItems(settings: StoredSettings, days: number): ScanItem[] {
  const root = settings.pipeline.root;
  if (!root) return [];
  try {
    if (statSync(root, { throwIfNoEntry: false })?.isDirectory() !== true) return [];
  } catch {
    return [];
  }
  const items: ScanItem[] = [];
  for (const day of newsroomDays(root).slice(0, days)) {
    const snapshot = readNewsroom(settings, day);
    if (!snapshot.available) continue;
    for (const candidate of snapshot.candidates) {
      const key = candidate.candidateId || candidate.url;
      if (!key) continue;
      items.push({
        category: "newsroom",
        itemKey: `${day}:${key}`,
        title: candidate.headline || candidate.title,
        body: candidate.summary,
        url: candidate.url,
        source: candidate.source,
        day,
      });
    }
  }
  return items;
}

function contentItems(database: DatabaseSync): ScanItem[] {
  const items: ScanItem[] = [];
  for (const category of CONTENT_CATEGORIES) {
    let lists;
    try {
      lists = listContentItems(database, category);
    } catch {
      continue;
    }
    for (const item of [...lists.active, ...lists.archived]) {
      const record = item as unknown as Record<string, unknown>;
      const url = String(record.url || record.gmailUrl || "");
      const key = String(record.id || url);
      if (!key) continue;
      items.push({
        category,
        itemKey: key,
        title: String(record.title || ""),
        body: String(record.summary || record.snippet || record.body || ""),
        url,
        source: String(record.source || category),
        day: String(record.publishedAt || record.date || "").slice(0, 10),
      });
    }
  }
  return items;
}

export type BeatScanResult = {
  beats: number;
  scanned: number;
  matched: number;
  recorded: number;
  ranAt: string;
};

/**
 * Match every active beat against everything on hand.
 *
 * Deliberately retrospective as well as live: turning a beat on should surface
 * what has already arrived, not only what arrives next. Existing matches are
 * left untouched, so re-running a scan never resurfaces something already
 * reported.
 */
export function scanBeats(
  database: DatabaseSync,
  settings: StoredSettings,
  options: { days?: number; now?: string } = {},
): BeatScanResult {
  const now = options.now || new Date().toISOString();
  const active = listBeats(database, "active");
  if (!active.length)
    return { beats: 0, scanned: 0, matched: 0, recorded: 0, ranAt: now };

  const definitions = active.map(definitionOf);
  const items = [
    ...newsroomItems(settings, options.days ?? DEFAULT_DAYS),
    ...contentItems(database),
  ];

  const found: BeatMatchInput[] = [];
  for (const item of items) {
    for (const match of matchBeats(definitions, item)) {
      found.push({
        beatId: match.beatId,
        category: item.category,
        itemKey: item.itemKey,
        matchedAt: now,
        confidence: match.confidence,
        why: match.why,
        evidence: match.evidence,
        title: item.title,
        url: item.url,
        source: item.source,
        day: item.day,
      });
    }
  }

  return {
    beats: active.length,
    scanned: items.length,
    matched: found.length,
    recorded: recordBeatMatches(database, found),
    ranAt: now,
  };
}
