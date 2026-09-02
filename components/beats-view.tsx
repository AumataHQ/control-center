"use client";

import { useCallback, useMemo, useState } from "react";
import { ExternalLink, RefreshCw, Search } from "lucide-react";
import type { BeatKind, BeatTerm, BeatTermKind } from "@/lib/beat-matching";
import type { BeatStatus, StoredBeat, StoredBeatMatch } from "@/lib/beats-store";
import { TagEditor } from "@/components/dashboard-primitives";
import styles from "./beats-view.module.css";

export type BeatsSnapshot = {
  beats: StoredBeat[];
  matches: StoredBeatMatch[];
  unreported: Record<string, number>;
  error?: string;
  scan?: { beats: number; scanned: number; matched: number; recorded: number; ranAt: string };
};

type Draft = {
  id: string;
  name: string;
  kind: BeatKind;
  status: BeatStatus;
  notes: string;
  phrase: string[];
  anchor: string[];
  negative: string[];
  domain: string[];
};

const EMPTY: Draft = {
  id: "", name: "", kind: "theme", status: "active", notes: "",
  phrase: [], anchor: [], negative: [], domain: [],
};

const TERM_HELP: Record<BeatTermKind, { label: string; help: string; placeholder: string }> = {
  phrase: {
    label: "Phrases",
    help: "The thing itself. Matched as words, so a plural or an -ing ending still counts.",
    placeholder: "multi-agent orchestration",
  },
  anchor: {
    label: "Confirming terms",
    help:
      "For a name, a word that must appear near it to prove it is the right one. For a theme, any two of these together are a match. Be specific: “agent” confirms almost anything.",
    placeholder: "personal assistant",
  },
  negative: {
    label: "Rejecting terms",
    help: "A match near one of these is thrown away. This is how an ambiguous name stays usable.",
    placeholder: "Buzz Aldrin",
  },
  domain: {
    label: "Owned domains",
    help: "Anything published here is this beat's, whatever the text says.",
    placeholder: "buzz.example",
  },
};

function toDraft(beat: StoredBeat): Draft {
  const of = (kind: BeatTermKind) =>
    beat.terms.filter((term) => term.kind === kind).map((term) => term.value);
  return {
    id: beat.id, name: beat.name, kind: beat.kind, status: beat.status, notes: beat.notes,
    phrase: of("phrase"), anchor: of("anchor"), negative: of("negative"), domain: of("domain"),
  };
}

function termsOf(draft: Draft): BeatTerm[] {
  return (["phrase", "anchor", "negative", "domain"] as BeatTermKind[]).flatMap((kind) =>
    draft[kind].map((value) => ({ kind, value })),
  );
}

function Confidence({ value }: { value: string }) {
  const tone = value === "high" ? styles.ok : value === "medium" ? styles.idle : styles.bad;
  return <span className={`${styles.state} ${tone}`}>{value}</span>;
}

