# Changelog

## Unreleased

- **This dashboard is no longer deployed.** It ran briefly on a TrueNAS host as an operator surface over the SignalScribe publication pipeline; that deployment was removed on 2 September 2026 when the two systems were consolidated into the pipeline's own repository, which now owns the source registry and the backup target. The code and its gate are intact and the features below still work; nothing is running.
- Added a Newsroom view over the pipeline's editorial trail. It shows every candidate a run considered, the score each was given, and whether the story was published, withheld for want of a verified first-party source, or simply outranked — and for a withheld candidate, the exact links fetched on its behalf and the error each returned. That join was previously impossible from the artifacts, because the quarantine record named a candidate id while the research receipt was keyed by URL. Editions written before the trail existed are reconstructed from what their artifact does hold and are labelled incomplete rather than presented as complete.
- Added Beats: standing coverage of a named product or a subject, matched against everything the newsroom holds including the candidates that never reached the page. A named thing needs an owned domain or a confirming term near it before a match counts, since most product names are ordinary words; a name that could not be anything else stands alone. A theme matches a vocabulary rather than a literal string. A beat report is its unreported matches, so a quiet beat produces nothing and re-scanning never resurfaces something already read. Retiring a beat keeps everything it found.
- Stopped discarding the entries of a feed the publisher pointed us at. Feed entries were filtered to the configured source path, which is right for a sitemap and wrong for a feed: OpenAI's news feed is at `/news/rss.xml` and all 1,163 of its articles are under `/index/`, so a source configured as `openai.com/news` collected nothing and reported zero entries. A feed is now trusted when the page declared it, when it was requested under the configured path, or when it answered there. A feed merely guessed at the origin is still filtered.
- The server can bind to one configured private address instead of loopback only, for reaching it from another machine on a network you control. The bind address is the access boundary; a separate hostname allowlist defends against DNS rebinding, where the browser supplies an attacker's hostname. Binding to every interface is refused unless an environment variable asserts that something in front is doing the access control. Defaults are unchanged: loopback only.
- Added a container image and a health check, so the dashboard can run somewhere other than a laptop. The standalone build is produced alongside the normal one, so `npm run launch` is unaffected.

- The Pipeline view can now run pipeline steps and add watchlist sources. Steps come from a fixed table of named actions, so a request selects one rather than describing a command; nothing runs through a shell, and the only variable input any action takes is a JSON payload on stdin. Sources are written by the pipeline's own format-preserving writer, which backs up the watchlist first and refuses duplicates.
- Added per-job model selection. Industry ranking, mention research and summaries, and the three newsletter stages can each be pinned to their own model or gateway route; anything left on Default follows the global selection.

- Added local model-usage accounting. Every background AI call now records its job, provider, model, outcome, and latency, so a provider that quietly stopped answering is visible instead of looking like a quiet day in the results. The last seven days appear in the Pipeline view, grouped by job; history is kept for thirty days. Recording is best-effort and never fails a curation run.

- Added a Pipeline view: a read-only operator surface over a publication pipeline running on this machine. It shows whether today's edition published, which publication checks passed, per-source health with the reason each source was quarantined, scheduler attempts with exit codes, the model routes a preflight found healthy, and per-route model usage including calls that failed over. Reads are confined to the configured directory, and a symbolic link pointing out of it is refused rather than followed.

- Added a private model gateway provider. Background curation, mention summaries, and newsletter extraction can now run against an OpenAI-compatible gateway on your own network, selecting a route by the job it does rather than naming a vendor model. Gateway addresses are restricted to private networks, redirects are refused, and an upstream authentication failure returned as a successful completion is rejected instead of becoming curated content.
- Added recovery of truncated model output, so a reply cut off at its token limit is closed structurally instead of discarded. Incomplete entries are dropped rather than guessed.

## 0.3.1 - 2026-08-25

