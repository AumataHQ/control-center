import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { combineIndustryDiscoveries, freshIndustryDiscoveries, sortIndustryItems, splitIndustryLibrary, topicDiscoveryStatus } from "../lib/industry";
import { industryAiCacheKey } from "../lib/industry-ai-cache";
import {
  canonicalizeIndustryUrl,
  curateIndustryDiscoveries,
  normalizeIndustryTitle,
  selectDiverseIndustryDiscoveries,
  stableIndustryDiscoveryId,
  type IndustryDiscoveryLike,
} from "../lib/industry-curation";
import {
  initializeIndustryStore,
  listIndustryDiscoveries,
  pruneIndustryDiscoveries,
  upsertIndustryDiscoveries,
} from "../lib/industry-store";
import { discoveredFeedLinks, isFeedDocument } from "../lib/feed-discovery";
import {
  feedIsTrusted,
  filterSitemapEntriesForSource,
  isUrlWithinSourcePath,
  newSitemapEntries,
  nextSitemapSnapshotUrls,
  observeUndatedFeedStories,
  parseFeed,
  parseSitemap,
  readBoundedResponseText,
  sitemapCoverageMessage,
  sourceContentPath,
  walkSitemap,
  walkSitemapRoots,
  writeFileAtomically,
  type SitemapFetcher,
} from "../lib/sitemap";

function urlset(entries: Array<{ loc: string; lastmod?: string }>) {
  return `<urlset>${entries.map((entry) => `<url><loc>${entry.loc}</loc>${entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : ""}</url>`).join("")}</urlset>`;
}

function sitemapIndex(urls: string[]) {
  return `<sitemapindex>${urls.map((url) => `<sitemap><loc>${url}</loc></sitemap>`).join("")}</sitemapindex>`;
}

test("valid empty feeds remain distinguishable from HTML challenge pages", () => {
  assert.equal(isFeedDocument("<rss><channel><title>Quiet trade journal</title></channel></rss>"), true);
  assert.equal(isFeedDocument("<html><title>Bot check</title></html>"), false);
});

test("feed discovery accepts valid HTML attribute spacing and unquoted URLs", () => {
  const links = discoveredFeedLinks(
    '<link rel="alternate" type = "application/rss+xml" href = /trade/updates.xml>',
    "https://example.com/journal/",
  );
  assert.deepEqual(links, ["https://example.com/trade/updates.xml"]);
});

test("watched-site updates remain additive when topic discovery is configured", () => {
  const watchedSite = {
    id: "site-update",
    title: "A new page whose title does not contain the configured topic",
    summary: "New page detected in the configured sitemap.",
    url: "https://example.com/releases/spring-catalog",
    source: "Example",
    publishedAt: "2026-08-24T15:00:00Z",
    kind: "sitemap" as const,
  };
  const topicNews = {
    id: "topic-update",
    title: "Circular packaging research",
    summary: "A topic-news result.",
    url: "https://news.example.org/circular-packaging",
    source: "News Example",
    publishedAt: "2026-08-24T16:00:00Z",
    kind: "topic" as const,
  };

  const combined = combineIndustryDiscoveries([watchedSite], [topicNews]);
  assert.deepEqual(combined.map((item) => item.id), ["topic-update", "site-update"]);
});

test("watched ordering keeps the complete active set", () => {
  const watched = Array.from({ length: 90 }, (_, index) => ({
    id: `watched-${index}`,
    title: `Watched ${index}`,
    summary: "",
    url: `https://watched.example/${index}`,
    source: "Watched",
    publishedAt: new Date(Date.UTC(2026, 7, 24, 10, index)).toISOString(),
    kind: "feed" as const,
  }));
  const topics = Array.from({ length: 150 }, (_, index) => ({
    id: `topic-${index}`,
    title: `Topic ${index}`,
    summary: "",
    url: `https://news.example/${index}`,
    source: "Topic",
    publishedAt: `2026-08-24T11:${String(index % 60).padStart(2, "0")}:00Z`,
    kind: "topic" as const,
  }));

  const selected = sortIndustryItems([...topics, ...watched], "watched");
  assert.equal(selected.length, 240);
  assert.equal(selected.slice(0, 90).every((item) => item.kind !== "topic"), true);
  assert.equal(selected[0].id, "watched-89");
  assert.equal(selected[89].id, "watched-0");
  assert.equal(selected.filter((item) => item.kind === "topic").length, 150);
});

