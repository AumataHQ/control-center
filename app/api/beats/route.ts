import { NextResponse } from "next/server";

import { getDatabase } from "@/lib/server/database";
import { readSettings } from "@/lib/server/settings";
import { scanBeats } from "@/lib/server/beats";
import {
  countUnreported,
  deleteBeat,
  listBeatMatches,
  listBeats,
  markBeatMatchesReported,
  retireBeat,
  saveBeat,
  type BeatStatus,
} from "@/lib/beats-store";
import type { BeatKind, BeatTermKind } from "@/lib/beat-matching";

export const dynamic = "force-dynamic";

const TERM_KINDS: BeatTermKind[] = ["phrase", "anchor", "negative", "domain"];
const STATUSES: BeatStatus[] = ["active", "paused", "retired"];
/** A beat's vocabulary is meant to be read and judged, not accumulated. */
const MAX_TERMS = 48;

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function snapshot() {
  const database = getDatabase();
  return {
    beats: listBeats(database),
    matches: listBeatMatches(database, { limit: 300 }),
    unreported: countUnreported(database),
  };
}

export async function GET() {
  try {
    return NextResponse.json(snapshot());
  } catch (error) {
    return NextResponse.json(
      { beats: [], matches: [], unreported: {}, error: message(error) },
      { status: 200 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action || "save");
    const database = getDatabase();

    if (action === "scan") {
      const result = scanBeats(database, await readSettings());
      return NextResponse.json({ ...snapshot(), scan: result });
    }

    if (action === "report") {
      const keys = Array.isArray(body.keys) ? body.keys : [];
      const marked = markBeatMatchesReported(
        database,
        keys.flatMap((entry) => {
          const key = entry as Record<string, unknown>;
          const beatId = String(key.beatId || "");
          const category = String(key.category || "");
          const itemKey = String(key.itemKey || "");
          return beatId && category && itemKey ? [{ beatId, category, itemKey }] : [];
        }),
      );
      return NextResponse.json({ ...snapshot(), marked });
    }

    if (action === "retire") {
      const id = String(body.id || "");
      if (!id) return NextResponse.json({ error: "Which beat?" }, { status: 400 });
      retireBeat(database, id);
      return NextResponse.json(snapshot());
    }

    if (action === "delete") {
      const id = String(body.id || "");
      if (!id) return NextResponse.json({ error: "Which beat?" }, { status: 400 });
      deleteBeat(database, id);
      return NextResponse.json(snapshot());
    }

    const name = String(body.name || "").trim().slice(0, 120);
    if (!name) return NextResponse.json({ error: "Give the beat a name." }, { status: 400 });
    const id = String(body.id || "").trim() || slug(name);
    if (!id) return NextResponse.json({ error: "That name has no usable letters." }, { status: 400 });
    const kind: BeatKind = body.kind === "entity" ? "entity" : "theme";
    const status = STATUSES.includes(body.status as BeatStatus)
      ? (body.status as BeatStatus)
      : "active";
    const rawTerms = Array.isArray(body.terms) ? body.terms : [];
    const terms = rawTerms
      .flatMap((entry) => {
        const term = entry as Record<string, unknown>;
        const value = String(term.value || "").trim().slice(0, 120);
        const termKind = String(term.kind || "");
        return value && TERM_KINDS.includes(termKind as BeatTermKind)
          ? [{ kind: termKind as BeatTermKind, value }]
          : [];
      })
      .slice(0, MAX_TERMS);
    if (!terms.some((term) => term.kind === "phrase" || term.kind === "domain"))
      return NextResponse.json(
        { error: "A beat needs at least one phrase or one domain to match on." },
        { status: 400 },
      );

    saveBeat(database, {
      id,
      name,
      kind,
      status,
      notes: String(body.notes || "").slice(0, 500),
      terms,
    });
    return NextResponse.json(snapshot());
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 400 });
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "The beat could not be saved.";
}