export function BeatsView({
  snapshot,
  loading,
  onChanged,
}: {
  snapshot: BeatsSnapshot | null;
  loading: boolean;
  onChanged: (next: BeatsSnapshot) => void;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const [unreportedOnly, setUnreportedOnly] = useState(true);

  const post = useCallback(
    async (body: Record<string, unknown>, label: string) => {
      setBusy(label);
      setError("");
      try {
        const response = await fetch("/api/beats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json()) as BeatsSnapshot & { error?: string };
        if (!response.ok || payload.error) {
          setError(payload.error || "That did not work.");
          return null;
        }
        onChanged(payload);
        return payload;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "That did not work.");
        return null;
      } finally {
        setBusy("");
      }
    },
    [onChanged],
  );

  const beats = snapshot?.beats || [];
  const matches = useMemo(() => {
    const all = snapshot?.matches || [];
    return all.filter((match) => {
      if (selected && match.beatId !== selected) return false;
      if (unreportedOnly && match.reportedAt) return false;
      return true;
    });
  }, [snapshot, selected, unreportedOnly]);

  const save = async () => {
    const saved = await post(
      {
        action: "save",
        id: draft.id || undefined,
        name: draft.name,
        kind: draft.kind,
        status: draft.status,
        notes: draft.notes,
        terms: termsOf(draft),
      },
      "save",
    );
    if (saved) {
      setEditing(false);
      setDraft(EMPTY);
    }
  };

  return (
    <div className={styles.root}>
      <div className={styles.bar}>
        <div>
          <h2 style={{ margin: 0, font: "600 17px/1.3 var(--sans)" }}>Beats</h2>
          <p className={styles.empty} style={{ padding: 0 }}>
            Standing coverage. A beat watches everything the newsroom collects — including the
            candidates that never reached the page — until you retire it.
          </p>
        </div>
        <div className={styles.editorActions}>
          <button
            className="button"
            onClick={() => post({ action: "scan" }, "scan")}
            disabled={!!busy || loading}
          >
            <Search size={14} /> {busy === "scan" ? "Scanning…" : "Scan now"}
          </button>
          <button
            className="button button-primary"
            onClick={() => {
              setDraft(EMPTY);
              setEditing(true);
            }}
          >
            New beat
          </button>
        </div>
      </div>

      {error ? <p className={styles.notice}>{error}</p> : null}
      {snapshot?.error ? <p className={styles.notice}>{snapshot.error}</p> : null}
      {snapshot?.scan ? (
        <p className={styles.empty}>
          Scanned {snapshot.scan.scanned.toLocaleString()} items across {snapshot.scan.beats} active
          beats: {snapshot.scan.matched} matched, {snapshot.scan.recorded} of them new.
        </p>
      ) : null}

      {editing ? (
        <div className={styles.editor}>
          <h3>{draft.id ? `Edit ${draft.name || "beat"}` : "New beat"}</h3>
          <div className={styles.editorRow}>
            <label>
              Name
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Multi-agent orchestration"
              />
            </label>
            <label>
              Kind
              <select
                value={draft.kind}
                onChange={(event) =>
                  setDraft({ ...draft, kind: event.target.value as BeatKind })
                }
              >
                <option value="theme">Theme — a subject</option>
                <option value="entity">Named thing — a product or company</option>
              </select>
            </label>
          </div>
          <p className={styles.empty} style={{ padding: 0 }}>
            {draft.kind === "entity"
              ? "A name alone is not evidence: an entity matches only when an owned domain or a confirming term backs it up. Without one it is recorded at low confidence and flagged."
              : "A theme matches on any of its phrases, or on any two of its confirming terms. Recall matters more than precision here — a theme that under-reports gives you no signal that it is."}
          </p>
          {(["phrase", "anchor", "negative", "domain"] as BeatTermKind[]).map((kind) => (
            <TagEditor
              key={kind}
              label={TERM_HELP[kind].label}
              help={TERM_HELP[kind].help}
              values={draft[kind]}
              onChange={(values) => setDraft({ ...draft, [kind]: values })}
              placeholder={TERM_HELP[kind].placeholder}
            />
          ))}
          <label>
            Notes
            <textarea
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              placeholder="Why this is worth following, and when it stops being."
            />
          </label>
          <div className={styles.editorActions}>
            <button className="button button-primary" onClick={save} disabled={busy === "save"}>
              {busy === "save" ? "Saving…" : "Save beat"}
            </button>
            <button className="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {beats.length ? (
        <div className={styles.beats}>
          {beats.map((beat) => (
            <div
              key={beat.id}
              className={`${styles.beat} ${beat.status === "retired" ? styles.retired : ""}`}
            >
              <div className={styles.beatHead}>
                <b>{beat.name}</b>
                <span
                  className={`${styles.state} ${
                    beat.status === "active" ? styles.ok : styles.idle
                  }`}
                >
                  {beat.status}
                </span>
              </div>
              <div className={styles.meta}>
                <span>{beat.kind === "entity" ? "named thing" : "theme"}</span>
                <span>{snapshot?.unreported?.[beat.id] || 0} unread</span>
              </div>
              <div className={styles.terms}>
                {beat.terms.slice(0, 12).map((term) => (
                  <span
                    key={`${term.kind}-${term.value}`}
                    className={term.kind === "negative" ? styles.negative : undefined}
                  >
                    {term.value}
                  </span>
                ))}
              </div>
              {beat.notes ? <p className={styles.beatNotes}>{beat.notes}</p> : null}
              <div className={styles.beatActions}>
                <button onClick={() => setSelected(selected === beat.id ? "" : beat.id)}>
                  {selected === beat.id ? "Show all" : "Show matches"}
                </button>
                <button
                  onClick={() => {
                    setDraft(toDraft(beat));
                    setEditing(true);
                  }}
                >
                  Edit
                </button>
                {beat.status === "active" ? (
                  <button onClick={() => post({ action: "save", ...toDraftPayload(beat, "paused") }, "pause")}>
                    Pause
                  </button>
                ) : beat.status === "paused" ? (
                  <button onClick={() => post({ action: "save", ...toDraftPayload(beat, "active") }, "resume")}>
                    Resume
                  </button>
                ) : null}
                {beat.status !== "retired" ? (
                  <button onClick={() => post({ action: "retire", id: beat.id }, "retire")}>
                    Retire
                  </button>
                ) : (
                  <button onClick={() => post({ action: "delete", id: beat.id }, "delete")}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.empty}>
          No beats yet. Add one for a product you want to hear about — GrokBot, Buzz — or for a
          subject like multi-agent orchestration, and scan to see what has already come in.
        </p>
      )}

      {beats.length ? (
        <>
          <div className={styles.bar}>
            <div className={styles.filters}>
              <button aria-pressed={unreportedOnly} onClick={() => setUnreportedOnly(true)}>
                Unread
              </button>
              <button aria-pressed={!unreportedOnly} onClick={() => setUnreportedOnly(false)}>
                Everything found
              </button>
            </div>
            {matches.length && unreportedOnly ? (
              <button
                className="button"
                disabled={busy === "report"}
                onClick={() =>
                  post(
                    {
                      action: "report",
                      keys: matches.map((match) => ({
                        beatId: match.beatId,
                        category: match.category,
                        itemKey: match.itemKey,
                      })),
                    },
                    "report",
                  )
                }
              >
                <RefreshCw size={14} /> Mark {matches.length} read
              </button>
            ) : null}
          </div>

          {matches.length ? (
            <div className={styles.rows}>
              {matches.map((match) => (
                <div key={`${match.beatId}-${match.category}-${match.itemKey}`} className={styles.row}>
                  <div className={styles.rowHead}>
                    <b>
                      {match.url ? (
                        <a href={match.url} target="_blank" rel="noreferrer noopener">
                          {match.title || match.url} <ExternalLink size={11} />
                        </a>
                      ) : (
                        match.title || match.itemKey
                      )}
                    </b>
                    <Confidence value={match.confidence} />
                  </div>
                  <div className={styles.meta}>
                    <span>{match.beatName}</span>
                    <span>{match.source || match.category}</span>
                    {match.day ? <span>{match.day}</span> : null}
                    <span>matched on {match.why}</span>
                  </div>
                  {match.evidence ? <p className={styles.evidence}>{match.evidence}</p> : null}
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.empty}>
              {unreportedOnly
                ? "Nothing new on the beats. A quiet beat reports nothing, which is the point."
                : "Nothing found yet. Scan to match the beats against what has already come in."}
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

function toDraftPayload(beat: StoredBeat, status: BeatStatus) {
  return {
    id: beat.id,
    name: beat.name,
    kind: beat.kind,
    status,
    notes: beat.notes,
    terms: beat.terms,
  };
}