- Added persistent dark mode with a saved theme preference.
- Added Google OAuth client ID validation and clearer setup guidance to prevent account email addresses from being entered as client IDs.
- Added durable response snapshots for Industry, Mentions, and Newsletters so tab navigation opens saved results instead of rerunning collectors.
- Made Industry, Mention, and Newsletter archive actions update both SQLite and the saved response atomically, eliminating the post-archive collection delay.
- Added a direct Mention-to-Reminder action.
- Rebuilt Newsletters as an AI-required intelligence pipeline that reads unseen Gmail issues, extracts actual news, filters utility/promotional content, resolves safe public redirects, and combines duplicate coverage into stable topics with source and Gmail evidence links. Newsletter text goes only to the selected provider with tracking links and email addresses masked; raw bodies are not stored locally.
- Added schema-v5 migration backups plus normalized newsletter issue/mention tables and collector snapshots.

## 0.3.0 - 2026-08-25

- Split Industry into a broad raw-discovery store and a bounded importance queue, with canonical/title/event deduplication, configurable exclusions, source diversity, scoring reasons, and a default 30-update daily target.
- Added optional provider-selectable OpenAI, Anthropic, or Gemini background intelligence with private server-side keys, environment-key support, model overrides, two-hour caching, and deterministic fallback behavior.
- Expanded Mentions beyond news feeds with optional broad-web research, while requiring independently fetched canonical-page evidence, preserving strict namesake filtering, supporting negative contexts, and excluding owned sites by default.
- Changed Audience growth from the previous hourly refresh to a true 24–36 hour comparison, retaining one anchor per 12-hour bucket and safely migrating legacy snapshot files.
- Added schema-v4 migration backups and a separate SQLite table for raw Industry discoveries so surfaced history and user archive state remain durable.
- Updated first-run, backup, security, diagnostics, UI, and portable-install documentation for the new generic curation model.

## 0.2.1 - 2026-08-25

- Split automatically expired Industry history from items a user manually archived, added deterministic newest/oldest/watched-site sorting across the complete active set, and stopped stale or undated feed backlogs from appearing as new discoveries.
- Improved generic RSS/Atom and sitemap discovery, accepted valid empty feeds, exposed partial failures instead of false live status, and removed silent result caps that could hide current Industry or Mention items.
- Tightened seven-day mention matching so provider query terms never count as observed evidence, configured handles remain exact identities, and ambiguous names require configured corroboration in strict mode.
- Persisted follower and subscriber changes between successful audience checks, kept the comparison tied to the same primary metric, and separated post, video, and thread counts as content metadata.
- Made corrupt Audience history fail closed and visible in `npm run doctor` instead of silently replacing a verified baseline.
- Added immutable dated completion records for repeating tasks, guarded against double completion, preserved monthly schedule anchors, and made task writes immediately recoverable after a reload or process interruption.
- Kept fresh clones isolated from another checkout's browser state while retaining a safe migration path for existing repo-local installs.
- Pinned public-source requests to the DNS addresses that passed network validation, revalidated every redirect, and applied the same protection to LinkedIn profile checks.
- Expanded cross-platform production smoke coverage for personalized-data-free first runs, every live dashboard area, and the documented one-command launcher.

## 0.2.0 - 2026-08-25

- Added a one-command local launcher with health wait, browser opening, rebuild detection, and single-instance protection.
- Moved fresh-install data to stable per-user operating-system directories while preserving existing repo-local installs.
- Added fail-closed startup, ordered workspace saves, visible persistence errors, SQLite schema versioning, and serialized settings/token writes.
- Added a local request boundary, production smoke test, diagnostics, and consistent private backups.
- Hardened public-source network validation, Windows-safe atomic snapshots, private backup permissions, and cross-platform CI pinning.
- Added a provider-neutral Daily Brief bridge for user-approved Codex connectors, local scripts, and Today/Week action overviews.
- Added authoritative per-source Daily Brief syncs with empty-run health, failure reporting, source-scoped IDs, privacy cleanup, and bounded Week filtering.
- Made task/reminder corruption fail closed and fixed Unicode Daily Brief migrations plus future Today/Week event windows.
- Improved first-run deep links, live-load error handling, audience duplicate protection, valid profile examples, and configurable Gmail newsletter search.
- Hardened Industry, Mentions, and Audience collectors for feed/sitemap fallbacks, strict identity, archive deduplication, and public-account attribution.

## 0.1.0 - 2026-08-21

- Initial local Control Center dashboard and settings-driven collectors.
