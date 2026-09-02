"use client";

/**
 * The settings surface: eight sections over one draft object and a single save.
 *
 * Kept apart from the dashboard views because it is the largest thing in the app
 * and shares almost nothing with them — it edits configuration, they read
 * collected results.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity, ArrowRight, ArrowUpRight, AtSign, Cable, Check,
  CheckCircle2, Copy, Eye, Facebook,
  Globe2, Instagram, KeyRound, LayoutDashboard,
  Linkedin, Mail, Music2, Network, Plus, Radio, RefreshCw, Settings2, ShieldCheck, Sparkles,
  Trash2, Users, X, Youtube,
} from "lucide-react";
import type {
  AudiencePlatform, PublicSettings, SettingsUpdate,
} from "@/lib/types";
import { } from "@/lib/ai-providers";
import { GOOGLE_OAUTH_CLIENT_ID_ERROR, isGoogleOAuthClientId } from "@/lib/google-oauth";
import { AiProviderSettings } from "@/components/ai-provider-settings";
import { SettingsInput } from "@/components/settings-input";
import { classNames, Label, Panel, PageHeading, profilePlaceholder, TagEditor } from "@/components/dashboard-primitives";

export type SettingsSection =
  | "general"
  | "industry"
  | "mentions"
  | "newsletters"
  | "audience"
  | "ai"
  | "dailyBrief"
  | "pipeline"
  | "integrations";

export type SettingsDraft = Omit<SettingsUpdate, "ai" | "industry" | "mentions"> & {
  industry: PublicSettings["industry"];
  mentions: PublicSettings["mentions"];
  ai: NonNullable<SettingsUpdate["ai"]> & {
    keySet: PublicSettings["ai"]["keySet"];
    keySource: PublicSettings["ai"]["keySource"];
  };
};

export function settingsDraft(settings: PublicSettings): SettingsDraft {
  return {
    ...settings,
    newsletters: { ...settings.newsletters, googleClientSecret: "" },
    audience: {
      accounts: settings.audience.accounts.map((account) => ({
        ...account,
        credential: "",
      })),
    },
    ai: { ...settings.ai, apiKeys: {}, clearKeys: [] },
  };
}

export function SettingsView({
  settings,
  onSaved,
}: {
  settings: PublicSettings;
  onSaved: (settings: PublicSettings) => void;
}) {
  const router = useRouter();
  const [section, setSection] = useState<SettingsSection>("general");
  const [draft, setDraft] = useState<SettingsDraft>(() =>
    settingsDraft(settings),
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [bridgePromptFallback, setBridgePromptFallback] = useState("");
  useEffect(() => {
    window.queueMicrotask(() => {
      const parameters = new URLSearchParams(window.location.search);
      const requested = parameters.get("section") as SettingsSection | null;
      if (
        requested &&
        [
          "general",
          "industry",
          "mentions",
          "newsletters",
          "audience",
          "ai",
          "dailyBrief",
          "integrations",
        ].includes(requested)
      )
        setSection(requested);
      const oauthError = parameters.get("error");
      if (oauthError === "oauth-config")
        setNotice(
          "Save a Google OAuth client ID and secret before choosing an account.",
        );
      if (oauthError === "oauth-client-id")
        setNotice(GOOGLE_OAUTH_CLIENT_ID_ERROR);
      if (oauthError === "oauth-state")
        setNotice(
          "The Google connection expired before it completed. Please try again.",
        );
      if (oauthError === "oauth-exchange")
        setNotice(
          "Google could not complete the connection. Check the OAuth client and redirect URI, then try again.",
        );
      if (parameters.get("connected") === "1")
        setNotice(
          "Saved. The newsletter Gmail account is connected read-only.",
        );
    });
  }, []);
  const save = async () => {
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "Could not save settings.");
      const saved = payload as PublicSettings;
      setDraft(settingsDraft(saved));
      onSaved(saved);
      setNotice("Saved. Live pages will use this configuration immediately.");
      return true;
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not save settings.",
      );
      return false;
    } finally {
      setSaving(false);
    }
  };
  const connectGmail = async () => {
    if (
      !draft.newsletters.googleClientId.trim() ||
      (!draft.newsletters.googleClientSecretSet &&
        !draft.newsletters.googleClientSecret?.trim())
    ) {
      setNotice("Add the Google OAuth client ID and secret first.");
      return;
    }
    if (!isGoogleOAuthClientId(draft.newsletters.googleClientId)) {
      setNotice(GOOGLE_OAUTH_CLIENT_ID_ERROR);
      return;
    }
    if (await save()) router.push("/api/auth/google/start");
  };
  const addSource = () =>
    setDraft((value) => ({
      ...value,
      industry: {
        ...value.industry,
        sources: [
          ...value.industry.sources,
          { id: crypto.randomUUID(), name: "", url: "" },
        ],
      },
    }));
  const addAccount = (platform: AudiencePlatform) =>
    setDraft((value) => ({
      ...value,
      audience: {
        accounts: [
          ...value.audience.accounts,
          {
            id: crypto.randomUUID(),
            platform,
            label: platform[0].toUpperCase() + platform.slice(1),
            username: "",
            profileUrl: "",
            accountId: "",
            credential: "",
            credentialSet: false,
          },
        ],
      },
    }));
  const changeSection = (nextSection: SettingsSection) => {
    setSection(nextSection);
    const url = new URL(window.location.href);
    url.searchParams.set("section", nextSection);
    window.history.replaceState({}, "", url);
  };
  const copyBridgePrompt = async () => {
    if (!draft.dailyBrief.sourceLabels.length) {
      setNotice(
        "Add at least one Daily Brief source before copying the bridge prompt.",
      );
      return;
    }
    const endpoint = `${window.location.origin}/api/brief`;
    const prompt = [
      "Create a read-only recurring Daily Brief sync for my local Control Center.",
      `Use only these installed connector sources: ${draft.dailyBrief.sourceLabels.join(", ")}.`,
      `Look back ${draft.dailyBrief.lookbackDays} days and return only actionable messages, meetings, deadlines, decisions, and genuinely useful context.`,
      "Minimize private content: concise titles and summaries only; never include credentials or full message bodies.",
      `POST the result to ${endpoint} as JSON: {\"sources\":[{\"source\":\"each configured source label\",\"status\":\"success|error\",\"error\":\"required only on error\"}],\"items\":[{\"id\":\"required stable provider ID\",\"source\":\"one successful source label\",\"title\":\"...\",\"summary\":\"...\",\"kind\":\"action|meeting|message|info\",\"occurredAt\":\"ISO date\",\"dueAt\":\"optional ISO date\",\"url\":\"optional source URL\"}]}.`,
      "Include every configured source in sources, even when a successful source has zero items. The items for each successful source must be its complete current set; missing prior items will be removed. Mark unreadable connectors as error and omit their items so the dashboard preserves the last successful set while showing the failure. Keep this operation read-only in every connected app.",
    ].join("\n");
    try {
      await navigator.clipboard.writeText(prompt);
      setBridgePromptFallback("");
      setNotice(
        "Saved to clipboard. Paste the bridge prompt into Codex to create the connector sync.",
      );
    } catch {
      setBridgePromptFallback(prompt);
      setNotice(
        "Clipboard access was blocked. Select the complete prompt shown below and copy it manually.",
      );
    }
  };
  const sections: Array<{
    id: SettingsSection;
    label: string;
    icon: typeof Activity;
  }> = [
    { id: "general", label: "General", icon: Settings2 },
    { id: "dailyBrief", label: "Daily brief", icon: LayoutDashboard },
    { id: "industry", label: "Industry", icon: Globe2 },
    { id: "mentions", label: "Mentions", icon: AtSign },
    { id: "newsletters", label: "Newsletters", icon: Mail },
    { id: "audience", label: "Audience", icon: Users },
    { id: "ai", label: "AI curation", icon: Sparkles },
    { id: "pipeline", label: "Pipeline", icon: Network },
    { id: "integrations", label: "Integrations", icon: Cable },
  ];
  return (
    <div className="view">
      <PageHeading
        eyebrow="Make it yours"
        title="Settings"
        description="A fresh install starts empty. Choose exactly what the dashboard reads and tracks."
        action={
          <button
            className="button button-primary"
            onClick={save}
            disabled={saving}
          >
            {saving ? (
              <RefreshCw className="spin" size={15} />
            ) : (
              <Check size={15} />
            )}{" "}
            Save settings
          </button>
        }
      />
      {notice && (
        <div
          className={classNames(
            "save-notice",
            notice.startsWith("Saved") && "success",
          )}
          role="status"
          aria-live="polite"
        >
          {notice}
        </div>
      )}
      <div className="settings-layout reveal delay-1">
        <aside className="settings-nav">
          {sections.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={section === item.id ? "active" : ""}
                onClick={() => changeSection(item.id)}
              >
                <Icon size={16} />
                <span>{item.label}</span>
                <ArrowRight size={14} />
              </button>
            );
          })}
          <div className="settings-security">
            <ShieldCheck size={18} />
            <b>Secrets stay server-side</b>
            <p>Saved credentials are never returned to the browser.</p>
          </div>
        </aside>
        <div className="settings-content" key={section}>
          {section === "dailyBrief" && (
            <Panel className="settings-panel">
              <div className="settings-title"><LayoutDashboard /><div>
                <p className="eyebrow">Your daily snapshot</p><h2>Choose what Today shows</h2>
                <p>Bring the highest-priority items from your other tabs into one quick brief. Each section uses saved results, not another source search.</p>
              </div></div>
              <div className="brief-settings-grid">
                {(["industry", "mentions", "newsletters"] as const).map((category) => (
                  <label className="brief-setting-card" key={category}>
                    <span>{category === "industry" ? <Radio /> : category === "mentions" ? <AtSign /> : <Mail />}</span>
                    <b>{category === "industry" ? "Industry" : category === "mentions" ? "Mentions" : "Newsletters"}</b>
                    <small>{category === "industry" ? "The most important industry developments." : category === "mentions" ? "The mentions most worth your attention." : "Top news from your newsletter reading queue."}</small>
                    <select aria-label={`${category} stories in daily brief`} value={draft.dailyBrief.sections[category]} onChange={(event) => setDraft((value) => ({...value, dailyBrief: {...value.dailyBrief, sections: {...value.dailyBrief.sections, [category]: Number(event.target.value)}}}))}>
                      <option value={0}>Don&apos;t include</option>
                      {[1,2,3,4,5,6,7,8,9,10].map((count) => <option key={count} value={count}>Top {count} {count === 1 ? "story" : "stories"}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <div className="settings-caveat"><Sparkles size={17} /><p>With a configured AI provider, AI priority and summaries flow into this brief automatically. Without one, saved local ranking is used. Archived stories are excluded, and a short queue is never padded with old news.</p></div>
              <div className="bridge-manual"><b>Want private messages and meetings too?</b><p>That is optional. <button type="button" className="text-button" onClick={() => changeSection("integrations")}>Open Integrations</button> to connect a local automation that can read your private apps. It is not needed for the three sections above.</p></div>
            </Panel>
          )}
          {section === "general" && (
            <Panel className="settings-panel">
              <div className="settings-title">
                <Settings2 />
                <div>
                  <p className="eyebrow">General</p>
                  <h2>Workspace identity</h2>
                  <p>
                    Use any name. No person or company is assumed by default.
                  </p>
                </div>
              </div>
              <div className="settings-field">
                <label>
                  Workspace name
                  <small>Shown in the header and browser title.</small>
                </label>
                <SettingsInput
                  value={draft.general.workspaceName}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      general: { workspaceName: event.target.value },
                    }))
                  }
                  placeholder="Control Center"
                />
              </div>
            </Panel>
          )}
          {section === "industry" && (
            <Panel className="settings-panel">
              <div className="settings-title">
                <Globe2 />
                <div>
                  <p className="eyebrow">Industry</p>
                  <h2>Sites and industry topics</h2>
                  <p>
                    Add any public homepage or feed. RSS, Atom, and RDF are
                    tried first; when none is available, the collector records a
                    recursive sitemap baseline and reports new pages.
                  </p>
                </div>
              </div>
              <div className="settings-field">
                <label>
                  What matters in this industry?
                  <small>
                    A short niche description helps distinguish consequential
                    updates from adjacent noise. It is used locally and by your
                    selected AI provider, when enabled.
                  </small>
                </label>
                <textarea
                  value={draft.industry.description}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      industry: {
                        ...value.industry,
                        description: event.target.value,
                      },
                    }))
                  }
                  placeholder="e.g. Commercial robotics, warehouse automation, major product launches, research breakthroughs, funding, and regulation"
                />
              </div>
              <div className="settings-field">
                <label>
                  Daily reading target
                  <small>
                    Discovery remains broad, but only this many high-value
                    updates can appear in the current queue.
                  </small>
                </label>
                <select
                  value={draft.industry.dailyLimit}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      industry: {
                        ...value.industry,
                        dailyLimit: Number(event.target.value),
                      },
                    }))
                  }
                >
                  <option value={20}>20 updates</option>
                  <option value={25}>25 updates</option>
                  <option value={30}>30 updates</option>
                  <option value={40}>40 updates</option>
                  <option value={50}>50 updates</option>
                </select>
              </div>
              <div className="source-editor">
                <div className="source-editor-head">
                  <b>Tracked sources</b>
                  <button type="button" onClick={addSource}>
                    <Plus size={14} /> Add source
                  </button>
                </div>
                {draft.industry.sources.map((source) => (
                  <div className="source-edit-row" key={source.id}>
                    <SettingsInput
                      aria-label="Source name"
                      value={source.name}
                      onChange={(event) =>
                        setDraft((value) => ({
                          ...value,
                          industry: {
                            ...value.industry,
                            sources: value.industry.sources.map((item) =>
                              item.id === source.id
                                ? { ...item, name: event.target.value }
                                : item,
                            ),
                          },
                        }))
                      }
                      placeholder="Source name"
                    />
                    <SettingsInput
                      aria-label="Source URL"
                      value={source.url}
                      onChange={(event) =>
                        setDraft((value) => ({
                          ...value,
                          industry: {
                            ...value.industry,
                            sources: value.industry.sources.map((item) =>
                              item.id === source.id
                                ? { ...item, url: event.target.value }
                                : item,
                            ),
                          },
                        }))
                      }
                      placeholder="https://example.com"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((value) => ({
                          ...value,
                          industry: {
                            ...value.industry,
                            sources: value.industry.sources.filter(
                              (item) => item.id !== source.id,
                            ),
                          },
                        }))
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
                {!draft.industry.sources.length && (
                  <div className="editor-empty">No industry sources yet.</div>
                )}
              </div>
              <TagEditor
                label="Industry topics"
                help="These phrases discover wider current news and act as must-track relevance signals. Watched sites still receive priority, but low-value pages stay in discovery history instead of flooding the reading queue."
                values={draft.industry.keywords}
                onChange={(keywords) =>
                  setDraft((value) => ({
                    ...value,
                    industry: { ...value.industry, keywords },
                  }))
                }
                placeholder="e.g. sustainable packaging"
              />
              <TagEditor
                label="Exclude topics"
                help="Filter recurring noise that is not useful for this niche, such as jobs, sports scores, coupon pages, or unrelated uses of a shared term."
                values={draft.industry.excludedTerms}
                onChange={(excludedTerms) =>
                  setDraft((value) => ({
                    ...value,
                    industry: { ...value.industry, excludedTerms },
                  }))
                }
                placeholder="e.g. job listings"
              />
              <div className="settings-caveat">
                <Radio size={17} />
                <p>
                  Blocked homepages do not stop feed or sitemap discovery. A
                  site that exposes no readable feed or sitemap will show an
                  explicit source error instead of a false success.
                </p>
              </div>
            </Panel>
          )}
          {section === "mentions" && (
            <Panel className="settings-panel">
              <div className="settings-title">
                <AtSign />
                <div>
                  <p className="eyebrow">Mentions</p>
                  <h2>Identity, not loose keywords</h2>
                  <p>
                    Each identity is searched exactly across the past seven
                    days. Direct evidence is high confidence; thinner provider
                    matches are separated into review. Keep up to 12 names,
                    handles, and official websites combined so every source
                    check stays fast and reliable on a laptop.
                  </p>
                </div>
              </div>
              <TagEditor
                label="Names, brands, and unique handles"
                help="Add complete names, brand phrases, and handles. The words inside a phrase are never searched separately; this list shares a 12-identity limit with official websites."
                values={draft.mentions.terms}
                onChange={(terms) =>
                  setDraft((value) => ({
                    ...value,
                    mentions: { ...value.mentions, terms },
                  }))
                }
                placeholder="e.g. Acme Labs"
              />
              <TagEditor
                label="Official websites"
                help="Add official domains. Exact domain matches count as strong identity evidence and improve deduplication; this list shares a 12-identity limit with names and handles."
                values={draft.mentions.websites}
                onChange={(websites) =>
                  setDraft((value) => ({
                    ...value,
                    mentions: { ...value.mentions, websites },
                  }))
                }
                placeholder="e.g. acme.example"
              />
              <TagEditor
                label="Identity anchors"
                help="Add specific roles, locations, products, collaborators, or signature topics that distinguish namesakes."
                values={draft.mentions.identityAnchors}
                onChange={(identityAnchors) =>
                  setDraft((value) => ({
                    ...value,
                    mentions: { ...value.mentions, identityAnchors },
                  }))
                }
                placeholder="e.g. robotics founder"
              />
              <TagEditor
                label="Exclude namesakes and false contexts"
                help="Add words tied to recurring false positives: another person's employer, sport, location, profession, product, or an unrelated meaning of the brand phrase."
                values={draft.mentions.negativeTerms}
                onChange={(negativeTerms) =>
                  setDraft((value) => ({
                    ...value,
                    mentions: { ...value.mentions, negativeTerms },
                  }))
                }
                placeholder="e.g. professional golfer"
              />
              <label className="toggle-row">
                <SettingsInput
                  type="checkbox"
                  checked={draft.mentions.strictMode}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      mentions: {
                        ...value.mentions,
                        strictMode: event.target.checked,
                      },
                    }))
                  }
                />
                <span>
                  <b>Identity-aware filtering</b>
                  <small>
                    Reject uncorroborated namesakes while retaining contextual
                    matches for review.
                  </small>
                </span>
              </label>
              <label className="toggle-row">
                <SettingsInput
                  type="checkbox"
                  checked={draft.mentions.excludeOwnedSites}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      mentions: {
                        ...value.mentions,
                        excludeOwnedSites: event.target.checked,
                      },
                    }))
                  }
                />
                <span>
                  <b>Exclude your own websites</b>
                  <small>
                    Official domains strengthen identity verification but do
                    not count as third-party mentions.
                  </small>
                </span>
              </label>
              <div className="settings-caveat">
                <ShieldCheck size={17} />
                <p>
                  Archived results keep their canonical local identity and do
                  not return on later scans. Add precise anchors whenever a
                  brand phrase is also common language.
                </p>
              </div>
            </Panel>
          )}
          {section === "newsletters" && (
            <Panel className="settings-panel">
              <div className="settings-title">
                <Mail />
                <div>
                  <p className="eyebrow">Newsletters</p>
                  <h2>Dedicated Gmail connection</h2>
                  <p>
                    Connect any Google account, including one created only for
                    newsletter subscriptions. Gmail access stays read-only.
                    Newsletter intelligence also needs a cloud or local model
                    configured in AI curation. Issue text goes only to that selected provider.
                  </p>
                </div>
              </div>
              {draft.newsletters.connected ? (
                <div className="connection-card connected">
                  <CheckCircle2 />
                  <div>
                    <b>{draft.newsletters.connectedEmail}</b>
                    <p>Connected with Gmail read-only access.</p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await fetch("/api/settings?connection=gmail", {
                        method: "DELETE",
                      });
                      const response = await fetch("/api/settings");
                      const saved = (await response.json()) as PublicSettings;
                      setDraft(settingsDraft(saved));
                      onSaved(saved);
                    }}
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <div className="connection-card">
                  <Mail />
                  <div>
                    <b>No newsletter mailbox connected</b>
                    <p>
                      Create a dedicated Gmail if you want one, then save OAuth
                      credentials and connect it here.
                    </p>
                  </div>
                  <a
                    className="button button-ghost"
                    href="https://accounts.google.com/signup"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Create Gmail <ArrowUpRight size={14} />
                  </a>
                </div>
              )}
              <div className="credential-grid">
                <div className="settings-field">
                  <label>
                    Google OAuth client ID
                    <small>
                      From a Google Cloud “Web application” OAuth client.
                    </small>
                  </label>
                  <SettingsInput
                    aria-label="Google OAuth client ID"
                    autoCapitalize="none"
                    autoComplete="off"
                    name="google-oauth-client-id"
                    spellCheck={false}
                    value={draft.newsletters.googleClientId}
                    onChange={(event) =>
                      setDraft((value) => ({
                        ...value,
                        newsletters: {
                          ...value.newsletters,
                          googleClientId: event.target.value,
                        },
                      }))
                    }
                    placeholder="…apps.googleusercontent.com"
                  />
                </div>
                <div className="settings-field">
                  <label>
                    Google OAuth client secret
                    <small>
                      {draft.newsletters.googleClientSecretSet
                        ? "A secret is already saved. Leave blank to keep it."
                        : "Stored only in the local server data directory."}
                    </small>
                  </label>
                  <SettingsInput
                    aria-label="Google OAuth client secret"
                    autoComplete="new-password"
                    name="google-oauth-client-secret"
                    type="password"
                    value={draft.newsletters.googleClientSecret || ""}
                    onChange={(event) =>
                      setDraft((value) => ({
                        ...value,
                        newsletters: {
                          ...value.newsletters,
                          googleClientSecret: event.target.value,
                        },
                      }))
                    }
                    placeholder={
                      draft.newsletters.googleClientSecretSet
                        ? "Saved ••••••••"
                        : "Client secret"
                    }
                  />
                </div>
              </div>
              <div className="settings-field">
                <label>
                  Gmail search query
                  <small>
                    Choose which messages count as newsletters using Gmail
                    search syntax. The default watches recent Updates and
                    Promotions.
                  </small>
                </label>
                <SettingsInput
                  value={draft.newsletters.gmailQuery}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      newsletters: {
                        ...value.newsletters,
                        gmailQuery: event.target.value,
                      },
                    }))
                  }
                  placeholder="newer_than:30d (category:updates OR category:promotions)"
                />
              </div>
              <div className="oauth-actions">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void connectGmail()}
                  disabled={saving}
                >
                  <KeyRound size={15} />{" "}
                  {saving ? "Saving…" : "Save & choose Gmail account"}
                </button>
                <p>
                  Authorized redirect URI:{" "}
                  <code>
                    {typeof window === "undefined"
                      ? "/api/auth/google/callback"
                      : `${window.location.origin}/api/auth/google/callback`}
                  </code>
                </p>
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Google OAuth credentials <ArrowUpRight size={13} />
                </a>
              </div>
            </Panel>
          )}
          {section === "audience" && (
            <Panel className="settings-panel">
              <div className="settings-title">
                <Users />
                <div>
                  <p className="eyebrow">Audience</p>
                  <h2>Public social profiles</h2>
                  <p>
                    Paste the exact profile or company-page URL for any account.
                    Public checks are keyless; supported official credentials
                    remain optional fallbacks.
                  </p>
                </div>
              </div>
              <div className="provider-buttons">
                <button type="button" onClick={() => addAccount("youtube")}>
                  <Youtube /> YouTube
                </button>
                <button type="button" onClick={() => addAccount("x")}>
                  <X /> X
                </button>
                <button type="button" onClick={() => addAccount("instagram")}>
                  <Instagram /> Instagram
                </button>
                <button type="button" onClick={() => addAccount("facebook")}>
                  <Facebook /> Facebook
                </button>
                <button type="button" onClick={() => addAccount("linkedin")}>
                  <Linkedin /> LinkedIn
                </button>
                <button type="button" onClick={() => addAccount("threads")}>
                  <AtSign /> Threads
                </button>
                <button type="button" onClick={() => addAccount("tiktok")}>
                  <Music2 /> TikTok
                </button>
              </div>
              <div className="account-editor">
                {draft.audience.accounts.map((account) => (
                  <div className="account-card" key={account.id}>
                    <div className="account-card-head">
                      <Label>{account.platform}</Label>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((value) => ({
                            ...value,
                            audience: {
                              accounts: value.audience.accounts.filter(
                                (item) => item.id !== account.id,
                              ),
                            },
                          }))
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <div className="credential-grid">
                      <div className="settings-field">
                        <label>
                          Label
                          <small>
                            How this account appears in the dashboard.
                          </small>
                        </label>
                        <SettingsInput
                          value={account.label}
                          onChange={(event) =>
                            setDraft((value) => ({
                              ...value,
                              audience: {
                                accounts: value.audience.accounts.map((item) =>
                                  item.id === account.id
                                    ? { ...item, label: event.target.value }
                                    : item,
                                ),
                              },
                            }))
                          }
                        />
                      </div>
                      <div className="settings-field">
                        <label>
                          Username or handle
                          <small>
                            Used when a full profile URL is not supplied.
                          </small>
                        </label>
                        <SettingsInput
                          value={account.username}
                          onChange={(event) =>
                            setDraft((value) => ({
                              ...value,
                              audience: {
                                accounts: value.audience.accounts.map((item) =>
                                  item.id === account.id
                                    ? { ...item, username: event.target.value }
                                    : item,
                                ),
                              },
                            }))
                          }
                          placeholder="without the @ symbol"
                        />
                      </div>
                      <div className="settings-field profile-url-field">
                        <label>
                          Public profile URL
                          <small>
                            Must be a profile on the selected platform. Emails
                            and post URLs are rejected.
                          </small>
                        </label>
                        <SettingsInput
                          type="url"
                          fieldKey={`audience-${account.id}-profile-url`}
                          aria-label={`${account.label || account.platform} public profile URL`}
                          value={account.profileUrl || ""}
                          onChange={(event) =>
                            setDraft((value) => ({
                              ...value,
                              audience: {
                                accounts: value.audience.accounts.map((item) =>
                                  item.id === account.id
                                    ? {
                                        ...item,
                                        profileUrl: event.target.value,
                                      }
                                    : item,
                                ),
                              },
                            }))
                          }
                          placeholder={profilePlaceholder(account.platform)}
                        />
                      </div>
                    </div>
                    {["youtube", "x", "instagram", "facebook"].includes(
                      account.platform,
                    ) && (
                      <details className="advanced-credentials">
                        <summary>
                          <KeyRound size={13} /> Optional official API fallback
                        </summary>
                        <p>
                          Only used if the public profile does not expose a
                          readable count.
                        </p>
                        <div className="credential-grid">
                          {(account.platform === "instagram" ||
                            account.platform === "facebook") && (
                            <div className="settings-field">
                              <label>
                                Account or page ID
                                <small>
                                  Only needed for the Meta API fallback.
                                </small>
                              </label>
                              <SettingsInput
                                value={account.accountId}
                                onChange={(event) =>
                                  setDraft((value) => ({
                                    ...value,
                                    audience: {
                                      accounts: value.audience.accounts.map(
                                        (item) =>
                                          item.id === account.id
                                            ? {
                                                ...item,
                                                accountId: event.target.value,
                                              }
                                            : item,
                                      ),
                                    },
                                  }))
                                }
                              />
                            </div>
                          )}
                          <div className="settings-field">
                            <label>
                              {account.platform === "youtube"
                                ? "YouTube Data API key"
                                : account.platform === "x"
                                  ? "X bearer token"
                                  : "Meta access token"}
                              <small>
                                {account.credentialSet
                                  ? "Credential saved. You can remove it below."
                                  : "Optional; stored server-side and excluded from Git."}
                              </small>
                            </label>
                            <SettingsInput
                              type="password"
                              value={account.credential || ""}
                              onChange={(event) =>
                                setDraft((value) => ({
                                  ...value,
                                  audience: {
                                    accounts: value.audience.accounts.map(
                                      (item) =>
                                        item.id === account.id
                                          ? {
                                              ...item,
                                              credential: event.target.value,
                                              clearCredential: false,
                                            }
                                          : item,
                                    ),
                                  },
                                }))
                              }
                              placeholder={
                                account.credentialSet
                                  ? "Saved ••••••••"
                                  : "Optional provider credential"
                              }
                            />
                          </div>
                        </div>
                        {account.credentialSet && (
                          <button
                            className="text-button danger"
                            type="button"
                            onClick={() =>
                              setDraft((value) => ({
                                ...value,
                                audience: {
                                  accounts: value.audience.accounts.map(
                                    (item) =>
                                      item.id === account.id
                                        ? {
                                            ...item,
                                            credential: "",
                                            credentialSet: false,
                                            clearCredential: true,
                                          }
                                        : item,
                                  ),
                                },
                              }))
                            }
                          >
                            <Trash2 size={13} /> Remove saved credential
                          </button>
                        )}
                      </details>
                    )}
                  </div>
                ))}
                {!draft.audience.accounts.length && (
                  <div className="editor-empty">
                    No audience accounts yet. Choose a platform above.
                  </div>
                )}
              </div>
              <div className="settings-caveat">
                <Eye size={17} />
                <p>
                  Public metadata is provider-controlled. Each metric is tied to
                  the canonical account URL, failures preserve only that
                  account&apos;s last verified value, and temporary blocks never
                  become a false zero.
                </p>
              </div>
            </Panel>
          )}
          {section === "ai" && (
            <Panel className="settings-panel"><AiProviderSettings
              value={draft.ai}
              onChange={(ai) => setDraft((value) => ({ ...value, ai }))}
            /></Panel>
          )}
          {section === "pipeline" && (
            <>
              <div className="settings-title">
                <Network />
                <div>
                  <p className="eyebrow">Publication pipeline</p>
                  <h2>Watch a pipeline</h2>
                  <p>
                    A read-only view of a publication pipeline running on this machine: its
                    editions, publication checks, per-source health, and model-route usage. The
                    pipeline keeps its own schedule; nothing here starts, stops, or edits it.
                  </p>
                </div>
              </div>
              <div className="settings-field">
                <label htmlFor="cc-pipeline-root">
                  Pipeline directory
                  <small>
                    The full path to the checkout, for example
                    /Users/you/Documents/GitHub/signalscribe-desk. Reads stay inside this
                    directory; a link pointing out of it is refused rather than followed.
                  </small>
                </label>
                <SettingsInput
                  id="cc-pipeline-root"
                  fieldKey="pipeline-root"
                  type="text"
                  value={draft.pipeline?.root || ""}
                  placeholder="/absolute/path/to/pipeline"
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      pipeline: { ...value.pipeline, root: event.target.value },
                    }))
                  }
                />
              </div>
              <div className="settings-field">
                <label htmlFor="cc-pipeline-url">
                  Published site <span className="optional">Optional</span>
                  <small>
                    Where the finished editions are served. Used only to link out from the
                    editions list.
                  </small>
                </label>
                <SettingsInput
                  id="cc-pipeline-url"
                  fieldKey="pipeline-public-url"
                  type="url"
                  value={draft.pipeline?.publicUrl || ""}
                  placeholder="https://example.com"
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      pipeline: { ...value.pipeline, publicUrl: event.target.value },
                    }))
                  }
                />
              </div>
              <div className="settings-caveat">
                <ShieldCheck size={17} />
                <p>
                  Artifacts are read from disk and never written. The dashboard does not run the
                  pipeline, publish anything, or change its watchlist: editing sources stays with
                  the pipeline&apos;s own format-preserving writer, so its commit trail remains the
                  record of what changed.
                </p>
              </div>
            </>
          )}
          {section === "integrations" && (
            <Panel className="settings-panel">
              <div className="settings-title">
                <Cable />
                <div>
                  <p className="eyebrow">Optional · advanced setup</p>
                  <h2>Bring private context into Today</h2>
                  <p>
                    Use this only if you want Today to include private messages, meetings, or to-dos from apps such as Slack, Gmail, Granola, or Calendar. Industry, Mentions, Audience, and newsletter collection do not need this page.
                  </p>
                </div>
              </div>
              <div className="integration-explainer">
                <h3>How it works</h3>
                <ol>
                  <li><b>Choose the apps below.</b> These names are labels for incoming summaries, not logins or API keys. Adding a name does not connect the app.</li>
                  <li><b>Save settings, then copy the setup prompt.</b> Paste it into Codex (with the relevant plugins installed), or use your own local script.</li>
                  <li><b>Authorize that automation.</b> It reads only the apps you approve and sends a short summary to this running Control Center. The Today page shows when each source last synced.</li>
                </ol>
                <p>No private integrations? Leave this section empty. Your cross-tab daily snapshot still works.</p>
              </div>
              <TagEditor
                label="Apps to receive summaries from"
                help="Add one name at a time, such as Slack or Google Calendar. The copied setup prompt uses these names to match summaries to the right app."
                values={draft.dailyBrief.sourceLabels}
                onChange={(sourceLabels) =>
                  setDraft((value) => ({
                    ...value,
                    dailyBrief: { ...value.dailyBrief, sourceLabels },
                  }))
                }
                placeholder="e.g. Slack"
              />
              <div className="settings-field">
                <label>
                  Keep private context for
                  <small>
                    The maximum recent sync history available locally. Today
                    and Week apply their own narrower display windows.
                  </small>
                </label>
                <select
                  value={draft.dailyBrief.lookbackDays}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      dailyBrief: {
                        ...value.dailyBrief,
                        lookbackDays: Number(event.target.value),
                      },
                    }))
                  }
                >
                  <option value={1}>1 day</option>
                  <option value={3}>3 days</option>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                </select>
              </div>
              <div className="bridge-card">
                <div>
                  <p className="eyebrow">Step 2 · after saving</p>
                  <h3>Set up the reader in Codex</h3>
                  <p>
                    The prompt tells Codex to use only the source labels above,
                    minimize private content, stay read-only, report each
                    source&apos;s health, and post stable items to this computer.
                  </p>
                </div>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void copyBridgePrompt()}
                >
                  <Copy size={15} /> Copy setup prompt
                </button>
                <code>
                  {typeof window === "undefined"
                    ? "/api/brief"
                    : `${window.location.origin}/api/brief`}
                </code>
                {bridgePromptFallback && (
                  <label className="bridge-prompt-fallback">
                    Complete prompt
                    <textarea
                      readOnly
                      value={bridgePromptFallback}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  </label>
                )}
              </div>
              <div className="bridge-manual">
                <b>Script or local automation</b>
                <p>
                  Send the same JSON contract with{" "}
                  <code>
                    npm run ingest -- --file=/absolute/path/items.json
                  </code>
                  . Stable item IDs prevent duplicates on later runs; source
                  reports record empty checks and connector failures.
                </p>
              </div>
              <div className="settings-caveat">
                <ShieldCheck size={17} />
                <p>
                  Control Center never reaches into Codex or a private provider
                  by itself. A user-approved local automation reads those
                  sources and sends only the minimized overview. This keeps a
                  GitHub install portable without shipping anyone&apos;s account
                  access.
                </p>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
