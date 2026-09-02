"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { } from "next/navigation";
import {
  Activity,
  Archive,
  ArchiveRestore,
  ArrowRight,
  ArrowUpRight,
  AtSign,
  Bookmark,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  ExternalLink,
  Globe2,
  Inbox,
  LayoutDashboard,
  Link2,
  ListTodo,
  Crosshair,
  Library,
  Mail,
  Menu,
  MessageSquare,
  Moon,
  Newspaper,
  Network,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Users,
  X,
  } from "lucide-react";
import type {
  AudienceMetric,
  NewsroomSnapshot,
  PipelineSnapshot,
  AudiencePlatform,
  DailyBriefItem,
  DailyBriefResponse,
  LiveFeedResponse,
  LiveStory,
  NewsletterFeedResponse,
  PublicSettings,
  ReminderItem,
  TaskItem,
  WorkspaceState,
  WorkspaceStateResponse,
} from "@/lib/types";
import {
  } from "@/lib/google-oauth";
import { isDailyBriefItemInWindow } from "@/lib/brief-window";
import {
  AUDIENCE_COMPARISON_WINDOW_LABEL,
  audienceComparisonLabel,
} from "@/lib/audience-growth";
import { } from "@/components/settings-input";
import { } from "@/components/ai-provider-settings";
import { DailySnapshot } from "@/components/daily-snapshot";
import { AudienceInsights } from "@/components/audience-insights";
import { PipelineView } from "@/components/pipeline-view";
import { NewsroomView } from "@/components/newsroom-view";
import { BeatsView, type BeatsSnapshot } from "@/components/beats-view";
import { SettingsView, type SettingsSection } from "@/components/settings-view";
import {
  classNames,
  clearLiveDataCache,
  ErrorNotice,
  formatDate,
  formatNumber,
  formatTaskDue,
  isTaskDueToday,
  Label,
  LiveLoadError,
  LoadingPanel,
  localDateValue,
  Panel,
  PageHeading,
  readLegacyList,
  readWorkspaceRecovery,
  WORKSPACE_RECOVERY_KEY,
  SetupEmpty,
  toggleColorTheme,
  useArchiveAction,
  useLiveData,
  type WorkspaceRecovery,
} from "@/components/dashboard-primitives";

import type { AudienceHistorySeries } from "@/lib/audience-charts";
import { AI_PROVIDER_LABELS, DEFAULT_LOCAL_AI_URLS, isAiReady } from "@/lib/ai-providers";
import { sortFeedStories, selectNewsletterTopics, newsletterSourceOptions } from "@/lib/feed-priority";
import { sortIndustryItems, type IndustrySortOrder } from "@/lib/industry";
import { completeTaskItems } from "@/lib/tasks";
import {
  } from "@/lib/live-response";

type Tab =
  | "today"
  | "industry"
  | "mentions"
  | "reminders"
  | "audience"
  | "newsletters"
  | "tasks"
  | "pipeline"
  | "newsroom"
  | "beats"
  | "settings";
type Reminder = ReminderItem;
type Task = TaskItem;

const emptySettings: PublicSettings = {
  general: { workspaceName: "Control Center" },
  industry: {
    sources: [],
    keywords: [],
    description: "",
    excludedTerms: [],
    dailyLimit: 30,
  },
  mentions: {
    terms: [],
    websites: [],
    identityAnchors: [],
    negativeTerms: [],
    strictMode: true,
    excludeOwnedSites: true,
  },
  newsletters: {
    googleClientId: "",
    googleClientSecretSet: false,
    connected: false,
    connectedEmail: "",
    gmailQuery: "newer_than:30d (category:updates OR category:promotions)",
  },
  audience: { accounts: [] },
  ai: {
    provider: "none",
    model: "",
    localBaseUrls: DEFAULT_LOCAL_AI_URLS,
    gatewayBaseUrl: "",
    jobModels: {},
    keySet: { openai: false, anthropic: false, gemini: false, xai: false, gateway: false, lmstudio: false, ollama: false },
    keySource: { openai: "none", anthropic: "none", gemini: "none", xai: "none", gateway: "none", lmstudio: "none", ollama: "none" },
  },
  dailyBrief: { sourceLabels: [], lookbackDays: 7, sections: { industry: 5, mentions: 5, newsletters: 5 } },
  pipeline: { root: "", publicUrl: "" },
};

const nav: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: "today", label: "Today", icon: LayoutDashboard },
  { id: "industry", label: "Industry", icon: Radio },
  { id: "mentions", label: "Mentions", icon: AtSign },
  { id: "reminders", label: "Reminders", icon: Bookmark },
  { id: "audience", label: "Audience", icon: Users },
  { id: "newsletters", label: "Newsletters", icon: Newspaper },
  { id: "tasks", label: "Tasks", icon: ListTodo },
  { id: "pipeline", label: "Pipeline", icon: Network },
  { id: "newsroom", label: "Newsroom", icon: Library },
  { id: "beats", label: "Beats", icon: Crosshair },
];

