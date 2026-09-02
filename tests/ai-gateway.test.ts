import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import type { StoredSettings } from "../lib/server/settings";
import {
  AI_KEY_PROVIDERS,
  DEFAULT_LOCAL_AI_URLS,
  aiEnvironmentGatewayUrl,
  aiEnvironmentKey,
  aiSupportsWebSearch,
  gatewayBaseUrl,
  isGatewayAiProvider,
  isLocalAiProvider,
  isPrivateGatewayHost,
  normalizeAiModels,
} from "../lib/ai-providers";

// Next handles this compile-time boundary marker itself. Stub only the marker
// for Node-side adapter tests, not any provider or settings implementation.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "data:text/javascript,export {};") return { format: "commonjs", source: "module.exports = {};", shortCircuit: true };
    return nextLoad(url, context);
  },
});

function gatewaySettings(model = "", baseUrl = "http://100.64.0.1:8643/v1"): StoredSettings {
  return {
    general: { workspaceName: "Test workspace" },
    industry: { sources: [], keywords: [], description: "", excludedTerms: [], dailyLimit: 30 },
    mentions: { terms: [], websites: [], identityAnchors: [], negativeTerms: [], strictMode: true, excludeOwnedSites: true },
    newsletters: { googleClientId: "", googleClientSecret: "", connectedEmail: "", refreshToken: "", accessToken: "", accessTokenExpiresAt: 0, gmailQuery: "" },
    audience: { accounts: [] },
    ai: {
      provider: "gateway",
      model,
      apiKeys: { openai: "", anthropic: "", gemini: "", xai: "", gateway: "gateway-test-key", lmstudio: "", ollama: "" },
      localBaseUrls: { ...DEFAULT_LOCAL_AI_URLS },
      gatewayBaseUrl: baseUrl,
    },
    dailyBrief: { sourceLabels: [], lookbackDays: 7, sections: { industry: 5, mentions: 5, newsletters: 5 } },
    pipeline: { root: "", publicUrl: "" },
  };
}

async function withFetch<T>(fetcher: typeof fetch, run: () => Promise<T>) {
  const original = globalThis.fetch;
  globalThis.fetch = fetcher;
  try { return await run(); } finally { globalThis.fetch = original; }
}

test("the gateway is a first-class provider that is neither local nor web-search capable", () => {
  assert.ok(AI_KEY_PROVIDERS.includes("gateway"));
  assert.equal(isGatewayAiProvider("gateway"), true);
  assert.equal(isLocalAiProvider("gateway"), false);
  // Gateway routes carry their own server-side tool contracts that this
  // dashboard never drives, so it must not claim live web research.
  assert.equal(aiSupportsWebSearch("gateway"), false);
});

test("gateway credentials and address come from the pipeline's own environment names", () => {
  assert.equal(aiEnvironmentKey("gateway", { SS_LLM_API_KEY: " k1 " }), "k1");
  assert.equal(aiEnvironmentKey("gateway", { SS_HERMES_API_KEY: "k2", SS_LLM_API_KEY: "k1" }), "k2");
  assert.equal(aiEnvironmentKey("gateway", {}), "");
  // A provider key must never satisfy the gateway, or vice versa.
  assert.equal(aiEnvironmentKey("gateway", { OPENAI_API_KEY: "sk-live" }), "");
  assert.equal(aiEnvironmentKey("openai", { SS_LLM_API_KEY: "gateway-only" }), "");
  assert.equal(aiEnvironmentGatewayUrl({ SS_LLM_BASE: "http://10.0.0.4:8643/v1" }), "http://10.0.0.4:8643/v1");
  assert.equal(aiEnvironmentGatewayUrl({ SS_HERMES_BASE: "http://a", SS_LLM_BASE: "http://b" }), "http://a");
});

test("private networks are accepted and public or metadata addresses are refused", () => {
  for (const host of ["127.0.0.1", "localhost", "10.1.2.3", "172.16.0.1", "172.31.255.254", "192.168.1.9", "100.64.0.1", "100.127.3.4", "::1", "fd7a:115c:a1e0::1"])
    assert.equal(isPrivateGatewayHost(host), true, host);
  for (const host of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "100.63.255.255", "100.128.0.1", "169.254.169.254", "fe80::1"])
    assert.equal(isPrivateGatewayHost(host), false, host);
  // A hostname cannot be classified without resolving it; that is an explicit
  // operator trust decision rather than a silent accept-or-reject.
  assert.equal(isPrivateGatewayHost("truenas.tailnet.ts.net"), undefined);
});

