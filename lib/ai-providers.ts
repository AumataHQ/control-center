import type { AiKeyProvider, AiModelOption, AiProvider, LocalAiProvider, PublicSettings } from "./types";

export const AI_KEY_PROVIDERS: AiKeyProvider[] = ["openai", "anthropic", "gemini", "xai", "gateway", "lmstudio", "ollama"];
export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  none: "Off — built-in ranking only",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  xai: "xAI · Grok",
  gateway: "Private model gateway",
  lmstudio: "LM Studio · local",
  ollama: "Ollama · local",
};
export const DEFAULT_AI_MODELS: Record<AiKeyProvider, string> = {
  openai: "gpt-5-mini",
  anthropic: "claude-sonnet-4-20250514",
  gemini: "gemini-3.7-flash",
  xai: "grok-4.6",
  // Gateway model ids are operator-defined role aliases, so there is no
  // meaningful built-in default. The first route the gateway lists is used.
  gateway: "",
  lmstudio: "",
  ollama: "",
};
export const DEFAULT_LOCAL_AI_URLS: Record<LocalAiProvider, string> = {
  lmstudio: "http://127.0.0.1:1234",
  ollama: "http://127.0.0.1:11434",
};
export const DEFAULT_GATEWAY_URL = "";

export function isAiKeyProvider(value: unknown): value is AiKeyProvider {
  return typeof value === "string" && AI_KEY_PROVIDERS.includes(value as AiKeyProvider);
}

export function isLocalAiProvider(provider: AiProvider): provider is LocalAiProvider {
  return provider === "lmstudio" || provider === "ollama";
}

export function isGatewayAiProvider(provider: AiProvider): provider is "gateway" {
  return provider === "gateway";
}

// The gateway exposes plain chat completions. Its upstream routes may carry
// their own server-side tool contracts, but this dashboard never drives them,
// so built-in web research is not offered here.
export function aiSupportsWebSearch(provider: AiProvider) {
  return provider !== "none" && !isLocalAiProvider(provider) && !isGatewayAiProvider(provider);
}

export function aiEnvironmentKey(provider: AiKeyProvider, environment: Record<string, string | undefined>) {
  return ({
    openai: environment.OPENAI_API_KEY,
    anthropic: environment.ANTHROPIC_API_KEY,
    gemini: environment.GEMINI_API_KEY || environment.GOOGLE_API_KEY,
    xai: environment.XAI_API_KEY,
    // Matches the gateway client's own resolution order so one operator
    // environment can serve both this dashboard and the publication pipeline.
    gateway: environment.SS_HERMES_API_KEY || environment.SS_LLM_API_KEY,
    lmstudio: environment.LM_STUDIO_API_KEY || environment.LM_API_TOKEN,
    ollama: environment.OLLAMA_LOCAL_API_KEY,
  }[provider] || "").trim();
}

export function aiEnvironmentGatewayUrl(environment: Record<string, string | undefined>) {
  return (environment.SS_HERMES_BASE || environment.SS_LLM_BASE || "").trim();
}

// A local selection is configured without a cloud API key. Availability is
// checked against the running server before every inference, not fabricated here.
export function isAiReady(ai: Pick<PublicSettings["ai"], "provider" | "keySet">) {
  return ai.provider !== "none" && (isLocalAiProvider(ai.provider) || Boolean(ai.keySet[ai.provider]));
}

export function isValidAiModelId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._:/+\-]{0,199}$/i.test(value) && !value.includes("://");
}

export function cleanAiModelOverride(value: unknown) {
  if (value === "" || value === undefined || value === "default") return "";
  if (typeof value !== "string" || !isValidAiModelId(value.trim()))
    throw new Error("Choose a model from the model dropdown. Email addresses and URLs are not model IDs.");
  return value.trim();
}

export function localAiBaseUrl(provider: LocalAiProvider, input?: string) {
  const raw = input?.trim() || DEFAULT_LOCAL_AI_URLS[provider];
  let url: URL;
  try { url = new URL(raw); } catch {
    throw new Error("Enter a local server address such as http://127.0.0.1:1234.");
  }
  if (!["http:", "https:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase()) ||
      url.username || url.password || url.search || url.hash ||
      !["/", "", "/v1", "/v1/", "/api", "/api/"].includes(url.pathname)) {
    throw new Error("Local AI servers must use localhost, 127.0.0.1, or [::1], with no credentials, query, or custom path. Remote endpoints are not supported.");
  }
  // Pin localhost to a numeric loopback address; never resolve a configurable hostname.
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.origin;
}

function ipv4Parts(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4) return undefined;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return octets.every((value) => Number.isInteger(value) && value >= 0 && value <= 255) ? octets : undefined;
}

/**
 * Literal addresses are restricted to networks an operator can actually own:
 * loopback, RFC1918, RFC6598 carrier-grade NAT (the range Tailscale assigns),
 * and IPv6 unique-local. Link-local is refused because it reaches cloud
 * instance-metadata endpoints, and every public address is refused outright.
 */
export function isPrivateGatewayHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") return true;
  const octets = ipv4Parts(host);
  if (octets) {
    const [a, b] = octets;
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (host.includes(":")) return /^f[cd][0-9a-f]{2}:/.test(host);
  return undefined;
}

