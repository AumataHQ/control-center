import { createHash } from "node:crypto";
import type { AiKeyProvider, NewsletterFeedResponse, NewsletterSourceLink, NewsletterTopic } from "./types";
import { boundedPriority, newsletterPriority, sortFeedStories } from "./feed-priority";
import { EMAIL_TRACKING_PARAMETERS, trackingParameterMatcher } from "./tracking-parameters";

export type GmailMessagePart = {
  mimeType?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailMessagePart[];
};

export type ExtractedNewsletterLink = {
  url: string;
  title: string;
  context: string;
  importanceScore?: number;
  importanceReason?: string;
  curationMode?: "local" | AiKeyProvider;
};

export type NewsletterAiLink = { id: string; url: string; title: string };

export function maskNewsletterIdentifiers(value: string) {
  return value.replace(/https?:\/\/[^\s<>]+/gi, "[link omitted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email address]");
}

export function isNewsletterHousekeepingSubject(subject: string) {
  return /^(?:security alert|new sign[- ]in|unusual sign[- ]in|verify your|confirm your (?:email|subscription|account)|reset your password|password reset|your (?:verification|sign[- ]in|login) code|your (?:receipt|invoice|order confirmation)|welcome to|thanks for (?:signing up|subscribing|joining))\b/i.test(subject.trim()) ||
    /\b(?:was granted access to your|has access to your google account|verification code|email confirmation required)\b/i.test(subject);
}

export function prepareNewsletterForAi(input: { html?: string; text?: string }) {
  const links: NewsletterAiLink[] = [];
  const byUrl = new Map<string, string>();
  const reference = (rawUrl: string, title: string) => {
    let url: URL;
    try { url = new URL(decodeHtmlEntities(rawUrl)); } catch { return ""; }
    if (!["http:", "https:"].includes(url.protocol)) return "";
    const exact = url.toString();
    const existing = byUrl.get(exact);
    if (existing) return `[${existing}]`;
    if (links.length >= 160) return "[link omitted]";
    const id = `L${links.length + 1}`;
    byUrl.set(exact, id);
    links.push({ id, url: exact, title: maskNewsletterIdentifiers(title).slice(0, 200) });
    return `[${id}]`;
  };
  let body = input.html
    ? input.html.replace(/<a\b[^>]*?href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi,
        (_match, double, single, bare, copy) => {
          const title = readableText(copy || "");
          return ` ${title} ${reference(double || single || bare || "", title)} `;
        })
      .replace(/<\/(?:p|li|h[1-6]|div|tr|table)>|<br\s*\/?\s*>/gi, "\n")
      .replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
    : (input.text || "").replace(/https?:\/\/[^\s<>()\[\]{}"']+/gi,
        (url) => reference(url.replace(/[.,;!?]+$/, ""), ""));
  body = maskNewsletterIdentifiers(decodeHtmlEntities(body))
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
  return { bodyText: body.slice(0, 50_000), links };
}

export function validateNewsletterAiStories(value: unknown, links: NewsletterAiLink[], provider?: AiKeyProvider) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !Array.isArray((value as { stories?: unknown }).stories))
    throw new Error("Newsletter AI did not return a stories list.");
  const byId = new Map(links.map((link) => [link.id, link]));
  return ((value as { stories: unknown[] }).stories).slice(0, 20).flatMap((value): ExtractedNewsletterLink[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const story = value as { title?: unknown; summary?: unknown; linkIds?: unknown; score?: unknown; reason?: unknown; sponsored?: unknown };
    if (typeof story.title !== "string" || story.title.trim().length < 12 ||
        typeof story.summary !== "string" || story.summary.trim().length < 20 ||
        typeof story.score !== "number" || !Number.isFinite(story.score) || story.score < 55 ||
        story.sponsored !== false || !Array.isArray(story.linkIds)) return [];
    return [...new Set(story.linkIds)].flatMap((id) => {
      const link = typeof id === "string" ? byId.get(id) : undefined;
      return link ? [{
        url: link.url,
        title: story.title!.toString().trim().slice(0, 240),
        context: story.summary!.toString().trim().slice(0, 700),
        importanceScore: boundedPriority(story.score),
        importanceReason: typeof story.reason === "string" && story.reason.trim()
          ? story.reason.trim().slice(0, 240)
          : "AI identified a substantive news event supported by the newsletter's source links.",
        curationMode: provider,
      }] : [];
    }).slice(0, 4);
  }).slice(0, 60);
}

