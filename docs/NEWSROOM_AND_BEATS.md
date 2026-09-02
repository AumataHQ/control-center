# Control Center as the newsroom, with tracked beats

## Context

SignalScribe publishes one page a day. Behind it sits far more work than the page shows — items collected and rejected, scores, merges, links fetched and links that failed — and none of it is visible anywhere. The ask: Control Center becomes the newsroom you walk into to see that work, and gains the ability to put a technology, product or theme under standing coverage until it's retired.

Two facts from examining both codebases change the shape of this.

**1. The knowledge base is not part of daily production.** SignalScribe has two pipelines over the same raw collector dumps, and they share nothing else:

| | Findings pipeline | Brief pipeline |
|---|---|---|
| Driver | `run_intelligence.sh` | `run_daily_brief.sh` |
| Path | dumps → observations → findings → KB | dumps → candidates → stories → page |
| Output | `data/observations/**`, `workspace.html` | `site/index.html` |

`assemble_smart_brief.py` never imports `normalize_observations` or `extract_findings`, and never reads `OBS_DIR` — `load_raw_items` (`assemble_smart_brief.py:366-428`) re-reads the collector dumps itself. **Findings are dead-ended relative to the published brief**: nothing in the knowledge base can ever reach the page.

The knowledge base does run in production, but only downstream of success. `run_scheduler.py:155-161` runs the brief, and *only if it exits 0* and `SS_TELEGRAM_ENABLED=1` does it call `run_intelligence.sh --skip-scan --live-llm --telegram` (`:109-120`), which builds observations, extracts findings, merges the KB and sends the Telegram summary. That flag is `1` in production, so the KB is live — but it is gated behind a published edition, which is why it has not run during the current outage, and `data/kb/signalscribe.db` has never existed in a local checkout.

So the newsroom has two halves with very different availability. The brief pipeline's trail is produced on **every** run, including failed ones. The knowledge base is produced only after a **successful** one. A newsroom built on the KB alone would go dark exactly when you most want to look inside — which is the argument for building on the trail first.

**2. A crude beat already exists.** `score_item` (`assemble_smart_brief.py:469`) contains `+4 if "buzz" appears on a YouTube item`. Someone already wanted standing coverage and hardcoded one. This feature generalises that.

---

## What the newsroom actually holds

Everything below is already computed and mostly already persisted. The work is surfacing it, not producing it.

| Material | Where it lives now | Visible today |
|---|---|---|
| Every raw collected item | `data/<source>/latest.json` | no |
| Score per item, six components | `score_item:431-474`, recomputed 6× | no |
| Items that lost their slot | `also_noted`, capped at 24 (`:1195`) | partially, at the page bottom |
| Items withheld for no verified source | `brief["quarantined"]` with reason | count only |
| Which links were fetched, which failed, with the error | `data/research/latest.json` | no |
| Cross-source merges | `merged_sources` on the winner | no |
| Publication checks | `site/status.json` | yes, via the Pipeline tab |
| Per-source health | `data/daily/<date>/source_health.json` | yes |

**The one real gap in the data**: the quarantine list keys on `candidate_id` (a `_sid` slug) while the research receipt keys on `item["url"]`. They cannot be joined, so *"why did this candidate have no primary source"* is unanswerable from the artifacts. That needs one correlating field written at `assemble_smart_brief.py:1101-1109`.

---

## Design

### Beats are two kinds, not one

This is the decision that shapes everything else. The examples given span two matching problems that need different machinery:

- **Named things** — GrokBot, Buzz. Ambiguous words that will match constantly on nothing relevant. These need identity proof: literal evidence on the fetched page, disambiguating anchors, and negative contexts. Control Center's mention engine already does exactly this.
- **Themes** — personal AI assistants, multi-agent orchestration. No literal string finds these reliably; "multi-agent orchestration" does not match "orchestrating agents". These need a vocabulary and semantic matching.

Treating them as one thing does both badly. A beat therefore declares its kind.

### What the mention engine gives us free

Its verification core is genuinely topic-agnostic and reusable verbatim: URL canonicalisation and provider unwrapping, Google News RPC decoding, direct-page fetch with date mining, page-local evidence windows (±900 chars around the match), negative-term rejection, the freshness model, stable cross-day identity, scope retirement, and the summary/priority stage.

