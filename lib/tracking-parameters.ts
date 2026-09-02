/**
 * Query parameters that identify a click rather than a page.
 *
 * Three channels canonicalize URLs — industry discoveries, brand mentions, and
 * newsletter links — and each needs its own additions: a mention arrives through
 * a search-engine wrapper, a newsletter link through an email service provider.
 * The canonicalizers themselves stay separate, because they differ in ways that
 * matter (only mention preserves `www.`, and its identity matching depends on
 * that). What drifts if left alone is this list, so only this is shared.
 */
export const SHARED_TRACKING_PARAMETERS = [
  "dclid",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "msclkid",
] as const;

/** Search and syndication wrappers seen on industry and mention results. */
export const SEARCH_TRACKING_PARAMETERS = [
  "campaign",
  "campaign_id",
  "ceid",
  "gl",
  "hl",
  "oc",
  "ref",
  "referrer",
  "source",
] as const;

/** Email service provider click identifiers. */
export const EMAIL_TRACKING_PARAMETERS = [
  "_bhlid",
  "_hsenc",
  "_hsmi",
  "mkt_tok",
  "ref_src",
  "s",
  "vero_conv",
  "vero_id",
] as const;

/**
 * Build a matcher for one channel. Every `utm_*` parameter is always removed;
 * `extra` adds the wrappers that channel actually encounters.
 */
export function trackingParameterMatcher(extra: readonly string[] = []) {
  const names = new Set<string>([...SHARED_TRACKING_PARAMETERS, ...extra].map((name) => name.toLowerCase()));
  return (key: string) => {
    const name = key.toLowerCase();
    return name.startsWith("utm_") || names.has(name);
  };
}
