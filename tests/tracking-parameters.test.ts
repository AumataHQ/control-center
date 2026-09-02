import assert from "node:assert/strict";
import test from "node:test";

import {
  EMAIL_TRACKING_PARAMETERS,
  SEARCH_TRACKING_PARAMETERS,
  SHARED_TRACKING_PARAMETERS,
  trackingParameterMatcher,
} from "@/lib/tracking-parameters";
import { canonicalizeIndustryUrl } from "@/lib/industry-curation";
import { canonicalizeMentionUrl } from "@/lib/mention-filter";
import { canonicalizeNewsletterUrl } from "@/lib/newsletter-intelligence";

test("every utm parameter is removed regardless of channel", () => {
  const matches = trackingParameterMatcher();
  for (const key of ["utm_source", "utm_medium", "UTM_CAMPAIGN", "utm_anything_new"])
    assert.equal(matches(key), true, key);
});

test("the shared core is matched case-insensitively and nothing else is", () => {
  const matches = trackingParameterMatcher();
  for (const key of SHARED_TRACKING_PARAMETERS) {
    assert.equal(matches(key), true, key);
    assert.equal(matches(key.toUpperCase()), true, key);
  }
  // Real page state must survive, or canonicalization collapses distinct pages.
  for (const key of ["id", "page", "q", "v", "post", "utmost"])
    assert.equal(matches(key), false, key);
});

test("channels add only the wrappers they actually encounter", () => {
  const search = trackingParameterMatcher(SEARCH_TRACKING_PARAMETERS);
  const email = trackingParameterMatcher(EMAIL_TRACKING_PARAMETERS);
  assert.equal(search("ceid"), true);
  assert.equal(email("ceid"), false);
  assert.equal(email("mkt_tok"), true);
  assert.equal(search("mkt_tok"), false);
});

test("every channel strips the shared click identifiers", () => {
  // These are the parameters that drifted apart when each channel kept its own
  // list: a newsletter link carrying an ad click id used to canonicalize as a
  // different story from the same article arriving anywhere else.
  const url = "https://example.com/a?fbclid=1&gclid=2&dclid=3&msclkid=4&mc_cid=5&mc_eid=6";
  assert.equal(canonicalizeIndustryUrl(url), "https://example.com/a");
  assert.equal(canonicalizeMentionUrl(url), "https://example.com/a");
  assert.equal(canonicalizeNewsletterUrl(url), "https://example.com/a");
});

test("channel-specific behaviour is unchanged", () => {
  // Only mention preserves www., because its identity matching depends on the
  // host it actually verified.
  assert.equal(canonicalizeMentionUrl("https://www.example.com:443/a/b/?keep=1"), "https://www.example.com/a/b?keep=1");
  assert.equal(canonicalizeIndustryUrl("https://www.example.com:443/a/b/?keep=1"), "https://example.com/a/b?keep=1");
  // Google News wrappers are search-side; an email link keeps them.
  assert.equal(canonicalizeMentionUrl("https://example.com/a?ceid=z&keep=1"), "https://example.com/a?keep=1");
  assert.equal(canonicalizeNewsletterUrl("https://example.com/a?ceid=z&keep=1"), "https://example.com/a?ceid=z&keep=1");
  // Twitter's s= is an email-side wrapper; industry and mention keep it.
  assert.equal(canonicalizeNewsletterUrl("https://example.com/a?s=1&keep=2"), "https://example.com/a?keep=2");
  assert.equal(canonicalizeIndustryUrl("https://example.com/a?s=1&keep=2"), "https://example.com/a?keep=2&s=1");
});