What is brand-specific and must be replaced for themes:
- `isUniqueIdentitySignal` (`mention-filter.ts:131-136`) treats only handles and domains as distinctive, so a topic phrase can never reach high confidence on its own.
- With one phrase, no anchors and `strictMode: true`, **every result is rejected** (`:439-443`).
- Exact whitespace-phrase matching with no stemming (`:78-83`).
- Sources are Google News + Bing News only.

There is a working configuration today, worth knowing before building anything: put sibling phrases in `terms` (each corroborates the others) or load `identityAnchors` with vocabulary — two anchors inside the page-local window is a first-class high-confidence path. That means **a theme beat can be trialled on the existing engine before a line is written**.

### Beat model

Stored in Control Center's SQLite, which is the newsroom.

```
beats            id, name, kind ('entity'|'theme'), status ('active'|'paused'|'retired'),
                 created_at, retired_at, notes
beat_terms       beat_id, kind ('phrase'|'anchor'|'negative'|'domain'), value
beat_matches     beat_id, item_category, item_external_id, matched_at,
                 confidence, why (the matched term and rule), reported_at
```

`beat_matches` follows the pattern already proven by `newsletter_topic_keys` (`newsletter-store.ts:59-65`) — a namespaced association table with merge and repoint logic already written at `:330-334`.

`reported_at` is what makes "report when there is news" work: a beat report is its unreported matches. Quiet beats produce nothing, so no daily noise.

Retirement keeps history. A retired beat stops collecting and stops matching; its past coverage stays readable.

### Three places a beat acts

1. **Collect** — a standing query per beat, reusing the mention engine's query planner and verification. Entity beats use identity proof; theme beats use vocabulary matching with AI reranking, closer to the industry curation path.
2. **Tag** — anything already collected by any Control Center collector, or read from the pipeline's dumps, gets matched against active beats and recorded in `beat_matches`. This is retrospective as well as live: turning on a beat should surface what already came in.
3. **Promote** — matched items enter SignalScribe's candidate pool with a priority boost, generalising the hardcoded `+4 buzz`.

### Feeding the publication

The clean injection point is `load_raw_items` in `assemble_smart_brief.py:366-428`, appending through its local `add(src, it)` closure, plus a new entry in `SECTIONS` (`:51-58`) so the source gets its own budget.

Two things must be right or items silently vanish:
- Conform to the seven keys everything downstream reads: `source, title, body, url, author, publishedAt, extra`.
- **Set `extra["source_urls"]`.** Without it every injected candidate is quarantined at `:1101` for having no verified primary source.

A source key missing from `SECTIONS` still produces stories but gets zero picked slots — that is the failure mode to avoid.

---

## Phases

**Phase 1 — Read the newsroom.** Control Center reads the brief pipeline's full trail: every candidate with its score, what was demoted, what was quarantined, the research receipts, the merges. Add the correlating field so quarantine reasons can be joined to the fetch that failed. No new collection, no writes to the pipeline.

*Exit:* for any published edition, you can see everything considered and why each thing did or did not make it.

**Phase 2 — Beats as a filter.** The beat model, the settings surface, and retrospective matching against everything Control Center already holds. Entity beats reuse the mention engine directly. Theme beats start as a configuration of it, so the shape is validated before new matching code exists.

*Exit:* declare "Buzz" and "multi-agent orchestration", and see what already arrived for each.

**Phase 3 — Beats as a collector.** Standing queries per beat. A distinctiveness model for themes to replace `isUniqueIdentitySignal`, plus term expansion so surface forms need not be enumerated by hand. Beat reports covering only unreported matches.

*Exit:* a beat finds news you had not already collected, and reports only when there is some.

**Phase 4 — Beats reach the paper.** Matched items injected at `load_raw_items` with a beat-derived boost; optionally a standing "special coverage" section. Retire the hardcoded `buzz` rule.

*Exit:* GrokBot ships something and it appears in the edition because it is on a beat.

---

## Risks

