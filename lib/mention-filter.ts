import { createHash } from "node:crypto";

import type { LiveStory } from "@/lib/types";
import { SEARCH_TRACKING_PARAMETERS, trackingParameterMatcher } from "./tracking-parameters";

export const DEFAULT_MENTION_WINDOW_DAYS = 7;
export const DEFAULT_FUTURE_TOLERANCE_HOURS = 24;
export const MENTION_COLLECTION_VERSION = "mentions-v7";

export type MentionQueryOptions = {
  identitySignals?: string[];
  identityAnchors?: string[];
  nicheContexts?: string[];
  strictMode?: boolean;
  windowDays?: number;
};

export type MentionQueryPlan = {
  query: string;
  queryContexts: string[];
};

export type MentionEvidence = {
  canonicalUrl?: string;
  publisher?: string;
  pageText?: string;
  queryMatched?: boolean;
  queryContexts?: string[];
  nicheContexts?: string[];
  negativeTerms?: string[];
};

export type MentionEvaluation = {
  accepted: boolean;
  confidence: "high" | "medium";
  review: boolean;
  score: number;
  reasons: string[];
};

export type MentionFreshnessEvidence = {
  publishedAt?: string | null;
  firstDiscoveredAt?: string | null;
  canonicalPageVerified: boolean;
};

type MentionStoryAliasInput = Pick<LiveStory, "title" | "url" | "source" | "publishedAt"> & {
  canonicalUrl?: string;
  publisher?: string;
};

type MentionIdentityInput = MentionStoryAliasInput & Pick<LiveStory, "id">;

function domainFrom(value: string) {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function looksLikeDomain(value: string) {
  const candidate = value.trim().replace(/^@/, "");
  return candidate.includes(".") && !candidate.includes(" ");
}

export function normalizeSignal(value: string) {
  const candidate = looksLikeDomain(value) ? domainFrom(value) : value;
  return candidate
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/^@/, "")
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function containsMentionSignal(text: string, signal: string) {
  const normalizedText = normalizeSignal(text).replace(/\./g, " ").replace(/\s+/g, " ");
  const normalizedSignal = normalizeSignal(signal).replace(/\./g, " ").replace(/\s+/g, " ");
  if (!normalizedSignal) return false;
  return ` ${normalizedText} `.includes(` ${normalizedSignal} `);
}

function explicitHandleValue(value: string) {
  const raw = value.trim();
  if (!raw.startsWith("@")) return "";
  const candidate = raw.slice(1).normalize("NFKC").toLocaleLowerCase();
  return candidate && !candidate.includes(" ") ? candidate : "";
}

function escapedPattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsExplicitHandle(text: string, signal: string) {
  const handle = explicitHandleValue(signal);
  if (!handle) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}_])@${escapedPattern(handle)}(?=$|[^\\p{L}\\p{N}_])`, "iu")
    .test(text.normalize("NFKC"));
}

function containsObservedHandle(text: string, signal: string) {
  const raw = signal.trim();
  const candidate = raw.replace(/^@/, "").normalize("NFKC").toLocaleLowerCase();
  if (
    !candidate ||
    candidate.includes(" ") ||
    looksLikeDomain(raw) ||
    (!raw.startsWith("@") && raw !== raw.toLocaleLowerCase())
  ) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}_])@${escapedPattern(candidate)}(?=$|[^\\p{L}\\p{N}_])`, "iu")
    .test(text.normalize("NFKC"));
}

function containsIdentitySignal(text: string, signal: string) {
  return signal.trim().startsWith("@")
    ? containsExplicitHandle(text, signal)
    : containsMentionSignal(text, signal);
}