test("manual archives are separate from expired and out-of-scope history", () => {
  const base = {
    id: "story",
    title: "Story",
    summary: "",
    url: "https://example.com/story",
    source: "Example",
    publishedAt: "2026-08-24T12:00:00Z",
  };
  const { archivedItems, historyItems } = splitIndustryLibrary([
    { ...base, id: "manual", workflow: { archiveReason: "user", archivedAt: "2026-08-24T13:00:00Z", restoreEligible: true } },
    { ...base, id: "expired", workflow: { archiveReason: "expired", restoreEligible: false } },
    { ...base, id: "removed-source", workflow: { archiveReason: "not-current", restoreEligible: false } },
  ]);

  assert.deepEqual(archivedItems.map((item) => item.id), ["manual"]);
  assert.deepEqual(historyItems.map((item) => item.id), ["expired", "removed-source"]);
});

test("industry updates support chronological and watched-source ordering", () => {
  const items = [
    { id: "topic-new", title: "Topic new", summary: "", url: "https://news.example/new", source: "News", publishedAt: "2026-08-24T14:00:00Z", kind: "topic" as const },
    { id: "watched-old", title: "Watched old", summary: "", url: "https://watched.example/old", source: "Watched", publishedAt: "2026-08-24T12:00:00Z", kind: "feed" as const },
    { id: "watched-new", title: "Watched new", summary: "", url: "https://watched.example/new", source: "Watched", publishedAt: "2026-08-24T13:00:00Z", kind: "sitemap" as const },
  ];

  assert.deepEqual(sortIndustryItems(items, "newest").map((item) => item.id), ["topic-new", "watched-new", "watched-old"]);
  assert.deepEqual(sortIndustryItems(items, "oldest").map((item) => item.id), ["watched-old", "watched-new", "topic-new"]);
  assert.deepEqual(sortIndustryItems(items, "watched").map((item) => item.id), ["watched-new", "watched-old", "topic-new"]);
  assert.deepEqual(sortIndustryItems([
    { ...items[0], importanceScore: 90 },
    { ...items[1], importanceScore: 55 },
    { ...items[2], importanceScore: 70 },
  ], "important").map((item) => item.id), ["topic-new", "watched-new", "watched-old"]);
  assert.deepEqual(items.map((item) => item.id), ["topic-new", "watched-old", "watched-new"]);
});

test("a newly configured feed does not import its stale backlog into local history", () => {
  const now = Date.parse("2026-08-24T16:00:00Z");
  const base = {
    id: "story",
    title: "Story",
    summary: "",
    url: "https://example.com/story",
    source: "Example",
    kind: "feed" as const,
  };
  const discoveries = freshIndustryDiscoveries([
    { ...base, id: "fresh", url: "https://example.com/fresh", publishedAt: "2026-08-24T15:00:00Z" },
    { ...base, id: "stale", url: "https://example.com/stale", publishedAt: "2026-05-01T12:00:00Z" },
  ], [], now);

  assert.deepEqual(discoveries.map((item) => item.id), ["fresh"]);
});

test("RSS 1.0 RDF items and dc:date are parsed as feed stories", () => {
  const stories = parseFeed(`
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <channel><title>Independent Architecture</title></channel>
      <item rdf:about="https://example.com/journal/passive-house-retrofit">
        <title>Passive house retrofit lessons</title>
        <link>/journal/passive-house-retrofit</link>
        <description>Measured heating demand after one winter.</description>
        <dc:date>2026-08-24T15:30:00Z</dc:date>
      </item>
    </rdf:RDF>
  `, "Fallback", "https://example.com/feed.rdf");

  assert.equal(stories.length, 1);
  assert.equal(stories[0].source, "Independent Architecture");
  assert.equal(stories[0].url, "https://example.com/journal/passive-house-retrofit");
  assert.equal(stories[0].publishedAt, "2026-08-24T15:30:00Z");
  assert.equal(stories[0].kind, "feed");
  assert.match(stories[0].id, /^[a-f0-9]{20}$/);
});

