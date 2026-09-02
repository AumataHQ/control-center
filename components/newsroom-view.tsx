"use client";

import { useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { NewsroomCandidate, NewsroomDisposition, NewsroomSnapshot } from "@/lib/types";
import styles from "./newsroom-view.module.css";

type Filter = "all" | NewsroomDisposition;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "selected", label: "Published" },
  { id: "quarantined", label: "Withheld" },
  { id: "also_noted", label: "Outranked" },
];

const PAGE = 40;

const DISPOSITION_LABEL: Record<NewsroomDisposition, string> = {
  selected: "published",
  quarantined: "withheld",
  also_noted: "outranked",
};

/** Why a candidate was withheld, in words rather than an enum. */
function explain(reason?: string) {
  if (reason === "no_verified_primary_source")
    return "No first-party source could be verified, so the story was not written.";
  return reason ? reason.replace(/_/g, " ") : "";
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function Tile({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className={`${styles.tile} ${tone ? styles[tone] : ""}`}>
      <span>{label}</span>
      <b>{value}</b>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function State({ disposition }: { disposition: NewsroomDisposition }) {
  const tone =
    disposition === "selected" ? styles.ok : disposition === "quarantined" ? styles.bad : styles.idle;
  return <span className={`${styles.state} ${tone}`}>{DISPOSITION_LABEL[disposition]}</span>;
}

function Candidate({ candidate }: { candidate: NewsroomCandidate }) {
  const failed = candidate.fetches.filter((attempt) => !attempt.ok);
  return (
    <details className={styles.row}>
      <summary className={styles.summary}>
        <div className={styles.rowHead}>
          <b>{candidate.headline || candidate.title || candidate.url || candidate.candidateId}</b>
          <State disposition={candidate.disposition} />
        </div>
        <div className={styles.meta}>
          <span>{candidate.source}</span>
          <span>score {candidate.score.toFixed(1)}</span>
          {candidate.mergedCount > 1 ? <span>{candidate.mergedCount} sources merged</span> : null}
          {failed.length ? <span className={styles.fail}>{failed.length} fetch failed</span> : null}
        </div>
      </summary>
      <div className={styles.detail}>
        {candidate.summary ? <p>{candidate.summary}</p> : null}
        {candidate.disposition === "quarantined" && candidate.reason ? (
          <p>{explain(candidate.reason)}</p>
        ) : null}

        {candidate.url ? (
          <div>
            <h4>Candidate</h4>
            <ul>
              <li>
                <a href={candidate.url} target="_blank" rel="noreferrer noopener">
                  {candidate.url} <ExternalLink size={11} />
                </a>
              </li>
            </ul>
          </div>
        ) : (
          <p>
            This edition predates the recorded trail, so the artifact holds no URL for this
            candidate.
          </p>
        )}

        {candidate.primaryUrls.length ? (
          <div>
            <h4>Verified first-party sources</h4>
            <ul>
              {candidate.primaryUrls.map((url) => (
                <li key={url}>
                  <a href={url} target="_blank" rel="noreferrer noopener">
                    {url} <ExternalLink size={11} />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {candidate.fetches.length ? (
          <div>
            <h4>Links fetched for this candidate</h4>
            <ul>
              {candidate.fetches.map((attempt, index) => (
                <li key={`${attempt.url}-${index}`} className={attempt.ok ? undefined : styles.fail}>
                  {attempt.ok ? "ok" : "failed"} — {hostOf(attempt.url)}
                  {attempt.error ? `: ${attempt.error}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : candidate.url ? (
          <p>No link was fetched for this candidate.</p>
        ) : null}

        {candidate.mergedSources.length ? (
          <div>
            <h4>Merged from</h4>
            <ul>
              {candidate.mergedSources.map((url) => (
                <li key={url}>{url}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}

export function NewsroomView({
  snapshot,
  loading,
  day,
  onDay,
  onRefresh,
  onSetup,
}: {
  snapshot: NewsroomSnapshot | null;
  loading: boolean;
  day: string;
  onDay: (value: string) => void;
  onRefresh: () => void;
  onSetup: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (snapshot?.candidates || []).filter((candidate) => {
      if (filter !== "all" && candidate.disposition !== filter) return false;
      if (!needle) return true;
      return `${candidate.headline || ""} ${candidate.title} ${candidate.url} ${candidate.source}`
        .toLowerCase()
        .includes(needle);
    });
  }, [snapshot, filter, query]);

  if (!snapshot?.configured)
    return (
      <div className="panel empty-state setup-empty">
        <h2>Go behind the edition</h2>
        <p>
          Point this at a publication pipeline to see everything it considered each day: what was
          published, what was withheld and why, and what was simply outranked. The pipeline records
          this on every run, whether or not it published.
        </p>
        <button className="button button-primary" onClick={onSetup}>
          Open settings
        </button>
      </div>
    );

  if (snapshot.error || !snapshot.rootReadable)
    return (
      <div className="panel">
        <h2>The newsroom could not be read</h2>
        <p>{snapshot.error || "That pipeline directory could not be read."}</p>
        <button className="button" onClick={onSetup}>
          Open settings
        </button>
      </div>
    );

  const counts = snapshot.counts;

  return (
    <div className={styles.root}>
      <div className={styles.bar}>
        <div className={styles.controls}>
          <select value={day} onChange={(event) => onDay(event.target.value)} aria-label="Edition day">
            {(snapshot.days.length ? snapshot.days : [snapshot.day]).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setShown(PAGE);
            }}
            placeholder="Search headlines, sources, links"
            aria-label="Search the day's candidates"
          />
        </div>
        <button className="button" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {!snapshot.available ? (
        <div className="panel">
          <h2>Nothing was assembled on {snapshot.day}</h2>
          <p>{snapshot.reason || "There is no brief artifact for this day."}</p>
        </div>
      ) : (
        <>
          <div className={styles.headline}>
            <Tile label="Considered" value={String(counts.considered)} detail="candidates scored" />
            <Tile label="Published" value={String(counts.published)} tone="good" detail="stories written" />
            <Tile
              label="Withheld"
              value={String(counts.quarantined)}
              tone={counts.quarantined ? "bad" : undefined}
              detail="no verified source"
            />
            <Tile label="Outranked" value={String(counts.alsoNoted)} detail="lost their slot" />
            {snapshot.research ? (
              <Tile
                label="Links fetched"
                value={String(snapshot.research.attempted)}
                tone={snapshot.research.failed ? "bad" : undefined}
                detail={`${snapshot.research.succeeded} ok · ${snapshot.research.failed} failed`}
              />
            ) : null}
          </div>

          {!snapshot.complete ? (
            <p className={styles.notice}>
              This edition was assembled before the trail was recorded, so what you see is
              reconstructed from what its artifact does hold. Candidates that were merely outranked
              are capped at the 24 the page printed, and withheld candidates carry no link, so their
              fetches cannot be shown.
            </p>
          ) : null}

          {snapshot.tallies.length ? (
            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Considered</th>
                    <th>Published</th>
                    <th>Withheld</th>
                    <th>Outranked</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.tallies.map((row) => (
                    <tr key={row.source}>
                      <td className={styles.mono}>{row.source}</td>
                      <td>{row.considered}</td>
                      <td>{row.selected}</td>
                      <td>{row.quarantined}</td>
                      <td>{row.alsoNoted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className={styles.filters}>
            {FILTERS.map((option) => (
              <button
                key={option.id}
                aria-pressed={filter === option.id}
                onClick={() => {
                  setFilter(option.id);
                  setShown(PAGE);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>

          {candidates.length ? (
            <>
              <div className={styles.rows}>
                {candidates.slice(0, shown).map((candidate, index) => (
                  <Candidate
                    key={`${candidate.candidateId}-${candidate.url}-${index}`}
                    candidate={candidate}
                  />
                ))}
              </div>
              {candidates.length > shown ? (
                <div className={styles.more}>
                  <button className="button" onClick={() => setShown((value) => value + PAGE)}>
                    Show {Math.min(PAGE, candidates.length - shown)} more of {candidates.length}
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <p className={styles.empty}>Nothing matches that filter.</p>
          )}

          <p className={styles.empty}>
            {snapshot.writerModel ? `Written by ${snapshot.writerModel}. ` : ""}
            {snapshot.publicationState === "degraded"
              ? "This edition published in a degraded state — some sources or candidates were unavailable."
              : ""}
          </p>
        </>
      )}
    </div>
  );
}