function containsConfiguredIdentitySpelling(text: string, signal: string) {
  const raw = signal.trim().normalize("NFKC");
  if (!raw) return false;
  if (raw.startsWith("@")) return containsExplicitHandle(text, raw);
  if (looksLikeDomain(raw)) return containsMentionSignal(text, raw);
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapedPattern(raw)}(?=$|[^\\p{L}\\p{N}])`, "u")
    .test(text.normalize("NFKC"));
}

export function isUniqueIdentitySignal(value: string) {
  const raw = value.trim();
  const normalized = normalizeSignal(raw);
  if (!normalized) return false;
  return raw.startsWith("@") || looksLikeDomain(raw);
}

function localIdentityContext(text: string, signal: string, radius = 900) {
  const needle = signal.trim().toLocaleLowerCase();
  if (!needle || !text) return "";
  const haystack = text.toLocaleLowerCase();
  const windows: string[] = [];
  let offset = 0;
  while (windows.length < 5) {
    const index = haystack.indexOf(needle, offset);
    if (index < 0) break;
    windows.push(text.slice(Math.max(0, index - radius), Math.min(text.length, index + needle.length + radius)));
    offset = index + needle.length;
  }
  return windows.join(" ");
}

function queryValue(value: string) {
  const candidate = value.trim();
  if (candidate.startsWith("@")) return candidate;
  return looksLikeDomain(candidate) ? domainFrom(candidate) : candidate;
}

function quotedQueryValue(value: string) {
  return `"${queryValue(value).replaceAll('"', "").trim()}"`;
}

function uniqueSignals(values: string[], primary: string) {
  const primaryKey = normalizeSignal(primary);
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const key = normalizeSignal(value);
    if (!key || key === primaryKey || seen.has(key)) return [];
    seen.add(key);
    return [value];
  });
}

function normalizedWindowDays(value: number | undefined) {
  if (!Number.isFinite(value)) return DEFAULT_MENTION_WINDOW_DAYS;
  return Math.min(30, Math.max(1, Math.round(value as number)));
}

/**
 * Builds discovery-first searches. The exact-only query prevents configured
 * context from becoming a hard discovery gate; the focused variants improve
 * precision without replacing that wider pass.
 */
export function buildMentionQueryPlans(primary: string, options: MentionQueryOptions = {}): MentionQueryPlan[] {
  const exactPrimary = quotedQueryValue(primary);
  if (exactPrimary === '""') return [];
  const window = `when:${normalizedWindowDays(options.windowDays)}d`;
  const plans: MentionQueryPlan[] = [{ query: `${exactPrimary} ${window}`, queryContexts: [] }];
  const identitySignals = uniqueSignals(options.identitySignals ?? [], primary).slice(0, 8);
  const contexts = uniqueSignals([
    ...(options.identityAnchors ?? []),
    ...(options.nicheContexts ?? []),
  ], primary).slice(0, 8);

  if (identitySignals.length) {
    plans.push({
      query: `${exactPrimary} (${identitySignals.map(quotedQueryValue).join(" OR ")}) ${window}`,
      queryContexts: identitySignals,
    });
  }
  if (contexts.length) {
    plans.push({
      query: `${exactPrimary} (${contexts.map(quotedQueryValue).join(" OR ")}) ${window}`,
      queryContexts: contexts,
    });
  }
  const merged = new Map<string, MentionQueryPlan>();
  for (const plan of plans) {
    const existing = merged.get(plan.query);
    merged.set(plan.query, {
      query: plan.query,
      queryContexts: [...new Set([...(existing?.queryContexts ?? []), ...plan.queryContexts])],
    });
  }
  return [...merged.values()];
}

export function buildMentionQueries(primary: string, options: MentionQueryOptions = {}) {
  return buildMentionQueryPlans(primary, options).map(({ query }) => query);
}

/** Backward-compatible single-query entry point used by the current route. */
export function buildMentionQuery(primary: string, signals: string[], strictMode: boolean) {
  return buildMentionQueries(primary, { identitySignals: signals, strictMode })[0] ?? "";
}

const isTrackingParameter = trackingParameterMatcher(SEARCH_TRACKING_PARAMETERS);

function isBingHost(hostname: string) {
  return hostname === "bing.com" || hostname.endsWith(".bing.com");
}