test("feed stories are sorted before the safety cap is applied", () => {
  const items = Array.from({ length: 251 }, (_, index) => `<item><guid>story-${index}</guid><title>Story ${index}</title><link>https://example.com/story-${index}</link><pubDate>${new Date(Date.UTC(2026, 7, 1, 0, index)).toUTCString()}</pubDate></item>`).reverse().join("");
  const stories = parseFeed(`<rss><channel><title>Large feed</title>${items}</channel></rss>`, "Fallback");
  assert.equal(stories.length, 250);
  assert.equal(stories[0].title, "Story 250");
  assert.equal(stories.at(-1)?.title, "Story 1");
});

test("configured content paths scope sitemap URLs while feed endpoints remain unscoped", () => {
  assert.equal(sourceContentPath("https://example.com/journal"), "/journal");
  assert.equal(sourceContentPath("https://example.com/journal/feed.xml"), "");
  assert.equal(isUrlWithinSourcePath("https://www.example.com/journal/story", "https://example.com/journal"), true);
  assert.equal(isUrlWithinSourcePath("https://example.com/jobs/story", "https://example.com/journal"), false);

  const filtered = filterSitemapEntriesForSource([
    { loc: "https://example.com/journal/story", lastmod: "" },
    { loc: "https://example.com/jobs/opening", lastmod: "" },
  ], "https://example.com/journal");
  assert.deepEqual(filtered.map((entry) => entry.loc), ["https://example.com/journal/story"]);
});

test("recursive sitemap walking reads children beyond 30 and nested indexes", async () => {
  const root = "https://example.com/sitemap.xml";
  const childUrls = Array.from({ length: 35 }, (_, index) => `https://example.com/sitemaps/child-${index}.xml`);
  const documents = new Map<string, string>([[root, sitemapIndex(childUrls)]]);
  childUrls.forEach((url, index) => {
    documents.set(url, index === 34
      ? sitemapIndex(["https://example.com/sitemaps/nested.xml"])
      : urlset([{ loc: `https://example.com/journal/story-${index}` }]));
  });
  documents.set("https://example.com/sitemaps/nested.xml", urlset([{ loc: "https://example.com/journal/story-34" }]));
  const fetcher: SitemapFetcher = async (url) => {
    const text = documents.get(url);
    if (!text) throw new Error(`Missing fixture ${url}`);
    return { text, finalUrl: url };
  };

  const result = await walkSitemap(root, fetcher, { concurrency: 4, maxDocuments: 100 });
  assert.equal(result.entries.length, 35);
  assert.equal(result.documentsRead, 37);
  assert.equal(result.documentsFailed, 0);
  assert.equal(result.truncated, false);
  assert.ok(result.entries.some((entry) => entry.loc.endsWith("story-34")));
});

test("all robots-declared sitemap roots are merged before standard-location fallback", async () => {
  const posts = "https://example.com/post-sitemap.xml";
  const pages = "https://example.com/page-sitemap.xml";
  const documents = new Map([
    [posts, urlset([{ loc: "https://example.com/posts/one" }])],
    [pages, urlset([{ loc: "https://example.com/about" }])],
  ]);
  const result = await walkSitemapRoots([posts, pages], async (url) => {
    const text = documents.get(url);
    if (!text) throw new Error(`Unexpected fallback request: ${url}`);
    return { text, finalUrl: url };
  });

  assert.deepEqual(result.entries.map((entry) => entry.loc).sort(), [
    "https://example.com/about",
    "https://example.com/posts/one",
  ]);
  assert.equal(result.documentsRead, 2);
  assert.equal(result.documentsFailed, 0);
});

test("undated feeds establish a quiet baseline and only emit later observations", () => {
  const checkedAt = "2026-08-24T12:00:00Z";
  const dated = {
    id: "dated",
    title: "Dated update",
    summary: "",
    url: "https://example.com/dated",
    source: "Example",
    publishedAt: "2026-08-24T10:00:00Z",
    kind: "feed" as const,
  };
  const oldUndated = { ...dated, id: "old-undated", title: "Old undated", url: "https://example.com/old-undated", publishedAt: "" };
  const initial = observeUndatedFeedStories([dated, oldUndated], undefined, checkedAt);
  assert.deepEqual(initial.items.map((item) => item.id), [dated.id]);
  assert.equal(initial.baselineCount, 1);

  const newUndated = { ...oldUndated, id: "new-undated", title: "New undated", url: "https://example.com/new-undated" };
  const later = observeUndatedFeedStories([dated, oldUndated, newUndated], initial.nextSeenUrls, "2026-08-24T13:00:00Z");
  assert.deepEqual(later.items.map((item) => item.id), [dated.id, newUndated.id]);
  assert.equal(later.items[1].publishedAt, "2026-08-24T13:00:00Z");
  assert.equal(later.items[1].discoveredAt, "2026-08-24T13:00:00Z");
  assert.equal(later.newlyObservedCount, 1);
});