/**
 * Validates a private OpenAI-compatible gateway endpoint and normalizes it to
 * an `/v1` base, matching the convention the publication pipeline already uses.
 *
 * Unlike a local model server this is deliberately allowed to be off-box: the
 * gateway runs on the operator's own network. Literal addresses are constrained
 * to private ranges; a hostname cannot be classified without resolving it, so
 * hostnames are accepted as an explicit operator trust decision and the request
 * itself still refuses redirects and caps the response size.
 */
export function gatewayBaseUrl(input?: string) {
  const raw = input?.trim();
  if (!raw) throw new Error("Enter the address of your private model gateway, such as http://100.64.0.1:8643/v1.");
  let url: URL;
  try { url = new URL(raw); } catch {
    throw new Error("Enter a full gateway address including http:// or https://.");
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("The model gateway must use http:// or https://.");
  if (url.username || url.password || url.search || url.hash)
    throw new Error("Enter the gateway address only, with no credentials, query, or fragment.");
  if (!["", "/", "/v1", "/v1/"].includes(url.pathname))
    throw new Error("The gateway address must end at the server root or /v1.");
  if (isPrivateGatewayHost(url.hostname) === false)
    throw new Error("The model gateway must be on a private network — loopback, 10.x, 172.16–31.x, 192.168.x, 100.64–127.x, or an IPv6 unique-local address.");
  return `${url.origin}/v1`;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : [];
}

function actualContextLength(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function isRemoteAiModel(value: unknown) {
  const model = record(value);
  const name = String(model.name || model.id || model.model || model.key || "");
  return /(?:^|[:/\-])cloud(?:$|[:/\-])/i.test(name) ||
    Boolean(model.remote_host || model.remote_model || model.remoteHost || model.remoteModel || model.remote || model.is_remote) ||
    ["cloud", "remote"].includes(String(model.source || model.location || "").toLowerCase());
}

function textModelName(id: string) {
  return !/(?:^|[-_/:])(?:embedding|embeddings|embed|rerank|moderation|tts|whisper|transcribe|transcription|audio|realtime|image|imagine|vision-preview|video|sora|dall-e|dalle)(?:$|[-_/:\d])/i.test(id);
}

export function normalizeAiModels(provider: AiKeyProvider, payload: unknown): AiModelOption[] {
  const body = record(payload);
  const entries = rows(body.models ?? body.data);
  const options = entries.flatMap((model): AiModelOption[] => {
    const rawId = model.id ?? model.name ?? model.model ?? model.key;
    const id = typeof rawId === "string" ? rawId.replace(/^models\//, "") : "";
    if (!isValidAiModelId(id) || !textModelName(id)) return [];
    let label = String(model.display_name || model.displayName || id).slice(0, 200);
    if (provider === "openai") {
      if (!/^(?:gpt-(?:[3-9]|[1-9]\d)|o\d|chatgpt-|ft:(?:gpt-|o\d))/i.test(id)) return [];
      // Specialized search/agent and legacy Completions-only models do not use
      // the ordinary text-curation request shape supported by this app.
      if (/(?:^|[-_:])(?:search|deep-research|computer-use|instruct)(?:$|[-_:])/i.test(id)) return [];
    }
    if (provider === "anthropic" && !id.startsWith("claude-")) return [];
    if (provider === "gemini" && (!Array.isArray(model.supportedGenerationMethods) || !model.supportedGenerationMethods.includes("generateContent"))) return [];
    if (provider === "xai" && Array.isArray(model.output_modalities) && !model.output_modalities.includes("text")) return [];
    if (isLocalAiProvider(provider)) {
      if (isRemoteAiModel(model)) return [];
      if (provider === "lmstudio") {
        if (!["llm", "vlm"].includes(String(model.type))) return [];
        const instances = rows(model.loaded_instances);
        if (instances.length) {
          return instances.flatMap((instance) => {
            const instanceId = instance.id;
            if (!isValidAiModelId(instanceId) || isRemoteAiModel(instance)) return [];
            const contextLength = actualContextLength(record(instance.config).context_length);
            return [{ id: instanceId, label: `${label}${instanceId !== id ? ` · ${instanceId}` : ""}`, contextLength }];
          });
        }
        if (model.state !== "loaded") return [];
      } else {
        // /api/ps proves loaded state; /api/show proves text capability and
        // supplies remote_host/remote_model fields for cloud aliases.
        const details = record(model.details);
        if (details.format !== "gguf" || !Array.isArray(model.capabilities) || !model.capabilities.includes("completion")) return [];
      }
      label = `${label} · loaded`;
    }
    return [{ id, label, ...(provider === "ollama" ? { contextLength: actualContextLength(model.context_length) } : {}) }];
  });
  return [...new Map(options.map((model) => [model.id, model])).values()]
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

export function defaultAiModel(provider: AiKeyProvider, models: AiModelOption[]) {
  if (isLocalAiProvider(provider)) {
    // Prefer usable reported capacity when multiple models are already loaded.
    // Never load another model or increase the user's allocation automatically.
    return [...models].sort((left, right) => (right.contextLength || 0) - (left.contextLength || 0))[0]?.id || "";
  }
  const recommended = DEFAULT_AI_MODELS[provider];
  return models.find((model) => model.id === recommended)?.id || models[0]?.id || recommended;
}