function canonicalizeUrl(value: string, depth: number): string {
  if (!value.trim() || depth > 3) return "";
  let url: URL;
  try {
    url = new URL(value.trim().replaceAll("&amp;", "&"));
  } catch {
    return "";
  }

  if (isBingHost(url.hostname) && /\/news\/apiclick\.aspx$/i.test(url.pathname)) {
    const publisherUrl = url.searchParams.get("url");
    if (publisherUrl) return canonicalizeUrl(publisherUrl, depth + 1);
  }

  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (isTrackingParameter(key)) url.searchParams.delete(key);
  }
  const parameters = [...url.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  url.search = "";
  for (const [key, parameterValue] of parameters) url.searchParams.append(key, parameterValue);
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function canonicalizeMentionUrl(value: string) {
  return canonicalizeUrl(value, 0);
}

function publisherKey(value: string) {
  const normalized = normalizeSignal(value)
    .replace(/^www\./, "")
    .replace(/\.(?:com|net|org|co|io|ai|news)$/i, "");
  return normalized.replace(/[\s.-]+/g, "");
}

function normalizedTitle(title: string, publisher: string) {
  let candidate = title.trim();
  const suffix = candidate.match(/\s+(?:[-–—|])\s+([^|–—]+)$/)?.[1]?.trim();
  if (suffix && publisherKey(suffix) === publisherKey(publisher)) {
    candidate = candidate.slice(0, candidate.length - suffix.length).replace(/\s+(?:[-–—|])\s*$/, "");
  }
  return normalizeSignal(candidate).replace(/[\s.]+/g, "");
}

function publishedDay(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : "";
}

function canonicalUrlIdentity(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const canonicalHost = hostname.replace(/^www\./, "");
    return `${canonicalHost}${url.port ? `:${url.port}` : ""}${url.pathname}${url.search}`;
  } catch {
    return "";
  }
}

export function isMentionProviderWrapper(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "news.google.com" || hostname === "bing.com" || hostname.endsWith(".bing.com");
  } catch {
    return false;
  }
}

/**
 * Conservative cross-provider alias used only when at least one side still has
 * a search-provider wrapper URL. Publisher URLs remain distinct even when two
 * stories share a headline on the same day.
 */
export function mentionStoryAlias(item: MentionStoryAliasInput) {
  const canonicalUrl = canonicalizeMentionUrl(item.canonicalUrl || item.url);
  let canonicalHost = "";
  try {
    canonicalHost = new URL(canonicalUrl).hostname;
  } catch {
    canonicalHost = "";
  }
  const publisher = item.publisher || (item.source !== "Google News" && item.source !== "Bing News" ? item.source : canonicalHost);
  const publisherIdentity = publisherKey(publisher || canonicalHost);
  const title = normalizedTitle(item.title, publisher);
  const day = publishedDay(item.publishedAt);
  if (!publisherIdentity || !title || !day) return "";
  return createHash("sha256")
    .update(`story:${publisherIdentity}:${title}:${day}`)
    .digest("hex")
    .slice(0, 24);
}

/** Stable across provider wrappers and tracking parameters for the same story. */
export function mentionIdentity(item: MentionIdentityInput) {
  const canonicalUrl = canonicalizeMentionUrl(item.canonicalUrl || item.url);
  const canonicalIdentity = canonicalUrlIdentity(canonicalUrl);
  let canonicalHost = "";
  try {
    canonicalHost = new URL(canonicalUrl).hostname;
  } catch {
    canonicalHost = "";
  }
  const publisher = item.publisher || (item.source !== "Google News" && item.source !== "Bing News" ? item.source : canonicalHost);
  const title = normalizedTitle(item.title, publisher);
  const day = publishedDay(item.publishedAt);
  const material = canonicalIdentity
    ? `url:${canonicalIdentity}`
    : title
      ? `story:${publisherKey(publisher || canonicalHost)}:${title}:${day || "undated"}`
      : `wrapper:${canonicalUrl || item.id}`;
  return createHash("sha256").update(material).digest("hex").slice(0, 24);
}

export function isWithinMentionWindow(
  publishedAt: string,
  options: { now?: number | string | Date; windowDays?: number; futureToleranceHours?: number } = {},
) {
  const timestamp = Date.parse(publishedAt);
  const now = options.now instanceof Date
    ? options.now.getTime()
    : typeof options.now === "string"
      ? Date.parse(options.now)
      : options.now ?? Date.now();
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) return false;
  const windowDays = normalizedWindowDays(options.windowDays);
  const futureToleranceHours = Number.isFinite(options.futureToleranceHours)
    ? Math.max(0, options.futureToleranceHours as number)
    : DEFAULT_FUTURE_TOLERANCE_HOURS;
  return timestamp >= now - windowDays * 86_400_000 && timestamp <= now + futureToleranceHours * 3_600_000;
}

/**
 * Uses a real publication timestamp whenever one is present. Only genuinely
 * undated, canonically page-verified mentions may fall back to first discovery,
 * so a stale or malformed publisher date cannot be made fresh by rediscovery.
 */