test("recursive sitemap walking preserves readable entries and reports partial coverage", async () => {
  const root = "https://example.com/sitemap.xml";
  const good = "https://example.com/sitemaps/good.xml";
  const unavailable = "https://example.com/sitemaps/unavailable.xml";
  const fetcher: SitemapFetcher = async (url) => {
    if (url === root) return { text: sitemapIndex([good, unavailable]), finalUrl: url };
    if (url === good) return { text: urlset([{ loc: "https://example.com/journal/current" }]), finalUrl: url };
    throw new Error("HTTP 503 Service Unavailable");
  };

  const result = await walkSitemap(root, fetcher);
  assert.deepEqual(result.entries, [{ loc: "https://example.com/journal/current", lastmod: "" }]);
  assert.equal(result.documentsRead, 2);
  assert.equal(result.documentsFailed, 1);
  assert.deepEqual(result.failures, [{ url: unavailable, message: "HTTP 503 Service Unavailable" }]);
  assert.match(sitemapCoverageMessage(result, 1, 1), /partial coverage: 2\/3 sitemap documents read, 1 failed \(HTTP 503 Service Unavailable\)/);
});

test("sitemap walking resolves relative child and content URLs against final URLs", async () => {
  const root = "https://example.com/sitemap.xml";
  const fetcher: SitemapFetcher = async (url) => {
    if (url === root) return { text: sitemapIndex(["parts/current.xml"]), finalUrl: "https://www.example.com/maps/root.xml" };
    assert.equal(url, "https://www.example.com/maps/parts/current.xml");
    return { text: urlset([{ loc: "../../journal/today", lastmod: "2026-08-24" }]), finalUrl: url };
  };
  const result = await walkSitemap(root, fetcher);
  assert.deepEqual(result.entries, [{ loc: "https://www.example.com/journal/today", lastmod: "2026-08-24" }]);
  assert.equal(result.rootFinalUrl, "https://www.example.com/maps/root.xml");
});

test("first sitemap baselines remain quiet", () => {
  const entries = [{ loc: "https://example.com/journal/current", lastmod: "2026-08-24" }];
  assert.deepEqual(newSitemapEntries(entries), []);
});

test("partial sitemap coverage preserves seen URLs and defers an incomplete first baseline", () => {
  const previouslySeen = {
    "https://example.com/journal/current": "2026-08-23",
    "https://example.com/journal/temporarily-unreadable": "2026-08-22",
  };
  const partialEntries = [
    { loc: "https://example.com/journal/current", lastmod: "2026-08-24" },
    { loc: "https://example.com/journal/new", lastmod: "2026-08-24" },
  ];

  assert.equal(nextSitemapSnapshotUrls(partialEntries, undefined, false), null);
  const partialSnapshot = nextSitemapSnapshotUrls(partialEntries, previouslySeen, false);
  assert.deepEqual(partialSnapshot, {
    ...previouslySeen,
    "https://example.com/journal/current": "2026-08-24",
    "https://example.com/journal/new": "2026-08-24",
  });
  assert.deepEqual(newSitemapEntries([
    ...partialEntries,
    { loc: "https://example.com/journal/temporarily-unreadable", lastmod: "2026-08-22" },
  ], partialSnapshot || undefined), []);
});

test("bounded response reading enforces streamed and declared limits", async () => {
  const withinLimit = new Response("12345");
  assert.equal(await readBoundedResponseText(withinLimit, 5), "12345");

  const streamed = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("123"));
      controller.enqueue(new TextEncoder().encode("456"));
      controller.close();
    },
  }));
  await assert.rejects(readBoundedResponseText(streamed, 5), /larger than 5 bytes/);
  await assert.rejects(readBoundedResponseText(new Response("small", { headers: { "content-length": "6" } }), 5), /larger than 5 bytes/);
});