**Recall, not precision, is the hard part for themes.** Exact-phrase matching with no stemming means every surface form must be enumerated by hand inside a 12-term / 24-anchor budget. Term expansion is Phase 3 for a reason: without it a theme beat quietly under-reports, which is worse than over-reporting because nothing signals it.

**The sources are wrong for technology beats.** Google News and Bing News do not cover where multi-agent orchestration is actually discussed — arXiv, GitHub, HN, vendor engineering blogs. SignalScribe already collects several of those, which is an argument for tagging its dumps (Phase 2) before building new collection (Phase 3).

**Volume.** The mention path caps page fetches at 60 per pass, sized for a personal watchlist. A live technology beat will exceed it and the overflow currently counts as `rejected` with no distinct signal.

**Reading the knowledge base needs care.** It is real and it does run, but `kb.connect()` executes eight DDL statements on every open (`kb.py:121-127`), so it cannot be opened read-only; there is no `busy_timeout` or WAL, so a reader will collide with the writer; `list_findings` is N+1 with no pagination and loads the whole KB per call; and foreign keys are declared but never enabled. Control Center should read it through its own queries against a copy or with WAL enabled, not by importing `kb.py`.

**Joining the two halves is a separate project.** Findings can never reach the page today. Making them a candidate source is the same `load_raw_items` hook described above, but it is a distinct decision from surfacing the newsroom, and should not be bundled into it.

---

## What shipped — 2 September 2026

Decisions taken, then built. The plan above is the reasoning; this is the state.

**Control Center moved to TrueNAS.** It answers on the tailnet address only
(`http://100.121.13.81:3010`), with the loopback guard replaced by a bind
address and a host allowlist that do different jobs — see
[TRUENAS.md](./TRUENAS.md), which is explicit about which one is the boundary.
The LAN address refuses; verified.

**The backup lives on TrueNAS and R2 is disconnected.** MinIO in the same stack;
the existing SigV4 uploader needed no code change. Proved end to end: the
production knowledge base uploaded, downloaded, extracted, opened read-only,
`integrity_check` ok, 993 findings. TrueNAS is now the only copy — a deliberate
choice, recorded as such.

**The newsroom reads the pipeline's trail.** `newsroom_sync.py` pushes the day's
artifacts from the exit trap of every run, published or not, and a mirror pulls
them down. Phase 1 of the plan is done: every candidate with its score, what was
published, withheld, or outranked, and — the gap this plan identified — the
quarantine record now carries the candidate URL, so it joins to the exact fetch
that failed.

Editions written before the trail existed are reconstructed from what their
artifact holds and marked incomplete, rather than presented as the whole picture.

**Beats are built, both kinds.** Phase 2 and most of Phase 3. Entity beats
demand corroboration for an ambiguous name and say so when they cannot get it;
distinctive names stand alone. Theme beats match a vocabulary. A beat report is
its unreported matches, so a quiet beat produces nothing. Retiring keeps the
coverage.

The first scan over 22 days of real trail found 15 matches across four beats,
including twelve GrokBot items — most of them candidates the pipeline considered
and never published, which is the case the feature exists for.

**Collection improved where the plan said it would.** The site-discovery cascade
is ported into the pipeline, so `radar.yaml` can watch any URL rather than an
exact feed endpoint. Six primary sources registered. The port found a bug in the
original: path filtering discarded every entry of a feed the publisher pointed
us at, which is why a source configured as `openai.com/news` collected nothing
from a feed with 1,163 entries. Fixed in both.

### Not done, and why

**Beats do not reach the paper.** Phase 4 of the plan. Matched items are not
injected into the candidate pool and the hardcoded `+4 buzz` in `score_item`
still stands. The injection point and its two requirements are documented above;
what is missing is a decision about how much a beat should be worth, which is an
editorial question rather than a technical one.

**Term expansion for themes.** A theme still needs its surface forms enumerated
by hand within the term budget. The matcher tolerates plurals and common verb
endings, which is a real recall win over exact matching, but "orchestrating
agents" is found by its anchors rather than its phrase. Worth revisiting once
there is evidence of what the beats actually miss.

**The knowledge base is still dead-ended.** Findings cannot reach the page, and
joining the two halves remains the separate project this plan said it was.