export function isFreshMentionEvidence(
  evidence: MentionFreshnessEvidence,
  options: { now?: number | string | Date; windowDays?: number; futureToleranceHours?: number } = {},
) {
  const publishedAt = evidence.publishedAt?.trim() || "";
  if (publishedAt) return isWithinMentionWindow(publishedAt, options);
  if (!evidence.canonicalPageVerified) return false;
  return isWithinMentionWindow(evidence.firstDiscoveredAt?.trim() || "", options);
}

export function evaluateMention(
  item: LiveStory,
  primary: string,
  identitySignals: string[],
  identityAnchors: string[],
  strictMode: boolean,
  evidence: MentionEvidence = {},
): MentionEvaluation {
  const canonicalUrl = evidence.canonicalUrl || canonicalizeMentionUrl(item.url);
  const feedText = `${item.title} ${item.summary}`;
  const pageText = evidence.pageText || "";
  const publisherText = `${evidence.publisher || item.source} ${canonicalUrl}`;
  const directText = `${feedText} ${pageText} ${publisherText}`;
  const pageIdentityContext = localIdentityContext(pageText, primary);
  const corroborationText = `${feedText} ${pageIdentityContext} ${publisherText}`;
  const primaryInFeed = containsIdentitySignal(feedText, primary);
  const primaryInPage = containsIdentitySignal(pageText, primary);
  const primaryInPublisher = containsIdentitySignal(publisherText, primary);
  const primaryDirect = primaryInFeed || primaryInPage || primaryInPublisher;
  const literalHandleEvidence = containsExplicitHandle(directText, primary) ||
    containsObservedHandle(directText, primary);
  const negativeContextText = `${feedText} ${pageIdentityContext} ${publisherText}`;
  const matchedNegative = (evidence.negativeTerms ?? []).find((term) => containsMentionSignal(negativeContextText, term));
  if (matchedNegative) {
    return { accepted: false, confidence: "medium", review: false, score: 0, reasons: [`Excluded context: ${matchedNegative}`] };
  }
  if (!primaryDirect) {
    return {
      accepted: false,
      confidence: "medium",
      review: false,
      score: 0,
      reasons: ["Rejected: the result contained no literal identity evidence."],
    };
  }

  const matchedSignals = identitySignals.filter((signal) => containsIdentitySignal(corroborationText, signal));
  const otherSignals = matchedSignals.filter((signal) => normalizeSignal(signal) !== normalizeSignal(primary));
  const matchedAnchors = identityAnchors.filter((signal) => containsMentionSignal(corroborationText, signal));
  const matchedNiche = (evidence.nicheContexts ?? []).filter((signal) => containsMentionSignal(corroborationText, signal));
  const matchedPageAnchors = identityAnchors.filter((signal) => containsMentionSignal(pageIdentityContext, signal));
  const primaryIsUnique = isUniqueIdentitySignal(primary);
  const strongCorroborator = otherSignals.some(isUniqueIdentitySignal);
  const pageVerified = primaryInPage || primaryInPublisher;
  const directPageIdentityContext = primaryInPage &&
    containsConfiguredIdentitySpelling(pageText, primary) &&
    matchedPageAnchors.length > 0;

  let score = primaryDirect ? 45 : 25;
  if (pageVerified) score += 15;
  if (primaryIsUnique || literalHandleEvidence) score += 25;
  if (strongCorroborator) score += 25;
  else if (otherSignals.length) score += 15;
  score += Math.min(20, matchedAnchors.length * 10);
  score += Math.min(20, matchedNiche.length * 10);
  score = Math.min(100, score);

  const highConfidence = primaryDirect && (
    primaryIsUnique || literalHandleEvidence || strongCorroborator || otherSignals.length > 0 || matchedAnchors.length >= 2 || directPageIdentityContext
  );
  const reviewCandidate = !highConfidence && !strictMode;
  const accepted = highConfidence || reviewCandidate;
  const reasons = [
    `Content match: ${primary}`,
    ...otherSignals.slice(0, 3).map((signal) => `Identity signal: ${signal}`),
    ...matchedAnchors.slice(0, 3).map((signal) => `Identity context: ${signal}`),
    ...matchedNiche.slice(0, 3).map((signal) => `Niche context: ${signal}`),
    ...(directPageIdentityContext ? ["Verified on the canonical page with configured identity context"] : []),
  ];
  if (!accepted && strictMode) reasons.push("Rejected: an ambiguous identity lacked corroboration.");
  return {
    accepted,
    confidence: highConfidence ? "high" : "medium",
    review: accepted && !highConfidence,
    score,
    reasons,
  };
}