test("ordinary gzip sitemap files are decoded with a decompressed size bound", async () => {
  const xml = urlset([{ loc: "https://example.com/journal/new", lastmod: "2026-08-24" }]);
  const decoded = await readBoundedResponseText(new Response(gzipSync(xml), {
    headers: { "content-type": "application/gzip" },
  }), Buffer.byteLength(xml));
  assert.deepEqual(parseSitemap(decoded), {
    kind: "urls",
    entries: [{ loc: "https://example.com/journal/new", lastmod: "2026-08-24" }],
  });

  const compressedBomb = gzipSync("x".repeat(1_000));
  assert.ok(compressedBomb.byteLength < 100);
  await assert.rejects(
    readBoundedResponseText(new Response(compressedBomb), 100),
    /larger than 100 bytes after decompression/,
  );
});

test("parallel atomic writes never collide or leave a partial snapshot", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "control-center-industry-"));
  const target = path.join(directory, "industry-snapshots.json");
  const payloads = Array.from({ length: 20 }, (_, index) => `${JSON.stringify({ writer: index, urls: Array.from({ length: 100 }, (__, item) => `${index}-${item}`) })}\n`);
  try {
    await Promise.all(payloads.map((payload) => writeFileAtomically(target, payload)));
    const final = await readFile(target, "utf8");
    assert.ok(payloads.includes(final));
    assert.doesNotThrow(() => JSON.parse(final));
    assert.deepEqual((await readdir(directory)).sort(), ["industry-snapshots.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("industry discovery identity is stable across tracking URLs and provider wrappers", () => {
  const base: IndustryDiscoveryLike = {
    title: "Acme launches reusable shipping crate - Trade Journal",
    summary: "",
    source: "Trade Journal",
    url: "https://www.example.com/news/acme-crate/?utm_source=digest&id=7#details",
    publishedAt: "2026-08-25T10:00:00Z",
    kind: "feed",
  };
  const trackedVariant = {
    ...base,
    url: "https://example.com/news/acme-crate?id=7&utm_campaign=weekly",
  };
  assert.equal(canonicalizeIndustryUrl(base.url), "https://example.com/news/acme-crate?id=7");
  assert.equal(normalizeIndustryTitle(base.title, base.source), "acme launches reusable shipping crate");
  assert.equal(stableIndustryDiscoveryId(base), stableIndustryDiscoveryId(trackedVariant));

  const wrapper = {
    ...base,
    kind: "topic",
    url: "https://news.google.com/rss/articles/provider-token-a?oc=5",
  };
  assert.equal(
    stableIndustryDiscoveryId(wrapper),
    stableIndustryDiscoveryId({ ...wrapper, url: "https://news.google.com/rss/articles/provider-token-b?hl=en-US" }),
  );
});

test("industry curation deduplicates canonical and title matches while preferring watched sources", () => {
  const now = Date.parse("2026-08-25T16:00:00Z");
  const direct: IndustryDiscoveryLike = {
    id: "direct",
    title: "Acme launches reusable shipping crate",
    summary: "Acme announced a reusable crate for regional delivery networks.",
    source: "Acme",
    url: "https://acme.example/news/reusable-crate?utm_source=feed",
    publishedAt: "2026-08-25T12:00:00Z",
    kind: "feed",
  };
  const canonicalDuplicate = {
    ...direct,
    id: "canonical-duplicate",
    url: "https://www.acme.example/news/reusable-crate/",
    kind: "topic",
  };
  const titleDuplicate = {
    ...direct,
    id: "title-duplicate",
    source: "Trade Journal",
    url: "https://news.example/acme-crate",
    kind: "topic",
  };
  const result = curateIndustryDiscoveries(
    [canonicalDuplicate, titleDuplicate, direct],
    { now, topicTerms: ["reusable shipping"], limit: 10 },
  );

  assert.equal(result.candidateCount, 3);
  assert.equal(result.deduplicatedCount, 2);
  assert.equal(result.selected.length, 1);
  assert.equal(result.selected[0].item.id, "direct");
  assert.equal(result.selected[0].watched, true);
  assert.deepEqual(result.selected[0].corroboratingSources.sort(), ["Acme", "Trade Journal"]);
});

test("industry curation keeps unrelated watched pages with the same sparse title", () => {
  const result = curateIndustryDiscoveries([
    {
      id: "alpha-results",
      title: "Quarterly results",
      summary: "Alpha published its current operating results.",
      source: "Alpha",
      url: "https://alpha.example/investors/quarterly-results",
      publishedAt: "2026-08-25T12:00:00Z",
      kind: "feed",
    },
    {
      id: "beta-results",
      title: "Quarterly results",
      summary: "Beta published a different current operating report.",
      source: "Beta",
      url: "https://beta.example/news/quarterly-results",
      publishedAt: "2026-08-25T13:00:00Z",
      kind: "feed",
    },
  ], { now: Date.parse("2026-08-25T16:00:00Z"), limit: 10 });

  assert.equal(result.deduplicatedCount, 0);
  assert.deepEqual(result.selected.map((candidate) => candidate.item.id).sort(), [
    "alpha-results",
    "beta-results",
  ]);
});

test("industry curation applies generic exclusions and keeps similar events from dominating", () => {
  const now = Date.parse("2026-08-25T16:00:00Z");
  const item = (id: string, title: string, source: string): IndustryDiscoveryLike => ({
    id,
    title,
    summary: "A detailed current report about recyclable packaging supply chains.",
    source,
    url: `https://${source.toLowerCase().replace(/\s/g, "-")}.example/${id}`,
    publishedAt: "2026-08-25T14:00:00Z",
    kind: "topic",
  });
  const result = curateIndustryDiscoveries([
    item("first", "Acme launches Nova recyclable packaging platform", "Journal One"),
    item("second", "Nova recyclable packaging platform launches from Acme", "Journal Two"),
    item("betting", "Sports betting platform expands packaging sponsorship", "Journal Three"),
    { ...item("privacy", "Privacy policy", "Journal Four"), url: "https://journal-four.example/privacy-policy" },
  ], {
    now,
    topicTerms: ["recyclable packaging"],
    excludeTerms: ["sports betting"],
    limit: 10,
  });

  assert.equal(result.selected.length, 1);
  assert.equal(result.deferred.filter((candidate) => candidate.deferredReason === "similar-event").length, 1);
  assert.deepEqual(result.excluded.map((candidate) => candidate.item.id).sort(), ["betting", "privacy"]);
});

test("industry curation bounds the daily set and preserves watched and source diversity", () => {
  const now = Date.parse("2026-08-25T16:00:00Z");
  const topicItems = Array.from({ length: 45 }, (_, index): IndustryDiscoveryLike => ({
    id: `topic-${index}`,
    title: `Manufacturer ${String(index).padStart(3, "0")} announces circular material ${String(index).padStart(3, "0")}`,
    summary: "A current material announcement for reusable shipping systems.",
    source: index < 35 ? "Large Wire" : "Specialist Review",
    url: `https://news.example/${index}`,
    publishedAt: new Date(now - index * 60_000).toISOString(),
    kind: "topic",
  }));
  const watched = Array.from({ length: 5 }, (_, index): IndustryDiscoveryLike => ({
    id: `watched-${index}`,
    title: `Supplier ${String(index).padStart(3, "0")} releases fiber product ${String(index).padStart(3, "0")}`,
    summary: "A new page on a watched supplier site.",
    source: "Watched Supplier",
    url: `https://supplier.example/releases/${index}`,
    publishedAt: new Date(now - index * 60_000).toISOString(),
    kind: "feed",
  }));
  const result = curateIndustryDiscoveries([...topicItems, ...watched], {
    now,
    topicTerms: ["circular material", "reusable shipping"],
    limit: 10,
    maxPerSource: 2,
  });

  assert.equal(result.selected.length, 10);
  assert.ok(result.selected.some((candidate) => candidate.watched));
  assert.ok(new Set(result.selected.map((candidate) => candidate.item.source)).size >= 3);
  assert.ok(result.deferred.some((candidate) => candidate.deferredReason === "source-diversity" || candidate.deferredReason === "daily-limit"));

  const defaultBound = curateIndustryDiscoveries(
    Array.from({ length: 50 }, (_, index): IndustryDiscoveryLike => ({
      id: `independent-${index}`,
      title: `Organization ${String(index).padStart(3, "0")} announces standard ${String(index).padStart(3, "0")}`,
      summary: "",
      source: `Source ${index}`,
      url: `https://source-${index}.example/story`,
      publishedAt: new Date(now - index * 60_000).toISOString(),
      kind: "topic",
    })),
    { now },
  );
  assert.equal(defaultBound.selected.length, 30);
});

test("semantic ranking is constrained by deterministic source diversity", () => {
  const now = Date.parse("2026-08-25T16:00:00Z");
  const wireTitles = [
    "Copper tariff reshapes Chile contracts",
    "Battery recall closes Ohio plant",
    "Shipping law changes Baltic insurance",
    "Patent ruling alters medical licensing",
    "Drought report cuts regional harvest",
    "Security breach delays airline merger",
  ];
  const specialistTitles = [
    "University maps coral recovery",
    "Regulator approves timber standard",
    "Cooperative opens dairy exchange",
    "Laboratory studies ceramic coating",
  ];
  const raw = [
    ...wireTitles.map((title, index): IndustryDiscoveryLike => ({
      id: `wire-${index}`,
      title,
      summary: "A timely report about the configured market.",
      source: "Dominant Wire",
      url: `https://wire.example/${index}`,
      publishedAt: new Date(now - index * 60_000).toISOString(),
      kind: "feed",
    })),
    ...specialistTitles.map((title, index): IndustryDiscoveryLike => ({
      id: `specialist-${index}`,
      title,
      summary: "A timely independent report about the configured market.",
      source: `Specialist ${index}`,
      url: `https://specialist-${index}.example/report`,
      publishedAt: new Date(now - (index + 10) * 60_000).toISOString(),
      kind: "feed",
    })),
  ];
  const ranked = raw.flatMap((item) => curateIndustryDiscoveries([item], { now }).selected);
  const selected = selectDiverseIndustryDiscoveries(ranked, {
    limit: 6,
    maxPerSource: 2,
  }).selected;

  assert.equal(selected.length, 6);
  assert.equal(selected.filter((candidate) => candidate.item.source === "Dominant Wire").length, 2);
  assert.equal(new Set(selected.map((candidate) => candidate.item.source)).size, 5);
});

test("industry AI cache identity changes with discoveries, content, and exclusions", () => {
  const now = Date.parse("2026-08-25T16:00:00Z");
  const candidate = curateIndustryDiscoveries([{
    id: "release",
    title: "Acme releases a recyclable container",
    summary: "Initial release details.",
    source: "Acme",
    url: "https://acme.example/releases/container",
    publishedAt: "2026-08-25T14:00:00Z",
    kind: "feed",
  }], { now }).selected[0];
  const settings = { provider: "openai", model: "gpt-test" };
  const options = {
    niche: "Reusable packaging",
    keywords: ["recyclable container"],
    excludedTerms: [] as string[],
    limit: 30,
    now,
  };
  const initial = industryAiCacheKey(settings, [candidate], options);

  assert.equal(initial, industryAiCacheKey(settings, [candidate], options));
  assert.notEqual(initial, industryAiCacheKey(settings, [candidate], {
    ...options,
    excludedTerms: ["consumer coupons"],
  }));
  assert.notEqual(initial, industryAiCacheKey(settings, [{
    ...candidate,
    item: { ...candidate.item, summary: "Corrected and expanded release details." },
  }], options));
  assert.notEqual(initial, industryAiCacheKey(settings, [{
    ...candidate,
    discoveryId: "another-discovery",
  }], options));
});

test("topic discovery only reports live after a successful provider query", () => {
  assert.equal(topicDiscoveryStatus({
    endpoint: "https://news.google.com/",
    itemCount: 0,
    keywordCount: 2,
    successfulQueries: 0,
  }), null);
  assert.equal(topicDiscoveryStatus({
    endpoint: "https://news.google.com/rss/search?q=test",
    itemCount: 3,
    keywordCount: 2,
    successfulQueries: 1,
  })?.state, "live");
});

test("industry discovery store keeps raw candidates separate and preserves first seen time", () => {
  const database = initializeIndustryStore(new DatabaseSync(":memory:"));
  const firstSeen = "2026-08-25T10:00:00Z";
  const secondSeen = "2026-08-25T11:00:00Z";
  const kept: IndustryDiscoveryLike = {
    id: "kept",
    title: "Acme launches a recyclable container",
    summary: "Initial summary",
    source: "Acme",
    url: "https://acme.example/releases/container?utm_source=rss",
    publishedAt: "2026-08-25T09:00:00Z",
    kind: "feed",
    collectionScope: "source-acme",
  };
  const excluded: IndustryDiscoveryLike = {
    id: "excluded",
    title: "Privacy policy",
    summary: "",
    source: "Acme",
    url: "https://acme.example/privacy-policy",
    publishedAt: "2026-08-25T09:30:00Z",
    kind: "sitemap",
    collectionScope: "source-acme",
  };

  const initial = upsertIndustryDiscoveries(database, [kept, excluded], firstSeen);
  assert.deepEqual({ inserted: initial.inserted, updated: initial.updated }, { inserted: 2, updated: 0 });
  assert.equal(listIndustryDiscoveries(database).length, 2);

  const refreshed = upsertIndustryDiscoveries(database, [{
    ...kept,
    title: "Acme launches its recyclable container",
    summary: "Corrected upstream summary",
    url: "https://www.acme.example/releases/container/",
  }], secondSeen);
  assert.deepEqual({ inserted: refreshed.inserted, updated: refreshed.updated }, { inserted: 0, updated: 1 });
  const scoped = listIndustryDiscoveries<IndustryDiscoveryLike>(database, {
    collectionScopes: ["source-acme"],
    since: "2026-08-25T08:00:00Z",
  });
  assert.equal(scoped.length, 2);
  const updated = scoped.find((record) => record.item.id === "kept");
  assert.equal(updated?.firstSeenAt, "2026-08-25T10:00:00.000Z");
  assert.equal(updated?.lastSeenAt, "2026-08-25T11:00:00.000Z");
  assert.equal(updated?.canonicalUrl, "https://acme.example/releases/container");
  assert.equal(updated?.item.summary, "Corrected upstream summary");
  database.close();
});

test("industry discovery store normalizes RFC feed dates before SQL freshness filtering", () => {
  const database = initializeIndustryStore(new DatabaseSync(":memory:"));
  upsertIndustryDiscoveries(database, [{
    id: "rfc-feed-date",
    title: "A current standards release",
    source: "Standards Body",
    url: "https://standards.example/current-release",
    publishedAt: "Tue, 25 Aug 2026 21:40:21 GMT",
    kind: "feed",
    collectionScope: "standards",
  }], "2026-08-25T21:50:00Z");
  assert.equal(listIndustryDiscoveries(database, {
    since: "2026-08-24T21:50:00Z",
    until: "2026-08-25T22:00:00Z",
    collectionScopes: ["standards"],
  }).length, 1);
  database.close();
});

test("industry discovery store prunes expired raw discoveries without touching current rows", () => {
  const database = initializeIndustryStore(new DatabaseSync(":memory:"));
  const item = (id: string): IndustryDiscoveryLike => ({
    id,
    title: `Industry update ${id}`,
    source: "Trade Journal",
    url: `https://trade.example/${id}`,
    publishedAt: "2026-08-25T12:00:00Z",
    kind: "feed",
    collectionScope: "trade",
  });
  upsertIndustryDiscoveries(database, [item("expired")], "2026-04-01T12:00:00Z");
  upsertIndustryDiscoveries(database, [item("current")], "2026-08-25T12:00:00Z");

  assert.equal(pruneIndustryDiscoveries(database, {
    now: "2026-08-25T12:00:00Z",
    retentionDays: 90,
  }), 1);
  assert.deepEqual(
    listIndustryDiscoveries(database).map((record) => record.item.id),
    ["current"],
  );
  database.close();
});

test("a feed the publisher pointed us at is not filtered by the configured path", () => {
  const source = "https://example.com/news";

  // OpenAI's news feed is at /news/rss.xml and every one of its 1,163 articles
  // is under /index/. Filtering by path discarded the entire feed.
  assert.equal(feedIsTrusted("https://example.com/news/rss.xml", "https://example.com/news/rss.xml", source, false), true);

  // blog.google/technology/ai/rss redirects to /innovation-and-ai/technology/ai/rss/.
  assert.equal(feedIsTrusted("https://example.com/news/rss", "https://example.com/moved/news/rss", source, false), true);

  // A feed the page declared is authoritative wherever it lives.
  assert.equal(feedIsTrusted("https://example.com/elsewhere.xml", "https://example.com/elsewhere.xml", source, true), true);

  // A feed merely guessed at the origin might be the whole site's, so the
  // configured path remains the best guide to what belongs.
  assert.equal(feedIsTrusted("https://example.com/feed", "https://example.com/feed", source, false), false);
});