function briefDueLabel(value?: string) {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function DailyBriefPanel({
  settings,
  openSettings,
  addTask,
  goTo,
}: {
  settings: PublicSettings;
  openSettings: (section?: SettingsSection) => void;
  addTask: (item: DailyBriefItem) => void;
  goTo: (tab: Tab) => void;
}) {
  const { data, loading, error, refresh } = useLiveData<DailyBriefResponse>(
    "/api/brief",
    5 * 60 * 1000,
  );
  const [window, setWindow] = useState<"today" | "week">("today");
  const now = Date.parse(data?.checkedAt || "1970-01-01T00:00:00.000Z");
  const enabledSources = new Set(
    settings.dailyBrief.sourceLabels.map((source) =>
      source.toLocaleLowerCase("en-US"),
    ),
  );
  const items = (data?.items || []).filter((item) => {
    if (!enabledSources.has(item.source.toLocaleLowerCase("en-US"))) return false;
    return isDailyBriefItemInWindow(item, window, now);
  });
  const connected = (data?.sourceStatuses || []).filter(
    (status) => status.state === "live",
  ).length;

  return (
    <Panel className="daily-brief-panel reveal delay-1">
      <div className="daily-brief-head">
        <div>
          <p className="eyebrow">Across your dashboard</p>
          <h2>Daily brief</h2>
          <p>
            Your top stories at a glance, drawn from the saved queues you choose.
          </p>
        </div>
        <div className="daily-brief-actions">
          <button className="button button-ghost" onClick={() => openSettings("dailyBrief")}>
            <Settings2 size={14} /> Customize
          </button>
          <button
            className="round-link"
            aria-label="Refresh daily brief"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw className={loading ? "spin" : ""} size={15} />
          </button>
        </div>
      </div>
      {error && <p className="save-notice" role="alert">{error}</p>}
      {loading && !data && <p className="brief-loading">Reading your saved dashboard…</p>}
      {!!data?.snapshot?.length && <DailySnapshot sections={data.snapshot} onOpen={goTo} />}
      {data && !data.snapshot?.length && (
        <div className="brief-setup-state">
          <LayoutDashboard size={24} />
          <div>
            <b>Build your own daily snapshot</b>
            <p>Choose how many stories to include from Industry, Mentions, and Newsletters. No extra connection is needed.</p>
          </div>
          <button className="button button-primary" onClick={() => openSettings("dailyBrief")}>Choose sections</button>
        </div>
      )}
      {!!settings.dailyBrief.sourceLabels.length && <div className="brief-private-head">
        <div><p className="eyebrow">Optional private context</p><h3>Messages, meetings & actions</h3></div>
        <div className="filter-row"><button className={window === "today" ? "active" : ""} onClick={() => setWindow("today")}>Today</button><button className={window === "week" ? "active" : ""} onClick={() => setWindow("week")}>Week</button></div>
      </div>}
      {!settings.dailyBrief.sourceLabels.length ? null : error && !data ? (
        <div className="brief-setup-state error-state" role="alert">
          <CircleAlert size={24} />
          <div>
            <b>Daily Brief could not be read</b>
            <p>{error}</p>
          </div>
          <button className="button button-primary" onClick={refresh}>
            Retry
          </button>
        </div>
      ) : loading && !data ? (
        <div className="brief-setup-state">
          <RefreshCw className="spin" size={24} />
          <div>
            <b>Reading local connector data</b>
            <p>This should only take a moment.</p>
          </div>
        </div>
      ) : items.length ? (
        <div className="daily-brief-grid">
          {items.slice(0, 8).map((item) => (
            <article className="daily-brief-item" key={`${item.source}:${item.id}`}>
              <div className="brief-item-meta">
                <Label tone={item.kind === "action" ? "high" : "brief"}>
                  {item.kind}
                </Label>
                <span>{item.source}</span>
                <span>
                  <Clock3 size={11} /> {briefDueLabel(item.dueAt)}
                </span>
              </div>
              <h3>{item.title}</h3>
              {item.summary && <p>{item.summary}</p>}
              <div className="brief-item-actions">
                <button onClick={() => addTask(item)}>
                  <ListTodo size={13} /> Add task
                </button>
                {item.url && (
                  <a href={item.url} target="_blank" rel="noreferrer">
                    Open source <ArrowUpRight size={13} />
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="brief-setup-state">
          <MessageSquare size={24} />
          <div>
            <b>Waiting for the first connector sync</b>
            <p>
              {connected
                ? `${connected} source${connected === 1 ? " has" : "s have"} synced, with no items in this window.`
                : "Open bridge setup to copy the Codex automation prompt or use the local ingest command."}
            </p>
          </div>
          <button
            className="button button-ghost"
            onClick={() => openSettings("integrations")}
          >
            Bridge setup
          </button>
        </div>
      )}
      {!!data?.sourceStatuses.length && (
        <div className="brief-source-strip">
          {data.sourceStatuses.map((status) => (
            <span key={status.source} title={status.message || undefined}>
              <i
                className={
                  status.state === "live"
                    ? "ready"
                    : status.state === "error"
                      ? "error"
                      : ""
                }
              />
              {status.source}
              <small>
                {status.state === "error"
                  ? `failed · ${formatDate(status.lastAttemptAt)}`
                  : status.lastSyncedAt
                  ? `${status.itemCount} · ${formatDate(status.lastSyncedAt)}`
                  : "waiting"}
              </small>
            </span>
          ))}
        </div>
      )}
    </Panel>
  );
}

function newsletterSetupReady(settings: PublicSettings) {
  return settings.newsletters.connected && isAiReady(settings.ai);
}

function TodayView({
  settings,
  tasks,
  goTo,
  openSettings,
  addBriefTask,
}: {
  settings: PublicSettings;
  tasks: Task[];
  goTo: (tab: Tab) => void;
  openSettings: (section?: SettingsSection) => void;
  addBriefTask: (item: DailyBriefItem) => void;
}) {
  const openTasks = tasks.filter((task) => !task.done).slice(0, 3);
  const industryConfigured =
    settings.industry.sources.length + settings.industry.keywords.length > 0;
  const configured = [
    industryConfigured,
    settings.mentions.terms.length + settings.mentions.websites.length > 0,
    newsletterSetupReady(settings),
    settings.audience.accounts.length > 0,
  ].filter(Boolean).length;
  const today = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
  return (
    <div className="view">
      <PageHeading
        eyebrow={today}
        title="Good morning."
        description="A quiet starting point for the sources, signals, and work you choose to track."
        action={
          <button
            className="button button-ghost"
            onClick={() => openSettings()}
          >
            <Settings2 size={15} /> Settings
          </button>
        }
      />
      <div className="brief-banner reveal delay-1">
        <div className="brief-mark">
          <Sparkles size={19} />
        </div>
        <p>
          {configured === 0 ? (
            <>
              <strong>Your dashboard is ready to configure.</strong> Add
              industry sources, mention terms, a newsletter Gmail, and audience
              accounts in Settings.
            </>
          ) : (
            <>
              <strong>{configured} of 4 live areas are configured.</strong> Open
              a tracked page for saved results, or use Refresh to check now.
            </>
          )}
        </p>
        <button aria-label="Open settings" onClick={() => openSettings()}>
          <ArrowRight size={18} />
        </button>
      </div>
      <DailyBriefPanel
        settings={settings}
        openSettings={openSettings}
        addTask={addBriefTask}
        goTo={goTo}
      />
      <div className="today-grid reveal delay-2">
        <Panel className="priority-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Focus</p>
              <h2>Open tasks</h2>
            </div>
            <span className="progress-count">
              {tasks.filter((task) => !task.done).length}
            </span>
          </div>
          {openTasks.length ? (
            <div className="priority-list">
              {openTasks.map((task, index) => (
                <button
                  key={task.id}
                  className="priority-row"
                  onClick={() => goTo("tasks")}
                >
                  <span className="check-box">{index + 1}</span>
                  <span>
                    <b>{task.title}</b>
                    <small>
                      {formatTaskDue(task.due)} · {task.recurrence}
                    </small>
                  </span>
                  <ArrowRight size={16} />
                </button>
              ))}
            </div>
          ) : (
            <div className="inline-empty">
              <ListTodo size={20} />
              <p>No open tasks yet.</p>
            </div>
          )}
          <button className="text-button" onClick={() => goTo("tasks")}>
            Open task list <ArrowRight size={14} />
          </button>
        </Panel>
        <Panel className="setup-progress">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Live tracking</p>
              <h2>Setup progress</h2>
            </div>
            <b>{configured}/4</b>
          </div>
          <div className="setup-checklist">
            <button
              onClick={() => openSettings("industry")}
              className={industryConfigured ? "complete" : ""}
            >
              <span>{industryConfigured ? <Check /> : <Globe2 />}</span>
              <div>
                <b>Industry</b>
                <small>
                  {industryConfigured
                    ? `${settings.industry.sources.length} sites · ${settings.industry.keywords.length} topics`
                    : "Add sites or topics"}
                </small>
              </div>
            </button>
            <button
              onClick={() => openSettings("mentions")}
              className={
                settings.mentions.terms.length +
                settings.mentions.websites.length
                  ? "complete"
                  : ""
              }
            >
              <span>
                {settings.mentions.terms.length +
                settings.mentions.websites.length ? (
                  <Check />
                ) : (
                  <AtSign />
                )}
              </span>
              <div>
                <b>Mentions</b>
                <small>
                  {settings.mentions.terms.length +
                  settings.mentions.websites.length
                    ? `${settings.mentions.terms.length + settings.mentions.websites.length} watch terms`
                    : "Add names and brands"}
                </small>
              </div>
            </button>
            <button
              onClick={() => openSettings("newsletters")}
              className={newsletterSetupReady(settings) ? "complete" : ""}
            >
              <span>
                {newsletterSetupReady(settings) ? <Check /> : <Mail />}
              </span>
              <div>
                <b>Newsletters</b>
                <small>
                  {settings.newsletters.connected
                    ? newsletterSetupReady(settings)
                      ? settings.newsletters.connectedEmail
                      : "Configure AI to finish setup"
                    : "Connect a Gmail account (optional)"}
                </small>
              </div>
            </button>
            <button
              onClick={() => openSettings("audience")}
              className={settings.audience.accounts.length ? "complete" : ""}
            >
              <span>
                {settings.audience.accounts.length ? <Check /> : <Users />}
              </span>
              <div>
                <b>Audience</b>
                <small>
                  {settings.audience.accounts.length
                    ? `${settings.audience.accounts.length} accounts`
                    : "Add social accounts"}
                </small>
              </div>
            </button>
          </div>
        </Panel>
        <Panel className="privacy-card">
          <ShieldCheck size={22} />
          <div>
            <p className="eyebrow">Local by design</p>
            <h2>Your configuration stays here</h2>
            <p>
              Settings and provider tokens are stored server-side in the local
              data directory and excluded from Git. Browser code never receives
              saved secrets.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function IndustryView({
  saveStory,
  openSettings,
}: {
  saveStory: (story: LiveStory) => void;
  openSettings: () => void;
}) {
  const { data, loading, error, refresh, mutate } = useLiveData<LiveFeedResponse>(
    "/api/live/industry",
    15 * 60 * 1000,
    "/api/live/industry?refresh=1",
  );
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"active" | "history" | "archive">("active");
  const [sortOrder, setSortOrder] = useState<IndustrySortOrder>("important");
  const archive = useArchiveAction<LiveFeedResponse>("industry", mutate);
  const sourceItems =
    view === "archive"
      ? data?.archivedItems || []
      : view === "history"
        ? data?.historyItems || []
        : data?.items || [];
  const items = sortIndustryItems(
    sourceItems.filter((item) =>
      `${item.title} ${item.summary} ${item.source}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ),
    sortOrder,
  );
  const kindLabel = (item: LiveStory) =>
    item.kind === "sitemap"
      ? "New sitemap page"
      : item.kind === "topic"
        ? "Topic discovery"
        : "Live feed";
  return (
    <div className="view">
      <PageHeading
        eyebrow="Live source desk"
        title="Industry"
        description="A bounded briefing of the most useful watched-site and topic updates from the last 24 hours."
        action={
          <button
            className="button button-primary"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw size={15} /> Refresh sources
          </button>
        }
      />
      {loading && !data ? (
        <LoadingPanel />
      ) : !data && error ? (
        <LiveLoadError error={error} retry={refresh} />
      ) : !data?.configured ? (
        <SetupEmpty
          icon={<Globe2 />}
          title="Choose what this page watches"
          description="Add public sites for feed or sitemap tracking, and topics for wider industry-news discovery."
          onSetup={openSettings}
        />
      ) : (
        <>
          <div className="toolbar reveal delay-1">
            <div className="filter-row">
              <button
                className={view === "active" ? "active" : ""}
                onClick={() => setView("active")}
              >
                Important now {data.items.length}
              </button>
              <button
                className={view === "history" ? "active" : ""}
                onClick={() => setView("history")}
              >
                History {data.historyCount || 0}
              </button>
              <button
                className={view === "archive" ? "active" : ""}
                onClick={() => setView("archive")}
              >
                Archived {data.archiveCount || 0}
              </button>
            </div>
            <div className="toolbar-actions">
              <label className="sort-control">
                <span>Sort</span>
                <select
                  aria-label="Sort industry updates"
                  value={sortOrder}
                  onChange={(event) =>
                    setSortOrder(event.target.value as IndustrySortOrder)
                  }
                >
                  <option value="important">Most important</option>
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="watched">Watched sites first</option>
                </select>
              </label>
              <label className="search-box">
                <Search size={15} />
                <input
                  aria-label="Search industry updates"
                  placeholder="Search updates"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
            </div>
          </div>
          <div className="industry-curation-strip reveal delay-1">
            <div>
              <Sparkles size={17} />
              <span>
                <b>{data.items.length} surfaced</b>
                <small>
                  from {data.discoveredCount ?? data.items.length} current
                  discoveries · limit {data.surfacedLimit ?? data.items.length}
                </small>
              </span>
            </div>
            <Label tone={data.curationMode === "local" ? "watch" : "verified"}>
              {data.curationMode === "local"
                ? "Local ranking"
                : `${data.curationMode} assisted`}
            </Label>
            <p>
              {data.providerStatuses?.[0]?.message ||
                "Canonical deduplication, relevance, recency, material-change signals, and source diversity determine this queue."}
            </p>
          </div>
          {data.sourceStatuses?.length ? (
            <div className="source-status-grid reveal delay-1">
              {data.sourceStatuses.map((status) => (
                <div
                  className={`source-status status-${status.state}`}
                  key={status.sourceId}
                >
                  <span>
                    <Globe2 size={14} />
                    <b>{status.source}</b>
                  </span>
                  <Label
                    tone={status.mode === "sitemap" ? "brief" : "positive"}
                  >
                    {status.mode}
                  </Label>
                  <p>{status.message}</p>
                  <a href={status.endpoint} target="_blank" rel="noreferrer">
                    View endpoint <ExternalLink size={11} />
                  </a>
                </div>
              ))}
            </div>
          ) : null}
          <ErrorNotice
            errors={[
              ...(data.errors || []),
              ...(error ? [error] : []),
              ...(archive.error ? [archive.error] : []),
            ]}
          />
          <div className="story-stack reveal delay-2">
            {items.map((item, index) => (
              <article className="story-card" key={item.id}>
                <div className="story-index">
                  {String(index + 1).padStart(2, "0")}
                </div>
                <div className="story-body">
                  <div className="story-meta">
                    <span>{item.source}</span>
                    <i />
                    <span>{formatDate(item.publishedAt)}</span>
                    <Label
                      tone={item.kind === "sitemap" ? "brief" : "positive"}
                    >
                      {kindLabel(item)}
                    </Label>
                    {item.importanceScore !== undefined && (
                      <Label tone="verified">
                        {item.importanceScore} importance
                      </Label>
                    )}
                    {view === "history" && (
                      <Label tone="watch">History</Label>
                    )}
                    {view === "archive" && (
                      <Label tone="watch">Archived</Label>
                    )}
                  </div>
                  <h2>{item.title}</h2>
                  <p>
                    {item.summary ||
                      "Open the original source for the full update."}
                  </p>
                  {item.importanceReason && view === "active" && (
                    <p className="importance-reason">
                      <Sparkles size={12} /> {item.importanceReason}
                    </p>
                  )}
                  <div className="story-footer">
                    <span />
                    <div>
                      {view === "active" && (
                        <button
                          title="Save to reminders"
                          onClick={() => saveStory(item)}
                        >
                          <Bookmark size={16} />
                        </button>
                      )}
                      {view === "active" ? (
                        <button
                          title="Archive"
                          disabled={archive.pending === item.id}
                          onClick={() => void archive.update(item.id, true)}
                        >
                          <Archive size={16} />
                        </button>
                      ) : item.workflow?.restoreEligible ? (
                        <button
                          title="Restore from archive"
                          disabled={archive.pending === item.id}
                          onClick={() => void archive.update(item.id, false)}
                        >
                          <ArchiveRestore size={16} />
                        </button>
                      ) : null}
                      <a
                        className="round-link"
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        title="Open original"
                      >
                        <ExternalLink size={16} />
                      </a>
                    </div>
                  </div>
                </div>
              </article>
            ))}
            {!items.length && (
              <Panel className="empty-state">
                <CheckCircle2 size={24} />
                <h2>
                  {view === "archive"
                    ? "Nothing archived yet"
                    : view === "history"
                      ? "Nothing in history yet"
                      : "No current updates found"}
                </h2>
                <p>
                  {view === "archive"
                    ? "Items only appear here after you choose Archive."
                    : view === "history"
                      ? "Updates that left the current 24-hour window remain available here."
                      : "No discovery cleared the current importance threshold. The broad source scan still completed and will check again automatically."}
                </p>
              </Panel>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MentionsView({
  saveStory,
  openSettings,
}: {
  saveStory: (story: LiveStory) => void;
  openSettings: () => void;
}) {
  const { data, loading, error, refresh, mutate } = useLiveData<LiveFeedResponse>(
    "/api/live/mentions",
    15 * 60 * 1000,
    "/api/live/mentions?refresh=1",
  );
  const [view, setView] = useState<"active" | "archive">("active");
  const [sortOrder, setSortOrder] = useState<"priority" | "newest" | "oldest">("priority");
  const archive = useArchiveAction<LiveFeedResponse>("mentions", mutate);
  const items = sortFeedStories(view === "archive" ? data?.archivedItems || [] : data?.items || [], sortOrder);
  const highConfidenceCount = (data?.items || []).filter(
    (item) => item.confidence === "high",
  ).length;
  return (
    <div className="view">
      <PageHeading
        eyebrow="Seven-day web radar"
        title="Mentions"
        description="Verified third-party pages from the past week, matched to the identities you configure and deduplicated against your local archive."
        action={
          <button
            className="button button-ghost"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw size={15} /> Check now
          </button>
        }
      />
      {loading && !data ? (
        <LoadingPanel />
      ) : !data && error ? (
        <LiveLoadError error={error} retry={refresh} />
      ) : !data?.configured ? (
        <SetupEmpty
          icon={<AtSign />}
          title="Tell the radar what to watch"
          description="Add exact aliases plus identity anchors that distinguish you from namesakes."
          onSetup={openSettings}
        />
      ) : (
        <>
          <div className="shelf-controls reveal delay-1">
            <div className="filter-row">
              <button
                className={view === "active" ? "active" : ""}
                onClick={() => setView("active")}
              >
                Past 7 days {data.items.length}
              </button>
              <button
                className={view === "archive" ? "active" : ""}
                onClick={() => setView("archive")}
              >
                Archive & history {data.archiveCount || 0}
              </button>
            </div>
            <div className="live-stamp">
              <i /> Checked {formatDate(data.checkedAt)}
            </div>
          </div>
          <div className="mention-summary reveal delay-1">
            <div>
              <span>High confidence</span>
              <b>{highConfidenceCount}</b>
              <small>Direct identity evidence</small>
            </div>
            <div>
              <span>Needs review</span>
              <b>{data.reviewCount || 0}</b>
              <small>Literal matches when strict mode is off</small>
            </div>
            <div>
              <span>Noise removed</span>
              <b>{data.filteredOut || 0}</b>
              <small>Weak or ambiguous matches</small>
            </div>
            <div className="mention-callout">
              <ShieldCheck size={19} />
              <p>
                <b>Identity-aware filtering</b>Provider query terms never count
                as evidence. Exact aliases and domains can qualify directly;
                ambiguous names require configured identity anchors in strict
                mode.
              </p>
            </div>
          </div>
          {data.providerStatuses?.length ? (
            <div className="provider-status-list reveal delay-1">
              {data.providerStatuses.map((status) => (
                <div key={status.provider} className={`provider-state state-${status.state}`}>
                  <span>
                    <i /> <b>{status.provider}</b>
                  </span>
                  <Label
                    tone={
                      status.state === "live"
                        ? "positive"
                        : status.state === "disabled"
                          ? "watch"
                          : "brief"
                    }
                  >
                    {status.state}
                  </Label>
                  <p>{status.message}</p>
                </div>
              ))}
            </div>
          ) : null}
          <ErrorNotice
            errors={[
              ...(data.errors || []),
              ...(error ? [error] : []),
              ...(archive.error ? [archive.error] : []),
            ]}
          />
          <div className="mention-feed reveal delay-2">
            <div className="feed-sort-bar">
              <span><Sparkles size={14} /> {data.curationMode && data.curationMode !== "local" ? `${AI_PROVIDER_LABELS[data.curationMode]} priority & page summaries` : "Built-in priority · enable AI for richer page summaries"}</span>
              <label>Sort mentions <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as typeof sortOrder)}><option value="priority">Priority</option><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
            </div>
            {items.map((item) => (
              <article className="mention-card" key={item.id}>
                <div className="network-avatar network-web">
                  {item.matchedTerm?.[0]?.toUpperCase() || "@"}
                </div>
                <div className="mention-content">
                  <div className="mention-meta">
                    <b>{item.source}</b>
                    <span>{formatDate(item.publishedAt || item.discoveredAt || "")}</span>
                    <Label
                      tone={item.confidence === "high" ? "verified" : "watch"}
                    >
                      {item.confidence === "high"
                        ? "High confidence"
                        : "Review"}
                    </Label>
                    {item.matchedTerm && <Label>{item.matchedTerm}</Label>}
                  </div>
                  <p>“{item.title}”</p>
                  <div className="mention-page-summary">{item.aiSummary || item.summary}</div>
                  {item.importanceReason && <div className="priority-reason"><Sparkles size={12} /><span>{item.importanceScore !== undefined ? `${item.importanceScore}/100 · ` : ""}{item.importanceReason}</span></div>}
                  <div className="mention-footer">
                    <span>
                      {item.matchReasons?.join(" · ") ||
                        item.summary.slice(0, 180)}
                    </span>
                  </div>
                </div>
                <div className="mention-actions">
                  {view === "active" && (
                    <button
                      title="Save to reminders"
                      onClick={() => saveStory(item)}
                    >
                      <Bookmark size={16} />
                    </button>
                  )}
                  <a
                    className="round-link"
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${item.title}`}
                  >
                    <ExternalLink size={16} />
                  </a>
                  {view === "active" ? (
                    <button
                      title="Archive"
                      disabled={archive.pending === item.id}
                      onClick={() => void archive.update(item.id, true)}
                    >
                      <Archive size={16} />
                    </button>
                  ) : item.workflow?.restoreEligible ? (
                    <button
                      title="Restore"
                      disabled={archive.pending === item.id}
                      onClick={() => void archive.update(item.id, false)}
                    >
                      <ArchiveRestore size={16} />
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
            {!items.length && (
              <Panel className="empty-state">
                <CheckCircle2 size={26} />
                <h2>
                  {view === "archive"
                    ? "No mention history"
                    : "No verified new mentions found"}
                </h2>
                <p>
                  {view === "archive"
                    ? "Archived and expired mentions remain available here."
                    : "The news collectors and any enabled broad-web research found no new URL with direct identity evidence in the past seven days. Previously archived URLs stay out of this queue."}
                </p>
              </Panel>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function RemindersView({
  reminders,
  addReminder,
  archiveReminder,
}: {
  reminders: Reminder[];
  addReminder: (title: string, note: string, url?: string) => void;
  archiveReminder: (id: string | number, archived: boolean) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [view, setView] = useState<"active" | "archive">("active");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    addReminder(
      title.trim(),
      note.trim(),
      title.startsWith("http") ? title : undefined,
    );
    setTitle("");
    setNote("");
    setShowForm(false);
  };
  const active = reminders
    .filter((item) => !item.archivedAt)
    .sort(
      (left, right) =>
        Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""),
    );
  const archived = reminders
    .filter((item) => item.archivedAt)
    .sort(
      (left, right) =>
        Date.parse(right.archivedAt || "") - Date.parse(left.archivedAt || ""),
    );
  const items = view === "archive" ? archived : active;
  return (
    <div className="view">
      <PageHeading
        eyebrow="Come back to this"
        title="Reminders"
        description="Save articles, videos, posts, and ideas without turning them into tasks."
        action={
          <button
            className="button button-primary"
            onClick={() => {
              setView("active");
              setShowForm(true);
            }}
          >
            <Plus size={16} /> Save something
          </button>
        }
      />
      {showForm && (
        <form className="quick-form reveal" onSubmit={submit}>
          <div className="form-icon">
            <Link2 size={20} />
          </div>
          <label>
            <span>Link or title</span>
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Paste a URL or type a title…"
            />
          </label>
          <label>
            <span>Why save it?</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="A note for future you"
            />
          </label>
          <button className="button button-primary">Save</button>
          <button
            className="icon-button"
            type="button"
            onClick={() => setShowForm(false)}
          >
            <X size={16} />
          </button>
        </form>
      )}
      <div className="shelf-controls reveal delay-1">
        <div className="filter-row">
          <button
            className={view === "active" ? "active" : ""}
            onClick={() => setView("active")}
          >
            Active {active.length}
          </button>
          <button
            className={view === "archive" ? "active" : ""}
            onClick={() => setView("archive")}
          >
            Archive {archived.length}
          </button>
        </div>
        <span className="sort-label">
          <ChevronDown size={15} /> Newest first
        </span>
      </div>
      <div className="reminder-grid reveal delay-2">
        {items.map((item) => (
          <article
            className={`reminder-card accent-${item.accent}`}
            key={item.id}
          >
            <div className="reminder-top">
              <Label>{item.type}</Label>
              <button
                title={
                  view === "archive" ? "Restore reminder" : "Archive reminder"
                }
                onClick={() => archiveReminder(item.id, view === "active")}
              >
                {view === "archive" ? (
                  <ArchiveRestore size={15} />
                ) : (
                  <Archive size={15} />
                )}
              </button>
            </div>
            <div className="reminder-icon">
              <Newspaper />
            </div>
            <h2>{item.title}</h2>
            <p>{item.note}</p>
            <div className="reminder-bottom">
              <span>
                {item.source} ·{" "}
                {item.createdAt
                  ? formatDate(item.createdAt)
                  : item.added || "Saved previously"}
              </span>
              {item.url && (
                <a href={item.url} target="_blank" rel="noreferrer">
                  Open <ArrowUpRight size={14} />
                </a>
              )}
            </div>
          </article>
        ))}
        {view === "active" && (
          <button className="add-card" onClick={() => setShowForm(true)}>
            <Plus />
            <span>
              {reminders.length ? "Save another thing" : "Your shelf is empty"}
            </span>
            <small>Paste any link from the web</small>
          </button>
        )}
        {view === "archive" && !items.length && (
          <Panel className="empty-state">
            <Archive size={24} />
            <h2>No archived reminders</h2>
            <p>
              Archived links and ideas stay available here until you restore
              them.
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}

function platformColor(platform: AudiencePlatform) {
  return {
    youtube: "#e5484d",
    x: "#15181c",
    instagram: "#b44b91",
    facebook: "#3d73a8",
    linkedin: "#1769aa",
    threads: "#4f5554",
    tiktok: "#1e918c",
  }[platform];
}
function cachedMetricLabel(item: AudienceMetric) {
  if (item.source?.includes("daily cache")) return "Daily cache";
  return item.source?.includes("(cached)") ? "Cached" : "";
}

function AudienceView({ openSettings }: { openSettings: () => void }) {
  const { data, loading, error, refresh } = useLiveData<{
    configured: boolean;
    checkedAt: string;
    items: AudienceMetric[];
    history?: AudienceHistorySeries[];
  }>("/api/live/audience", 15 * 60 * 1000, "/api/live/audience?refresh=1");
  const items = data?.items || [];
  return (
    <div className="view">
      <PageHeading
        eyebrow="Keyless audience ledger"
        title="Audience"
        description="Best-effort public totals for the exact profile URLs in Settings, with changes measured against a verified 24–36h baseline instead of the latest refresh."
        action={
          <button
            className="button button-ghost"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw size={15} /> Refresh metrics
          </button>
        }
      />
      {loading && !data ? (
        <LoadingPanel />
      ) : !data && error ? (
        <LiveLoadError error={error} retry={refresh} />
      ) : !data?.configured ? (
        <SetupEmpty
          icon={<Users />}
          title="Add the accounts you care about"
          description="Paste public YouTube, X, Instagram, Facebook, LinkedIn, Threads, or TikTok profile URLs. API keys are optional fallbacks."
          onSetup={openSettings}
        />
      ) : (
        <>
          <AudienceInsights items={items} history={data.history} checkedAt={data.checkedAt} />
          {error && <ErrorNotice errors={[error]} />}
          <div className="platform-table reveal delay-2">
            <div className="platform-head">
              <span>Platform</span>
              <span>Audience</span>
              <span>{AUDIENCE_COMPARISON_WINDOW_LABEL}</span>
              <span>Status</span>
            </div>
            {items.map((item) => {
              const cacheLabel = cachedMetricLabel(item);
              return (
                <div className="platform-row" key={item.id}>
                  <div className="platform-name">
                    <span
                      className="platform-icon"
                      style={{ background: platformColor(item.platform) }}
                    >
                      {item.platform[0].toUpperCase()}
                    </span>
                    <div>
                      <b>{item.label}</b>
                      <small>{item.handle}</small>
                    </div>
                  </div>
                  <div className="platform-total">
                    <strong>
                      {item.error
                        ? item.total === null
                          ? "—"
                          : formatNumber(item.total)
                        : formatNumber(item.total ?? 0)}
                    </strong>
                    <small>
                      {[
                        item.primaryLabel
                          ? `${item.primaryLabel[0].toUpperCase()}${item.primaryLabel.slice(1)}`
                          : "Audience total",
                        item.secondaryLabel && item.secondaryValue !== undefined
                          ? `${formatNumber(item.secondaryValue)} ${item.secondaryLabel}`
                          : "",
                      ].filter(Boolean).join(" · ")}
                    </small>
                  </div>
                  <div className="platform-growth">
                    <b>
                      {item.error && item.stale
                        ? "Last known"
                        : item.change === null
                          ? "Baseline"
                          : `${item.change >= 0 ? "+" : ""}${formatNumber(item.change)}`}
                    </b>
                    <small>
                      {item.error
                        ? item.lastSuccessfulAt
                          ? `Last verified ${formatDate(item.lastSuccessfulAt)}`
                          : item.error
                        : item.change === null
                          ? "Waiting for 24–36h baseline"
                          : audienceComparisonLabel(
                              item.checkedAt,
                              item.changeComparedAt,
                            )}
                    </small>
                  </div>
                  {item.error ? (
                    <Label tone="watch">
                      {item.stale ? "Limited" : "Unavailable"}
                    </Label>
                  ) : (
                    <Label tone={cacheLabel ? "watch" : "positive"}>
                      {cacheLabel || "Public"}
                    </Label>
                  )}
                  {item.error && item.lastSuccessfulAt && (
                    <small className="metric-error">{item.error}</small>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function NewslettersView({
  addReminder,
  openSettings,
  openAiSettings,
}: {
  addReminder: (title: string, note: string, url?: string) => void;
  openSettings: () => void;
  openAiSettings: () => void;
}) {
  const { data, loading, error, refresh, mutate } = useLiveData<NewsletterFeedResponse>(
    "/api/live/newsletters",
    15 * 60 * 1000,
    "/api/live/newsletters?refresh=1",
  );
  const [view, setView] = useState<"active" | "archive" | "history">("active");
  const [sortOrder, setSortOrder] = useState<"priority" | "newest" | "oldest">("priority");
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(30);
  const archive = useArchiveAction<NewsletterFeedResponse>(
    "newsletters",
    mutate,
  );
  const sourceItems = view === "archive"
    ? data?.archivedItems || []
    : view === "history"
      ? data?.historyItems || []
      : data?.items || [];
  const sourceOptions = newsletterSourceOptions(sourceItems);
  const items = selectNewsletterTopics(sourceItems, { sortOrder, sources: selectedSources, query });
  const visibleItems = items.slice(0, visibleCount);
  const changeView = (next: typeof view) => { setView(next); setVisibleCount(30); };
  const clearFilters = () => { setSelectedSources([]); setQuery(""); setVisibleCount(30); };
  return (
    <div className="view newsletter-view">
      <PageHeading
        eyebrow="Newsletter intelligence"
        title="Newsletters"
        description="AI reads your newsletters, extracts the actual news, and combines repeated coverage into source-backed stories."
        action={
          <button
            className="button button-primary"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw size={15} /> Refresh intelligence
          </button>
        }
      />
      {loading && !data ? (
        <LoadingPanel />
      ) : !data && error ? (
        <LiveLoadError error={error} retry={refresh} />
      ) : !data?.configured ? (
        <SetupEmpty
          icon={<Mail />}
          title="Connect a newsletter Gmail"
          description="This can be a completely different account from any Gmail connected elsewhere. The dashboard requests read-only access."
          onSetup={openSettings}
        />
      ) : data.aiConfigured === false && !data.items.length && !data.historyItems?.length && !data.archivedItems.length ? (
        <SetupEmpty
          icon={<Sparkles />}
          title="Choose AI for newsletter intelligence"
          description="Connect a cloud AI provider or a loaded LM Studio / Ollama model in AI curation. Newsletter text goes only to the selected provider. Gmail remains read-only."
          onSetup={openAiSettings}
        />
      ) : (
        <>
          <div className="newsletter-status reveal delay-1">
            <div className="status-orb">
              <Inbox size={21} />
            </div>
            <div>
              <b>
                {data.connected
                  ? `${data.items.length} active stories from ${data.issueCount || 0} newsletter issues`
                  : "Saved newsletter intelligence"}
              </b>
              <p>
                {data.newsletterCount || 0} newsletters · {data.mentionCount || 0} source mentions · {data.aiProvider ? AI_PROVIDER_LABELS[data.aiProvider] : "AI"} · checked {formatDate(data.checkedAt)}
                {data.pendingIssueCount ? ` · ${data.pendingIssueCount} older issues queued for background processing` : ""}
                {!data.connected ? " · Gmail disconnected" : ""}
              </p>
            </div>
            <button onClick={openSettings}>
              Manage account <ArrowRight size={14} />
            </button>
          </div>
          <div className="shelf-controls reveal delay-1">
            <div className="filter-row">
              <button
                className={view === "active" ? "active" : ""}
                onClick={() => changeView("active")}
              >
                Past {data.freshnessHours || 36} hours {data.items.length}
              </button>
              <button
                className={view === "history" ? "active" : ""}
                onClick={() => changeView("history")}
              >
                Earlier {data.historyCount || 0}
              </button>
              <button
                className={view === "archive" ? "active" : ""}
                onClick={() => changeView("archive")}
              >
                Archive {data.archiveCount || 0}
              </button>
            </div>
          </div>
          <ErrorNotice
            errors={[
              ...(data.errors || []),
              ...(error ? [error] : []),
              ...(archive.error ? [archive.error] : []),
            ]}
          />
          <div className="newsletter-stack reveal delay-2">
            <div className="newsletter-controls">
              <label className="search-box"><Search size={15} /><input aria-label="Search newsletter stories" autoComplete="off" value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(30); }} placeholder="Search headlines, topics, or sources…" /></label>
              <details className="newsletter-filter-menu">
                <summary><Mail size={14} /> {selectedSources.length ? `${selectedSources.length} selected newsletters` : "All newsletters"}<ChevronDown size={14} /></summary>
                <div className="newsletter-filter-options">
                  <button type="button" onClick={() => { setSelectedSources([]); setVisibleCount(30); }}>All newsletters</button>
                  {sourceOptions.map(({name, count}) => <label key={name}><input type="checkbox" checked={selectedSources.includes(name)} onChange={(event) => { setSelectedSources((current) => event.target.checked ? [...current, name] : current.filter((source) => source !== name)); setVisibleCount(30); }} /><span>{name}</span><small>{count}</small></label>)}
                  {!sourceOptions.length && <p>No newsletters in this view yet.</p>}
                </div>
              </details>
              <label className="feed-sort-select">Sort stories<select value={sortOrder} onChange={(event) => { setSortOrder(event.target.value as typeof sortOrder); setVisibleCount(30); }}><option value="priority">Priority</option><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
            </div>
            <div className="newsletter-results" aria-live="polite"><span>Showing {visibleItems.length} of {items.length} stories{selectedSources.length ? ` · ${selectedSources.join(", ")}` : ""}</span>{(query || selectedSources.length > 0) && <button onClick={clearFilters}>Clear filters <X size={12} /></button>}</div>
            {visibleItems.map((item) => (
              <article className="newsletter-card" key={item.id}>
                <div className="sender-mark">
                  {item.title[0]?.toUpperCase() || "N"}
                </div>
                <div className="newsletter-copy">
                  <div className="story-meta">
                    <span>
                      {item.coverageCount} report{item.coverageCount === 1 ? "" : "s"}
                    </span>
                    <i />
                    <span>
                      {item.newsletterCount} newsletter{item.newsletterCount === 1 ? "" : "s"}
                    </span>
                    <i />
                    <span>{formatDate(item.receivedAt)}</span>
                    <Label tone={item.coverageCount > 1 ? "positive" : "neutral"}>
                      {item.coverageCount > 1 ? "Cross-reported" : "New story"}
                    </Label>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.summary}</p>
                  {item.importanceReason && <div className="priority-reason"><Sparkles size={12} /><span>{item.importanceScore !== undefined ? `${item.importanceScore}/100 · ` : ""}{item.importanceReason}</span></div>}
                  <div className="newsletter-sources">
                    {item.sourceLinks.slice(0, 4).map((source) => (
                      <a
                        key={source.url}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        title={source.title}
                      >
                        <ExternalLink size={12} /> {source.publisher}
                      </a>
                    ))}
                    {item.sourceLinks.length > 4 && (
                      <details>
                        <summary>+{item.sourceLinks.length - 4} more sources</summary>
                        {item.sourceLinks.slice(4).map((source) => (
                          <a key={source.url} href={source.url} target="_blank" rel="noreferrer" title={source.title}>
                            <ExternalLink size={12} /> {source.publisher}
                          </a>
                        ))}
                      </details>
                    )}
                  </div>
                  <div className="newsletter-byline">
                    Reported by {item.newsletterSources.slice(0, 4).join(", ")}
                    {item.newsletterSources.length > 4
                      ? ` +${item.newsletterSources.length - 4} more`
                      : ""}
                  </div>
                  <div className="newsletter-foot">
                    {view !== "archive" && (
                      <button
                        onClick={() =>
                          addReminder(
                            item.title,
                            item.summary,
                            item.url,
                          )
                        }
                      >
                        <Bookmark size={14} /> Remind me
                      </button>
                    )}
                    <a href={item.url} target="_blank" rel="noreferrer">
                      <ExternalLink size={14} /> Open source
                    </a>
                    <a href={item.gmailUrl} target="_blank" rel="noreferrer">
                      <Mail size={14} /> Newsletter evidence
                    </a>
                  </div>
                </div>
                {(view === "active" || (view === "archive" && item.workflow?.restoreEligible)) && <button
                  className="mark-read"
                  title={view === "archive" ? "Restore" : "Archive"}
                  disabled={archive.pending === item.id}
                  onClick={() =>
                    void archive.update(item.id, view === "active")
                  }
                >
                  {view === "archive" ? (
                    <ArchiveRestore size={16} />
                  ) : (
                    <Archive size={16} />
                  )}
                </button>}
              </article>
            ))}
            {items.length > visibleCount && <button className="button button-ghost newsletter-load-more" onClick={() => setVisibleCount((count) => count + 30)}>Show 30 more · {items.length - visibleCount} remaining</button>}
            {!items.length && (
              <Panel className="empty-state">
                <CheckCircle2 size={28} />
                <h2>
                  {query || selectedSources.length ? "No stories match these filters" : view === "archive"
                    ? "No archived newsletter stories"
                    : view === "history"
                      ? "No earlier stories yet"
                      : "You’re all caught up"}
                </h2>
                <p>
                  {query || selectedSources.length ? "Try another newsletter, a different search, or clear the filters above." : view === "archive"
                    ? "Archived stories remain stored locally without changing Gmail."
                    : view === "history"
                      ? "Stories outside the current reading window remain here as the mailbox backfill is processed."
                      : "No extracted newsletter stories remain in the active queue."}
                </p>
              </Panel>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TasksView({
  tasks,
  setTasks,
}: {
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [due, setDue] = useState(localDateValue);
  const [recurrence, setRecurrence] = useState("One-time");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !due) return;
    setTasks((values) => [
      {
        id: crypto.randomUUID(),
        title: title.trim(),
        description: description.trim() || "No additional details.",
        due,
        recurrence,
        priority: "Normal",
        done: false,
        createdAt: new Date().toISOString(),
      },
      ...values,
    ]);
    setTitle("");
    setDescription("");
    setDue(localDateValue());
    setRecurrence("One-time");
    setShowForm(false);
  };
  const complete = (task: Task) =>
    setTasks((values) =>
      completeTaskItems(values, task.id, { expectedDue: task.due }),
    );
  const open = tasks.filter((task) => !task.done);
  const completed = tasks
    .filter((task) => task.done)
    .sort((a, b) =>
      (b.completedAt || b.createdAt || "").localeCompare(
        a.completedAt || a.createdAt || "",
      ),
    );
  const completedToday = completed.filter(
    (task) =>
      task.completedAt &&
      localDateValue(new Date(task.completedAt)) === localDateValue(),
  );
  const dueToday = open.filter((task) => isTaskDueToday(task.due));
  const todayTotal = dueToday.length + completedToday.length;
  return (
    <div className="view">
      <PageHeading
        eyebrow="Execution"
        title="Tasks"
        description="One-time and repeating work, with enough detail to make the next action obvious."
        action={
          <button
            className="button button-primary"
            onClick={() => setShowForm(true)}
          >
            <Plus size={16} /> Add task
          </button>
        }
      />
      {showForm && (
        <form className="task-form reveal" onSubmit={submit}>
          <div>
            <p className="eyebrow">New task</p>
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What needs to get done?"
            />
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Add a description (optional)"
            />
          </div>
          <div className="task-fields">
            <label>
              Due
              <input
                type="date"
                required
                value={due}
                onChange={(event) => setDue(event.target.value)}
              />
            </label>
            <label>
              Repeats
              <select
                value={recurrence}
                onChange={(event) => setRecurrence(event.target.value)}
              >
                <option>One-time</option>
                <option>Daily</option>
                <option>Weekly</option>
                <option>Monthly</option>
              </select>
            </label>
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="button button-ghost"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </button>
            <button className="button button-primary">Add task</button>
          </div>
        </form>
      )}
      <div className="task-summary reveal delay-1">
        <div>
          <b>{open.length}</b>
          <span>open tasks</span>
        </div>
        <div>
          <b>{dueToday.length}</b>
          <span>due today</span>
        </div>
        <div>
          <b>
            {
              tasks.filter(
                (task) => task.recurrence !== "One-time" && !task.done,
              ).length
            }
          </b>
          <span>repeating</span>
        </div>
        <div className="task-progress">
          <span>
            <i
              style={{
                width: `${todayTotal ? (completedToday.length / todayTotal) * 100 : 0}%`,
              }}
            />
          </span>
          <small>{completedToday.length} completed today</small>
        </div>
      </div>
      {open.length ? (
        <div className="task-list reveal delay-2">
          <div className="task-list-head">
            <span>Task</span>
            <span>Due</span>
            <span>Repeats</span>
            <span />
          </div>
          {open.map((task) => (
            <div className="task-row" key={task.id}>
              <button
                className="round-check"
                aria-label={
                  task.recurrence === "One-time"
                    ? `Complete ${task.title}`
                    : `Complete and reschedule ${task.title}`
                }
                onClick={() => complete(task)}
              >
                <Check size={14} />
              </button>
              <div className="task-copy">
                <b>{task.title}</b>
                <p>{task.description}</p>
              </div>
              <Label tone={isTaskDueToday(task.due) ? "high" : undefined}>
                {formatTaskDue(task.due)}
              </Label>
              <span className="repeat-text">
                <RefreshCw size={13} />
                {task.recurrence}
              </span>
              <button
                className="more-button"
                aria-label={`Delete ${task.title}`}
                title="Delete task"
                onClick={() =>
                  setTasks((values) =>
                    values.filter((value) => value.id !== task.id),
                  )
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <Panel className="empty-state">
          <ListTodo size={26} />
          <h2>No open tasks</h2>
          <p>Add the first task when there is something worth committing to.</p>
        </Panel>
      )}
      {completed.length > 0 && (
        <details className="completed-list">
          <summary>{completed.length} completed</summary>
          {completed.map((task) => (
            <div className="completed-row" key={task.id}>
              <CheckCircle2 size={16} />
              <div className="completed-copy">
                <s>{task.title}</s>
                <small>
                  {task.completedAt
                    ? `Completed ${formatDate(task.completedAt)}`
                    : "Completed"}
                  {` · was due ${formatTaskDue(task.due)}`}
                  {task.seriesId !== undefined ? " · recurring occurrence" : ""}
                </small>
              </div>
              {task.seriesId === undefined && (
                <button
                  aria-label={`Delete completed ${task.title}`}
                  title="Delete completed task"
                  onClick={() =>
                    setTasks((values) =>
                      values.filter((value) => value.id !== task.id),
                    )
                  }
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

function PipelineTab({ openSettings }: { openSettings: () => void }) {
  // The pipeline publishes once a day on its own schedule, so a five minute
  // poll is plenty; Refresh covers the case of watching a run land.
  const { data, loading, error, refresh } = useLiveData<PipelineSnapshot>(
    "/api/pipeline",
    5 * 60 * 1000,
  );
  if (error && !data) return <LiveLoadError error={error} retry={refresh} />;
  if (loading && !data) return <LoadingPanel />;
  return (
    <PipelineView
      snapshot={data}
      loading={loading}
      onRefresh={refresh}
      onSetup={openSettings}
    />
  );
}

function NewsroomTab({ openSettings }: { openSettings: () => void }) {
  // The day being read is part of the request, so it belongs in the key rather
  // than in a filter applied after the fact: picking an older day must fetch
  // that day's artifacts, not sift through today's.
  const [day, setDay] = useState("");
  const { data, loading, error, refresh } = useLiveData<NewsroomSnapshot>(
    day ? `/api/newsroom?day=${encodeURIComponent(day)}` : "/api/newsroom",
    5 * 60 * 1000,
  );
  if (error && !data) return <LiveLoadError error={error} retry={refresh} />;
  if (loading && !data) return <LoadingPanel />;
  return (
    <NewsroomView
      snapshot={data}
      loading={loading}
      day={day || data?.day || ""}
      onDay={setDay}
      onRefresh={refresh}
      onSetup={openSettings}
    />
  );
}

function BeatsTab() {
  // Beats change when you edit them, not on a timer, so this polls slowly and
  // takes the fresh snapshot every mutation already returns.
  const { data, loading, error, refresh, mutate } = useLiveData<BeatsSnapshot>(
    "/api/beats",
    10 * 60 * 1000,
  );
  if (error && !data) return <LiveLoadError error={error} retry={refresh} />;
  if (loading && !data) return <LoadingPanel />;
  return <BeatsView snapshot={data} loading={loading} onChanged={(next) => mutate(() => next)} />;
}

export function ControlCenter() {
  const [activeTab, setActiveTab] = useState<Tab>("today");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [settings, setSettings] = useState<PublicSettings>(emptySettings);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [toast, setToast] = useState("");
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [bootstrapStatus, setBootstrapStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [bootstrapError, setBootstrapError] = useState("");
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [workspaceSaveError, setWorkspaceSaveError] = useState("");
  const workspaceSaveQueue = useRef(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    window.queueMicrotask(() => {
      const requested = new URLSearchParams(window.location.search).get(
        "tab",
      ) as Tab | null;
      if (
        requested &&
        [...nav.map((item) => item.id), "settings"].includes(requested)
      )
        setActiveTab(requested);
    });
    const load = async () => {
      try {
        const [settingsResponse, workspaceResponse] = await Promise.all([
          fetch("/api/settings", { cache: "no-store" }),
          fetch("/api/workspace", { cache: "no-store" }),
        ]);
        if (!settingsResponse.ok)
          throw new Error(
            "Settings could not be read. Your saved configuration was not changed.",
          );
        if (!workspaceResponse.ok)
          throw new Error(
            "Tasks and reminders could not be read. Your saved workspace was not changed.",
          );
        const [loadedSettings, saved] = await Promise.all([
          settingsResponse.json() as Promise<PublicSettings>,
          workspaceResponse.json() as Promise<WorkspaceStateResponse>,
        ]);
        const recovery = readWorkspaceRecovery();
        const legacy: WorkspaceState = saved.legacyBrowserImportAllowed
          ? {
              reminders: readLegacyList<Reminder>("control-center-v2-reminders"),
              tasks: readLegacyList<Task>("control-center-v2-tasks"),
            }
          : { reminders: [], tasks: [] };
        let nextWorkspace: WorkspaceState = saved.initialized
          ? { reminders: saved.reminders, tasks: saved.tasks }
          : legacy;
        const canRecover = saved.initialized || saved.legacyBrowserImportAllowed;
        if (recovery && canRecover) nextWorkspace = recovery.workspace;
        if (!saved.initialized || (recovery && canRecover)) {
          const importResponse = await fetch("/api/workspace", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(nextWorkspace),
          });
          if (!importResponse.ok)
            throw new Error(
              "The first-run workspace could not be initialized. No local data was replaced.",
            );
          nextWorkspace = (await importResponse.json()) as WorkspaceState;
        }
        if (cancelled) return;
        setSettings(loadedSettings);
        setReminders(nextWorkspace.reminders);
        setTasks(nextWorkspace.tasks);
        setWorkspaceReady(true);
        setBootstrapStatus("ready");
      } catch (error) {
        if (cancelled) return;
        setBootstrapError(
          error instanceof Error
            ? error.message
            : "Control Center could not read its local data.",
        );
        setBootstrapStatus("error");
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [bootstrapAttempt]);
  useEffect(() => {
    if (!workspaceReady) return;
    const workspace = { reminders, tasks } satisfies WorkspaceState;
    const recovery: WorkspaceRecovery = {
      id: crypto.randomUUID(),
      savedAt: new Date().toISOString(),
      workspace,
    };
    try {
      window.localStorage.setItem(
        "control-center-v2-reminders",
        JSON.stringify(reminders),
      );
      window.localStorage.setItem(
        "control-center-v2-tasks",
        JSON.stringify(tasks),
      );
      window.localStorage.setItem(
        WORKSPACE_RECOVERY_KEY,
        JSON.stringify(recovery),
      );
    } catch {
      // The immediate SQLite write below remains canonical when browser storage is unavailable.
    }
    const save = async () => {
      const response = await fetch("/api/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(workspace),
      });
      if (!response.ok)
        throw new Error(
          "Tasks and reminders could not be saved to SQLite. Keep this page open and retry.",
        );
      try {
        if (readWorkspaceRecovery()?.id === recovery.id)
          window.localStorage.removeItem(WORKSPACE_RECOVERY_KEY);
      } catch {
        // A saved SQLite workspace does not depend on clearing the recovery copy.
      }
      setWorkspaceSaveError("");
    };
    workspaceSaveQueue.current = workspaceSaveQueue.current
      .then(save, save)
      .catch((error) => {
        setWorkspaceSaveError(
          error instanceof Error
            ? error.message
            : "Tasks and reminders could not be saved.",
        );
      });
  }, [reminders, tasks, workspaceReady]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const goTo = (tab: Tab) => {
    setActiveTab(tab);
    setMobileOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    if (tab !== "settings") url.searchParams.delete("section");
    window.history.replaceState({}, "", url);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const addReminder = (title: string, note: string, url?: string) => {
    let source = "Manual";
    if (url) {
      try {
        source = new URL(url).hostname.replace("www.", "");
      } catch {
        source = "Saved link";
      }
    }
    setReminders((values) => [
      {
        id: crypto.randomUUID(),
        type: url ? "Link" : "Saved",
        title,
        source,
        createdAt: new Date().toISOString(),
        note: note || "Saved for later.",
        accent: "teal",
        url,
      },
      ...values,
    ]);
    setToast("Saved to reminders");
  };
  const addBriefTask = (item: DailyBriefItem) => {
    const id = `brief:${item.id}`;
    if (tasks.some((task) => task.id === id)) {
      setToast("That brief item is already in tasks");
      return;
    }
    setTasks((values) => [
      {
        id,
        title: item.title,
        description:
          [item.source, item.summary, item.url].filter(Boolean).join(" · ") ||
          "Added from Daily Brief.",
        due: item.dueAt
          ? localDateValue(new Date(item.dueAt))
          : localDateValue(),
        recurrence: "One-time",
        priority: item.kind === "action" ? "High" : "Normal",
        done: false,
        createdAt: new Date().toISOString(),
      },
      ...values,
    ]);
    setToast("Added to tasks");
  };
  const openSettings = (section?: SettingsSection) => {
    const url = new URL(window.location.href);
    if (section) url.searchParams.set("section", section);
    url.searchParams.set("tab", "settings");
    window.history.replaceState({}, "", url);
    setActiveTab("settings");
    setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const configuredCount = [
    settings.industry.sources.length + settings.industry.keywords.length,
    settings.mentions.terms.length + settings.mentions.websites.length,
    newsletterSetupReady(settings) ? 1 : 0,
    settings.audience.accounts.length,
  ].filter(Boolean).length;
  const current = useMemo(
    () =>
      activeTab === "settings"
        ? "Settings"
        : nav.find((item) => item.id === activeTab)?.label,
    [activeTab],
  );

  if (bootstrapStatus === "loading")
    return (
      <div className="app-loading">
        <Activity />
        <span>Opening Control Center</span>
      </div>
    );
  if (bootstrapStatus === "error")
    return (
      <div className="app-recovery">
        <Panel className="recovery-panel">
          <CircleAlert size={30} />
          <p className="eyebrow">Local data protected</p>
          <h1>Control Center could not open safely</h1>
          <p>{bootstrapError}</p>
          <p>
            No settings, tasks, or reminders were overwritten. Retry the read,
            or run <code>npm run doctor</code> in the app folder for a local
            diagnostic.
          </p>
          <button
            className="button button-primary"
            onClick={() => {
              setBootstrapStatus("loading");
              setBootstrapError("");
              setWorkspaceReady(false);
              setBootstrapAttempt((value) => value + 1);
            }}
          >
            <RefreshCw size={15} /> Retry
          </button>
        </Panel>
      </div>
    );
  return (
    <div className="app-shell">
      <header className="topbar">
        <div
          className="brand-lockup"
          onClick={() => goTo("today")}
          role="button"
          tabIndex={0}
        >
          <span className="brand-mark">
            <Activity size={18} />
          </span>
          <span>
            <b>{settings.general.workspaceName.toUpperCase()}</b>
            <small>CONTROL CENTER</small>
          </span>
        </div>
        <button
          className="mobile-menu"
          onClick={() => setMobileOpen((value) => !value)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X /> : <Menu />}
        </button>
        <nav
          className={classNames("main-nav", mobileOpen && "is-open")}
          aria-label="Main navigation"
        >
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={activeTab === item.id ? "active" : ""}
                onClick={() => goTo(item.id)}
              >
                <Icon size={15} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="top-actions">
          <button className="status-button" onClick={() => openSettings()}>
            <i className={configuredCount === 4 ? "ready" : ""} />
            <span>{configuredCount}/4 live</span>
          </button>
          <button
            className="icon-button theme-toggle"
            onClick={toggleColorTheme}
            aria-label="Toggle color theme"
            title="Toggle color theme"
          >
            <Sun className="theme-icon-light" size={15} aria-hidden="true" />
            <Moon className="theme-icon-dark" size={15} aria-hidden="true" />
          </button>
          <button
            className={classNames(
              "avatar",
              activeTab === "settings" && "active",
            )}
            onClick={() => openSettings()}
            title="Settings"
          >
            <Settings2 size={15} />
          </button>
        </div>
      </header>
      <main key={activeTab}>
        {workspaceSaveError && (
          <div className="workspace-save-error" role="alert">
            <CircleAlert size={16} />
            <span>{workspaceSaveError}</span>
          </div>
        )}
        {activeTab === "today" && (
          <TodayView
            settings={settings}
            tasks={tasks}
            goTo={goTo}
            openSettings={openSettings}
            addBriefTask={addBriefTask}
          />
        )}{" "}
        {activeTab === "industry" && (
          <IndustryView
            saveStory={(story) =>
              addReminder(story.title, story.summary, story.url)
            }
            openSettings={() => openSettings("industry")}
          />
        )}{" "}
        {activeTab === "mentions" && (
          <MentionsView
            saveStory={(story) =>
              addReminder(story.title, story.summary, story.url)
            }
            openSettings={() => openSettings("mentions")}
          />
        )}{" "}
        {activeTab === "reminders" && (
          <RemindersView
            reminders={reminders}
            addReminder={addReminder}
            archiveReminder={(id, archived) =>
              setReminders((values) =>
                values.map((item) =>
                  item.id === id
                    ? {
                        ...item,
                        archivedAt: archived
                          ? new Date().toISOString()
                          : undefined,
                      }
                    : item,
                ),
              )
            }
          />
        )}{" "}
        {activeTab === "audience" && (
          <AudienceView openSettings={() => openSettings("audience")} />
        )}{" "}
        {activeTab === "newsletters" && (
          <NewslettersView
            addReminder={addReminder}
            openSettings={() => openSettings("newsletters")}
            openAiSettings={() => openSettings("ai")}
          />
        )}{" "}
        {activeTab === "tasks" && (
          <TasksView tasks={tasks} setTasks={setTasks} />
        )}{" "}
        {activeTab === "beats" && <BeatsTab />}
        {activeTab === "newsroom" && (
          <NewsroomTab openSettings={() => openSettings("pipeline")} />
        )}
        {activeTab === "pipeline" && (
          <PipelineTab openSettings={() => openSettings("pipeline")} />
        )}{" "}
        {activeTab === "settings" && (
          <SettingsView
            settings={settings}
            onSaved={(saved) => {
              clearLiveDataCache();
              setSettings(saved);
            }}
          />
        )}
      </main>
      <footer>
        <span>{settings.general.workspaceName}</span>
        <i />
        <span>{current}</span>
        <small>Local-only · Saved to this computer</small>
      </footer>
      {toast && (
        <div className="toast">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}
