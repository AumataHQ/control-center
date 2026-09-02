"use client";

import { useState } from "react";
import { CircleAlert, ExternalLink, RefreshCw } from "lucide-react";
import type { PipelineSnapshot } from "@/lib/types";
import styles from "./pipeline-view.module.css";

type View = "overview" | "editions" | "checks" | "sources" | "routes";

const VIEWS: { id: View; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "editions", label: "Editions" },
  { id: "checks", label: "Publication" },
  { id: "sources", label: "Sources" },
  { id: "routes", label: "Model routes" },
];

function State({ state }: { state: string }) {
  const tone = state === "ok" || state === "succeeded" ? styles.ok
    : state === "failed" || state === "unhealthy" ? styles.bad
    : styles.idle;
  return <span className={`${styles.state} ${tone}`}>{state}</span>;
}

function Tile({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: "good" | "bad" }) {
  return (
    <div className={`${styles.tile} ${tone ? styles[tone] : ""}`}>
      <span>{label}</span>
      <b>{value}</b>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function relative(value?: string) {
  if (!value) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function DashboardUsage({ usage }: { usage?: PipelineSnapshot["dashboardUsage"] }) {
  if (!usage?.calls) return null;
  return (
    <div>
      <div className={styles.rowHead} style={{ marginBottom: 8 }}>
        <b>This dashboard&apos;s model calls</b>
        <span className={styles.mono}>last 7 days</span>
      </div>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr><th>Job</th><th>Provider</th><th>Calls</th><th>OK</th><th>Failed</th><th>Avg ms</th></tr>
          </thead>
          <tbody>
            {usage.rows.map((row) => (
              <tr key={`${row.job}-${row.provider}-${row.model}`}>
                <td className={styles.mono}>{row.job}</td>
                <td className={styles.mono}>{row.provider === "gateway" ? "gateway" : row.provider}</td>
                <td>{row.calls}</td>
                <td>{row.ok}</td>
                <td>{row.failed}</td>
                <td>{row.averageLatencyMs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.empty}>
        Curation, mention summaries, and newsletter extraction run here rather than in the
        pipeline, so this is the half of the model bill this machine is responsible for.
      </p>
    </div>
  );
}

export function PipelineView({
  snapshot,
  loading,
  onRefresh,
  onSetup,
}: {
  snapshot: PipelineSnapshot | null;
  loading: boolean;
  onRefresh: () => void;
  onSetup: () => void;
}) {
  const [view, setView] = useState<View>("overview");

  if (!snapshot?.configured)
    return (
      <div className={styles.root}>
        <div className="panel empty-state setup-empty">
          <h2>Watch a publication pipeline</h2>
          <p>
            Point this at a pipeline checkout to see its editions, publication checks, per-source
            health, and model-route usage. The pipeline keeps running on its own schedule; this is a
            read-only view of what it wrote.
          </p>
          <button className="button button-primary" onClick={onSetup}>Open settings</button>
        </div>
        <DashboardUsage usage={snapshot?.dashboardUsage} />
      </div>
    );

  if (snapshot.error || !snapshot.rootReadable)
    return (
      <div className="panel">
        <div className="error-notice">
          <CircleAlert size={17} />
          <div>
            <b>The pipeline directory could not be read</b>
            <p>{snapshot.error || "Check the configured path."}</p>
          </div>
        </div>
        <button className="button button-outline" onClick={onSetup}>Open settings</button>
      </div>
    );

  const { publication, run, usage, preflight, sources, editions, latestEdition, radar, profile, publicUrl } = snapshot;
  const publishedToday = latestEdition?.date === snapshot.day;
  const failedSources = sources.filter((source) => source.state !== "ok");

  return (
    <div className={styles.root}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Pipeline · {snapshot.day}</p>
          <h1>Publication</h1>
        </div>
        <button className="button button-outline" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className={styles.headline}>
        <Tile
          label="Today's edition"
          value={publishedToday ? "Published" : "Not yet"}
          tone={publishedToday ? "good" : "bad"}
          detail={latestEdition ? `Latest ${latestEdition.date}` : "No editions found"}
        />
        <Tile
          label="Publication checks"
          value={publication ? `${publication.passed} / ${publication.passed + publication.failed}` : "—"}
          tone={publication ? (publication.failed ? "bad" : "good") : undefined}
          detail={publication?.failed ? `${publication.failed} failing` : publication ? "All passed" : "No receipt yet"}
        />
        <Tile
          label="Sources"
          value={sources.length ? `${sources.length - failedSources.length} / ${sources.length}` : "—"}
          tone={failedSources.length ? "bad" : sources.length ? "good" : undefined}
          detail={failedSources.length ? `${failedSources.length} quarantined` : sources.length ? "All healthy" : "No health receipt"}
        />
        <Tile
          label="Model calls"
          value={usage ? String(usage.calls) : "—"}
          tone={usage?.failed ? "bad" : undefined}
          detail={usage ? `${usage.totalTokens.toLocaleString()} tokens · ${usage.failed} failed` : "No receipts today"}
        />
      </div>

      <div className={styles.views} role="group" aria-label="Pipeline views">
        {VIEWS.map((entry) => (
          <button key={entry.id} aria-pressed={view === entry.id} onClick={() => setView(entry.id)}>
            {entry.label}
          </button>
        ))}
      </div>

      {view === "overview" && (
        <div className={styles.rows}>
          {run ? (
            <div className={styles.row}>
              <div className={styles.rowHead}>
                <b>Scheduler run</b>
                <State state={run.status} />
              </div>
              {run.attempts.map((attempt, index) => (
                <small key={`${attempt.startedAt}-${index}`} className={styles.mono}>
                  attempt {index + 1} · exit {attempt.exitCode} · {relative(attempt.startedAt)}
                </small>
              ))}
            </div>
          ) : (
            <p className={styles.empty}>No scheduler receipt for {snapshot.day} yet.</p>
          )}
          {radar ? (
            <div className={styles.row}>
              <div className={styles.rowHead}><b>Watchlist</b><span className={styles.mono}>{radar.enabled} enabled</span></div>
              <small>
                {radar.counts.x} X · {radar.counts.youtube} YouTube · {radar.counts.feeds} feeds
                {radar.disabled ? ` · ${radar.disabled} muted` : ""}
              </small>
              <p>Editing the watchlist stays with the pipeline, so its format-preserving writer and commit trail remain the record.</p>
            </div>
          ) : null}
          {profile ? (
            <div className={styles.row}>
              <div className={styles.rowHead}><b>Ranking profile</b><span className={styles.mono}>{profile.lanes.length} lanes</span></div>
              <small>{profile.lanes.join(" · ") || "No lanes configured"}</small>
              {profile.painPoints.length ? <small>Pain points: {profile.painPoints.join("; ")}</small> : null}
              {Object.keys(profile.weights).length ? (
                <small className={styles.mono}>
                  {Object.entries(profile.weights).map(([name, weight]) => `${name} ${weight}`).join(" · ")}
                </small>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {view === "editions" && (
        <div className={styles.rows}>
          {editions.length ? editions.map((edition) => (
            <div key={edition.date} className={styles.row}>
              <div className={styles.rowHead}>
                <b>{edition.title}</b>
                {edition.isToday ? <State state="today" /> : null}
              </div>
              <small className={styles.mono}>
                {edition.date} · {edition.format}
                {edition.writerModel ? ` · wrote via ${edition.writerModel}` : ""}
              </small>
              {publicUrl ? (
                <a
                  className="text-button"
                  href={`${publicUrl}/${edition.isToday ? "" : `${edition.date}/`}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <ExternalLink size={13} /> Open published edition
                </a>
              ) : null}
            </div>
          )) : <p className={styles.empty}>No editions found in this pipeline directory.</p>}
        </div>
      )}

      {view === "checks" && (
        <div className={styles.rows}>
          {publication ? (
            <>
              {publication.writerModel ? (
                <p className={styles.empty}>
                  Written by <span className={styles.mono}>{publication.writerModel}</span>
                  {publication.day ? ` for ${publication.day}` : ""}.
                </p>
              ) : null}
              {publication.checks.map((check) => (
                <div key={check.name} className={styles.row}>
                  <div className={styles.rowHead}>
                    <b className={styles.mono}>{check.name}</b>
                    <State state={check.ok ? "ok" : "failed"} />
                  </div>
                  {check.detail ? <small>{check.detail}</small> : null}
                </div>
              ))}
            </>
          ) : <p className={styles.empty}>No publication receipt for {snapshot.day} yet.</p>}
        </div>
      )}

      {view === "sources" && (
        <div className={styles.rows}>
          {sources.length ? sources.map((source) => (
            <div key={`${source.category}-${source.name}`} className={styles.row}>
              <div className={styles.rowHead}>
                <b className={styles.mono}>{source.name}</b>
                <State state={source.state} />
              </div>
              <small>
                {source.category}
                {source.checkedAt ? ` · checked ${relative(source.checkedAt)}` : ""}
              </small>
              {source.detail ? <small>{source.detail}</small> : null}
            </div>
          )) : <p className={styles.empty}>No source-health receipt for {snapshot.day} yet.</p>}
        </div>
      )}

      {view === "routes" && (
        <div className={styles.rows}>
          {preflight ? (
            <div className={styles.row}>
              <div className={styles.rowHead}>
                <b>Route preflight</b>
                <State state={preflight.ok ? "ok" : "failed"} />
              </div>
              <small>
                Gateway {preflight.reachable ? "reachable" : "unreachable"}
                {preflight.checkedAt ? ` · ${relative(preflight.checkedAt)}` : ""}
              </small>
              {preflight.routes.map((route) => (
                <small key={route.route} className={styles.mono}>
                  {route.ok ? "ok" : "FAIL"} · {route.route} · {route.required ? "required" : "optional"}
                  {route.kind && !route.ok ? ` · ${route.kind}` : ""}
                </small>
              ))}
            </div>
          ) : null}
          {usage ? (
            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead>
                  <tr><th>Route</th><th>Calls</th><th>OK</th><th>Failed</th><th>Tokens</th><th>Avg ms</th></tr>
                </thead>
                <tbody>
                  {usage.routes.map((route) => (
                    <tr key={route.route}>
                      <td className={styles.mono}>{route.route}</td>
                      <td>{route.calls}</td>
                      <td>{route.ok}</td>
                      <td>{route.failed}</td>
                      <td>{route.totalTokens.toLocaleString()}</td>
                      <td>{route.averageLatencyMs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className={styles.empty}>
                {usage.retriedAttempts} retried {usage.retriedAttempts === 1 ? "attempt" : "attempts"}.
                A route that failed over is otherwise invisible: the published edition records only
                the model that finally answered.
              </p>
            </div>
          ) : <p className={styles.empty}>No model-gateway receipts for {snapshot.day} yet.</p>}
          <DashboardUsage usage={snapshot.dashboardUsage} />
        </div>
      )}
    </div>
  );
}
