import "server-only";

import { createHash } from "node:crypto";
import type { AiKeyProvider, AiModelsResponse } from "@/lib/types";
import { aiEnvironmentGatewayUrl, defaultAiModel, gatewayBaseUrl, isGatewayAiProvider, isLocalAiProvider, localAiBaseUrl } from "@/lib/ai-providers";
import { fetchAiModels } from "@/lib/ai-model-discovery";
import { configuredAiApiKey, type StoredSettings } from "@/lib/server/settings";

type DiscoveryOptions = { provider?: AiKeyProvider; apiKey?: string; baseUrl?: string; refresh?: boolean; useSavedKey?: boolean };
const modelCache = new Map<string, { expiresAt: number; payload: AiModelsResponse }>();
const pending = new Map<string, Promise<AiModelsResponse>>();

export async function discoverAiModels(settings: StoredSettings, options: DiscoveryOptions = {}): Promise<AiModelsResponse> {
  const provider = options.provider || settings.ai.provider;
  if (provider === "none") return {
    provider, models: [], defaultModel: "", checkedAt: new Date().toISOString(), cached: false, localOnly: false,
  };
  const local = isLocalAiProvider(provider);
  const baseUrl = local
    ? localAiBaseUrl(provider, options.baseUrl ?? settings.ai.localBaseUrls[provider])
    : isGatewayAiProvider(provider)
      ? gatewayBaseUrl(options.baseUrl ?? settings.ai.gatewayBaseUrl ?? aiEnvironmentGatewayUrl(process.env))
      : undefined;
  // The selected provider can only use its own saved/environment key. A draft
  // key is never persisted by model discovery and never appears in its response.
  const apiKey = options.apiKey?.trim() || (options.useSavedKey === false ? "" : configuredAiApiKey(settings, provider));
  if (apiKey.length > 2_000 || /[\r\n]/.test(apiKey)) throw new Error("Paste only the provider API key or local server token.");
  const identity = createHash("sha256").update(JSON.stringify([provider, baseUrl, apiKey])).digest("hex");
  const saved = modelCache.get(identity);
  if (!options.refresh && saved && saved.expiresAt > Date.now()) return { ...saved.payload, cached: true };
  const existing = pending.get(identity);
  if (existing) return existing;
  const operation = (async () => {
    const models = await fetchAiModels({ provider, apiKey, baseUrl });
    const payload: AiModelsResponse = {
      provider,
      models,
      defaultModel: defaultAiModel(provider, models),
      checkedAt: new Date().toISOString(),
      cached: false,
      localOnly: local,
    };
    // Empty/local lists have short lifetimes so loading a model is quickly
    // reflected. Failures are never cached; Reload models always retries.
    modelCache.set(identity, { expiresAt: Date.now() + (local ? 15_000 : 300_000), payload });
    if (modelCache.size > 50) modelCache.delete(modelCache.keys().next().value!);
    return payload;
  })();
  pending.set(identity, operation);
  try { return await operation; } finally { pending.delete(identity); }
}