test("the gateway address is normalized to a /v1 base and rejects unsafe forms", () => {
  assert.equal(gatewayBaseUrl("http://100.64.0.1:8643"), "http://100.64.0.1:8643/v1");
  assert.equal(gatewayBaseUrl("http://100.64.0.1:8643/"), "http://100.64.0.1:8643/v1");
  assert.equal(gatewayBaseUrl("http://100.64.0.1:8643/v1"), "http://100.64.0.1:8643/v1");
  assert.equal(gatewayBaseUrl(" http://100.64.0.1:8643/v1/ "), "http://100.64.0.1:8643/v1");
  assert.equal(gatewayBaseUrl("http://truenas.tailnet.ts.net:8643/v1"), "http://truenas.tailnet.ts.net:8643/v1");
  for (const bad of [
    undefined,
    "",
    "not a url",
    "ftp://10.0.0.1/v1",
    "file:///etc/passwd",
    "http://8.8.8.8:8643/v1",
    "http://169.254.169.254/v1",
    "http://user:pass@10.0.0.1:8643/v1",
    "http://10.0.0.1:8643/v1?key=leak",
    "http://10.0.0.1:8643/v1#fragment",
    "http://10.0.0.1:8643/admin",
  ])
    assert.throws(() => gatewayBaseUrl(bad), `expected rejection for ${String(bad)}`);
});

test("gateway route aliases survive model normalization", () => {
  const models = normalizeAiModels("gateway", {
    data: [
      { id: "signalscribe-reporter" },
      { id: "signalscribe-x-search" },
      { id: "signalscribe-extract" },
      { id: "text-embedding-3-large" },
    ],
  });
  assert.deepEqual(models.map((model) => model.id), [
    "signalscribe-extract",
    "signalscribe-reporter",
    "signalscribe-x-search",
  ]);
});

test("a gateway run posts OpenAI-compatible chat completions to the private base", async () => {
  const { runConfiguredAi } = await import("../lib/server/ai");
  const result = await withFetch((async (url, init) => {
    assert.equal(String(url), "http://100.64.0.1:8643/v1/chat/completions");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer gateway-test-key");
    const body = JSON.parse(String(init?.body));
    // The route alias is sent verbatim; the dashboard never names a vendor model.
    assert.equal(body.model, "signalscribe-reporter");
    assert.equal(body.stream, false);
    assert.deepEqual(body.messages, [{ role: "user", content: "Rank these." }]);
    return new Response(JSON.stringify({ choices: [{ message: { content: "ranked" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch, () => runConfiguredAi(gatewaySettings("signalscribe-reporter"), { prompt: "Rank these." }));
  assert.deepEqual(result, { provider: "gateway", model: "signalscribe-reporter", text: "ranked" });
});

test("an expired upstream session is refused instead of becoming curated content", async () => {
  const { runConfiguredAi } = await import("../lib/server/ai");
  // A gateway fronting subscription sessions can answer HTTP 200 with the
  // provider's error prose in the completion body. That must never be treated
  // as a summary, a ranking, or a story.
  await assert.rejects(
    () => withFetch((async () => new Response(
      JSON.stringify({ choices: [{ message: { content: "Provider authentication failed: reauthorize the session." } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch, () => runConfiguredAi(gatewaySettings("signalscribe-reporter"), { prompt: "Rank these." })),
    /upstream authentication failure/i,
  );
});

test("the gateway cannot be asked for live web research", async () => {
  const { runConfiguredAi } = await import("../lib/server/ai");
  await assert.rejects(
    () => runConfiguredAi(gatewaySettings("signalscribe-research"), { prompt: "Find mentions.", webSearch: true }),
    /does not provide live web research/i,
  );
});

test("truncated model output is closed without inventing values", async () => {
  const { repairTruncatedJson } = await import("../lib/server/ai");
  // Cut mid-string.
  assert.deepEqual(repairTruncatedJson('{"stories":[{"title":"Anthropic ships'), { stories: [{ title: "Anthropic ships" }] });
  // Cut after a complete element.
  assert.deepEqual(repairTruncatedJson('{"a":[1,2,3],"b":{"c":true}'), { a: [1, 2, 3], b: { c: true } });
  // Cut mid-key or before a value: the incomplete entry is dropped, not guessed.
  assert.deepEqual(repairTruncatedJson('{"a":1,"b'), { a: 1 });
  assert.deepEqual(repairTruncatedJson('{"a":1,"b":'), { a: 1 });
  // Trailing prose after a complete document.
  assert.deepEqual(repairTruncatedJson('{"a":1} Hope that helps!'), { a: 1 });
  // Escapes are respected rather than treated as string terminators.
  assert.deepEqual(repairTruncatedJson('{"q":"she said \\"hi'), { q: 'she said "hi' });
  // Genuinely malformed input stays a failure.
  assert.equal(repairTruncatedJson("no json here"), undefined);
  assert.equal(repairTruncatedJson('{"a":]'), undefined);
});