export type NewsletterMentionRecord = {
  id: string;
  issueId: string;
  canonicalUrl: string;
  url: string;
  title: string;
  context: string;
  publisher: string;
  newsletterSender: string;
  newsletterSubject: string;
  receivedAt: string;
  gmailUrl: string;
  firstSeenAt: string;
  importanceScore?: number;
  importanceReason?: string;
  curationMode?: "local" | AiKeyProvider;
};

const isTrackingParameter = trackingParameterMatcher(EMAIL_TRACKING_PARAMETERS);


const titleStopWords = new Set([
  "a", "about", "after", "again", "against", "all", "also", "an", "and",
  "are", "as", "at", "be", "because", "been", "before", "being", "but",
  "by", "can", "could", "did", "do", "does", "for", "from", "had", "has",
  "have", "how", "in", "into", "is", "it", "its", "more", "new", "not",
  "of", "on", "or", "our", "out", "over", "says", "than", "that", "the",
  "their", "this", "to", "up", "was", "we", "were", "what", "when",
  "where", "which", "who", "why", "will", "with", "would", "you", "your",
]);

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function readableText(value: string) {
  return decodeHtmlEntities(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

export function decodeGmailBody(data = "", maxBytes = 1_000_000) {
  if (!data) return "";
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const buffer = Buffer.from(normalized, "base64");
  return buffer.subarray(0, maxBytes).toString("utf8");
}

export function gmailMessageText(payload?: GmailMessagePart) {
  const html: string[] = [];
  const text: string[] = [];
  const visit = (part?: GmailMessagePart) => {
    if (!part) return;
    const body = decodeGmailBody(part.body?.data);
    if (body && part.mimeType?.toLowerCase() === "text/html") html.push(body);
    else if (body && part.mimeType?.toLowerCase() === "text/plain") text.push(body);
    for (const child of part.parts || []) visit(child);
  };
  visit(payload);
  return {
    html: html.join("\n").slice(0, 1_500_000),
    text: text.join("\n").slice(0, 1_000_000),
  };
}

function normalizedHost(hostname: string) {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function unwrapRedirectUrl(input: URL) {
  const host = normalizedHost(input.hostname);
  const redirectLike =
    host === "google.com" ||
    host.endsWith(".google.com") ||
    /(^|[.-])(click|email|link|links|redirect|track)([.-]|$)/.test(host) ||
    ["beehiiv.com", "substack.com"].some(
      (candidate) => host === candidate || host.endsWith(`.${candidate}`),
    );
  if (!redirectLike) return input;
  for (const key of ["url", "u", "target", "redirect", "redirect_url", "destination"]) {
    const candidate = input.searchParams.get(key);
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (["http:", "https:"].includes(parsed.protocol)) return parsed;
    } catch {
      // Keep the original redirect URL when the embedded target is not valid.
    }
  }
  return input;
}

export function canonicalizeNewsletterUrl(value: string) {
  try {
    let url = new URL(decodeHtmlEntities(value));
    url = unwrapRedirectUrl(url);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.username = "";
    url.password = "";
    url.hash = "";
    url.hostname = normalizedHost(url.hostname);
    for (const key of [...url.searchParams.keys()]) {
      if (isTrackingParameter(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return "";
  }
}

export function likelyNewsletterRedirect(value: string) {
  try {
    const url = new URL(value);
    const host = normalizedHost(url.hostname);
    return (
      /(^|[.-])(?:clicks?|email|e?links?|redirect|track(?:ing)?)\d*([.-]|$)/.test(host) ||
      /^\/ss\/c\//.test(url.pathname) ||
      ((host.endsWith("beehiiv.com") || host.endsWith("substack.com")) && /\/(?:redirect|link|click)\//.test(url.pathname)) ||
      [...url.searchParams.keys()].some((key) =>
        ["redirect", "redirect_url", "target", "url"].includes(key.toLowerCase()))
    );
  } catch {
    return false;
  }
}

export function newsletterSenderLabel(value: string) {
  return value.replace(/\s*<[^>]+>\s*$/, "").replace(/^"|"$/g, "").trim() || "Newsletter";
}

export function newsletterPublisher(value: string) {
  try {
    return normalizedHost(new URL(value).hostname);
  } catch {
    return "Source";
  }
}

export function newsletterMentionId(issueId: string, canonicalUrl: string, title: string) {
  return createHash("sha256")
    .update(`${issueId}\u0000${canonicalUrl}\u0000${normalizeNewsletterTitle(title)}`)
    .digest("hex")
    .slice(0, 24);
}

export function normalizeNewsletterTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokens(value: string) {
  return new Set(
    normalizeNewsletterTitle(value)
      .split(" ")
      .filter((token) => token.length > 2 && !titleStopWords.has(token)),
  );
}

export function newsletterTitlesMatch(left: string, right: string) {
  if (normalizeNewsletterTitle(left).length >= 12 &&
      normalizeNewsletterTitle(left) === normalizeNewsletterTitle(right)) return true;
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  if (leftTokens.size < 3 || rightTokens.size < 3) return false;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  const smaller = Math.min(leftTokens.size, rightTokens.size);
  const union = leftTokens.size + rightTokens.size - overlap;
  return overlap >= 3 && (overlap / smaller >= 0.75 || overlap / union >= 0.6);
}

function topicId(anchor: NewsletterMentionRecord) {
  return `newsletter:${createHash("sha256")
    .update(`${anchor.firstSeenAt}\u0000${anchor.canonicalUrl}`)
    .digest("hex")
    .slice(0, 20)}`;
}

export function buildNewsletterTopics(
  mentions: NewsletterMentionRecord[],
  collectionScope: string,
): NewsletterTopic[] {
  mentions = mentions.map((mention) => ({
    ...mention,
    canonicalUrl: canonicalizeNewsletterUrl(mention.canonicalUrl) || mention.canonicalUrl,
  }));
  if (!mentions.length) return [];
  const parent = mentions.map((_mention, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };

  const byCanonical = new Map<string, number>();
  const tokenIndexes = new Map<string, number[]>();
  mentions.forEach((mention, index) => {
    const prior = byCanonical.get(mention.canonicalUrl);
    if (prior !== undefined) union(prior, index);
    else byCanonical.set(mention.canonicalUrl, index);

    const candidateCounts = new Map<number, number>();
    for (const token of titleTokens(mention.title)) {
      for (const candidate of tokenIndexes.get(token) || [])
        candidateCounts.set(candidate, (candidateCounts.get(candidate) || 0) + 1);
    }
    for (const [candidate, overlap] of candidateCounts) {
      if (overlap >= 3 && newsletterTitlesMatch(mention.title, mentions[candidate].title))
        union(candidate, index);
    }
    for (const token of titleTokens(mention.title)) {
      const bucket = tokenIndexes.get(token) || [];
      bucket.push(index);
      tokenIndexes.set(token, bucket);
    }
  });

  const groups = new Map<number, NewsletterMentionRecord[]>();
  mentions.forEach((mention, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) || []), mention]);
  });

  return [...groups.values()].map((group) => {
    const ordered = [...group].sort((left, right) =>
      Date.parse(right.receivedAt) - Date.parse(left.receivedAt));
    const anchor = [...group].sort((left, right) =>
      Date.parse(left.firstSeenAt) - Date.parse(right.firstSeenAt) ||
      left.canonicalUrl.localeCompare(right.canonicalUrl))[0];
    const primary = ordered.find((mention) => mention.title.split(/\s+/).length >= 4) || ordered[0];
    const priority = [...group].filter((mention) => typeof mention.importanceScore === "number" && Number.isFinite(mention.importanceScore))
      .sort((left, right) => right.importanceScore! - left.importanceScore! || left.id.localeCompare(right.id))[0];
    const newsletterSources = [...new Set(group.map((mention) => mention.newsletterSender))];
    const issueIds = new Set(group.map((mention) => mention.issueId));
    const sourceLinks: NewsletterSourceLink[] = [...new Map(group.map((mention) => [
      mention.canonicalUrl,
      {
        url: mention.canonicalUrl,
        title: mention.title,
        publisher: mention.publisher,
      },
    ])).values()];
    return newsletterPriority({
      id: topicId(anchor),
      kind: "newsletter-topic" as const,
      title: primary.title,
      summary: primary.context || `Reported by ${newsletterSources.join(", ")}.`,
      receivedAt: ordered[0].receivedAt,
      url: primary.canonicalUrl,
      gmailUrl: ordered[0].gmailUrl,
      coverageCount: issueIds.size,
      newsletterCount: newsletterSources.length,
      newsletterSources,
      evidenceIssueIds: [...issueIds],
      sourceLinks,
      collectionScope,
      ...(priority ? {
        importanceBaseScore: boundedPriority(priority.importanceScore),
        importanceScore: boundedPriority(priority.importanceScore),
        importanceReason: priority.importanceReason,
        curationMode: priority.curationMode,
      } : {}),
    });
  }).sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt));
}

export function mergeNewsletterTopics(
  topics: NewsletterTopic[],
  copy: { title?: string; summary?: string } = {},
): NewsletterTopic {
  const primary = topics.find((topic) => topic.workflow?.archiveReason === "user") || topics[0];
  const newsletterSources = [...new Set(topics.flatMap((topic) => topic.newsletterSources))];
  const evidenceIssueIds = [...new Set(topics.flatMap((topic) => topic.evidenceIssueIds || []))];
  const sourceLinks = [...new Map(topics.flatMap((topic) => topic.sourceLinks)
    .map((link) => [link.url, link])).values()];
  const latest = [...topics].sort((left, right) =>
    Date.parse(right.receivedAt) - Date.parse(left.receivedAt))[0];
  const priority = [...topics].filter((topic) => typeof topic.importanceBaseScore === "number" && Number.isFinite(topic.importanceBaseScore))
    .sort((left, right) => right.importanceBaseScore! - left.importanceBaseScore! || left.id.localeCompare(right.id))[0];
  return newsletterPriority({
    ...primary,
    title: copy.title || primary.title,
    summary: copy.summary || primary.summary,
    receivedAt: latest.receivedAt,
    gmailUrl: latest.gmailUrl,
    sourceLinks,
    newsletterSources,
    evidenceIssueIds,
    coverageCount: evidenceIssueIds.length || Math.max(...topics.map((topic) => topic.coverageCount)),
    newsletterCount: newsletterSources.length,
    ...(priority ? {
      importanceBaseScore: priority.importanceBaseScore,
      importanceReason: priority.importanceReason,
      curationMode: priority.curationMode,
    } : { importanceScore: undefined }),
  });
}

export function applyNewsletterAiGroups(
  value: unknown,
  topics: NewsletterTopic[],
  provider: AiKeyProvider,
) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !Array.isArray((value as { groups?: unknown }).groups))
    throw new Error("Newsletter AI did not return a topic groups list.");
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const used = new Set<string>();
  const merged: NewsletterTopic[] = [];
  for (const entry of (value as { groups: unknown[] }).groups) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const group = entry as { ids?: unknown; title?: unknown; summary?: unknown; score?: unknown; reason?: unknown };
    if (!Array.isArray(group.ids) || group.ids.length < 2 ||
        group.ids.some((id) => typeof id !== "string" || !byId.has(id) || used.has(id)) ||
        typeof group.title !== "string" || typeof group.summary !== "string" ||
        group.title.trim().length < 12 || group.summary.trim().length < 20 ||
        /https?:\/\//i.test(`${group.title} ${group.summary}`)) continue;
    const ids = [...new Set(group.ids as string[])];
    if (ids.length < 2) continue;
    const members = ids.map((id) => byId.get(id)!);
    if (new Set(members.map((topic) => topic.collectionScope)).size !== 1) continue;
    ids.forEach((id) => used.add(id));
    const topic = mergeNewsletterTopics(members, {
      title: group.title.trim().slice(0, 240),
      summary: group.summary.trim().slice(0, 700),
    });
    const hasPriority = typeof group.score === "number" && Number.isFinite(group.score) &&
      typeof group.reason === "string" && group.reason.trim().length >= 10;
    merged.push(newsletterPriority({
      ...topic,
      ...(hasPriority ? {
        importanceBaseScore: boundedPriority(group.score),
        importanceReason: (group.reason as string).trim().slice(0, 240),
        curationMode: provider,
      } : {}),
    }));
  }
  return [...merged, ...topics.filter((topic) => !used.has(topic.id))]
    .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt));
}

export function applyNewsletterAiPriorities(
  value: unknown,
  topics: NewsletterTopic[],
  provider: AiKeyProvider,
) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !Array.isArray((value as { priorities?: unknown }).priorities))
    throw new Error("Newsletter AI did not return a priority list.");
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const priorities = new Map<string, { score: number; reason: string }>();
  for (const entry of (value as { priorities: unknown[] }).priorities) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const item = entry as { id?: unknown; score?: unknown; reason?: unknown };
    if (typeof item.id !== "string" || !byId.has(item.id) || priorities.has(item.id) ||
        typeof item.score !== "number" || !Number.isFinite(item.score) ||
        typeof item.reason !== "string" || item.reason.trim().length < 10 ||
        /https?:\/\//i.test(item.reason)) continue;
    priorities.set(item.id, { score: boundedPriority(item.score), reason: item.reason.trim().slice(0, 240) });
  }
  if (topics.length && !priorities.size)
    throw new Error("Newsletter AI returned no valid priorities; built-in ranking was retained.");
  return topics.map((topic) => {
    const priority = priorities.get(topic.id);
    return priority ? newsletterPriority({
      ...topic,
      importanceBaseScore: priority.score,
      importanceReason: priority.reason,
      curationMode: provider,
    }) : newsletterPriority(topic);
  });
}

export function normalizeNewsletterResponse(payload: NewsletterFeedResponse): NewsletterFeedResponse {
  const normalize = (topic: NewsletterTopic): NewsletterTopic => newsletterPriority({
    ...topic,
    url: canonicalizeNewsletterUrl(topic.url) || topic.url,
    sourceLinks: [...new Map(topic.sourceLinks.map((link) => {
      const url = canonicalizeNewsletterUrl(link.url) || link.url;
      return [url, { ...link, url }] as const;
    })).values()],
  });
  const queued = payload.errors.find((error) => /^\d+ older matching newsletter issues remain queued/.test(error));
  return {
    ...payload,
    items: sortFeedStories(payload.items.map(normalize)),
    archivedItems: sortFeedStories(payload.archivedItems.map(normalize)),
    historyItems: payload.historyItems ? sortFeedStories(payload.historyItems.map(normalize)) : undefined,
    pendingIssueCount: payload.pendingIssueCount ?? (queued ? Number.parseInt(queued, 10) : 0),
    errors: payload.errors.filter((error) => error !== queued),
  };
}
