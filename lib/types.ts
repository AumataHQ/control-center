export type IndustrySource = {
  id: string;
  name: string;
  url: string;
};

export type AiProvider = "none" | "openai" | "anthropic" | "gemini" | "xai" | "gateway" | "lmstudio" | "ollama";
export type AiKeyProvider = Exclude<AiProvider, "none">;
export type LocalAiProvider = Extract<AiKeyProvider, "lmstudio" | "ollama">;
/**
 * A private, OpenAI-compatible model gateway on the operator's own network.
 * Its model ids are role aliases (for example `signalscribe-reporter`) that the
 * gateway resolves to an upstream session, so this dashboard never names a model.
 */
export type GatewayAiProvider = Extract<AiKeyProvider, "gateway">;

/** Background jobs that can be pinned to a specific model or gateway route. */
export const AI_JOBS = [
  "industry-rerank",
  "mention-research",
  "mention-summary",
  "newsletter-extract",
  "newsletter-consolidate",
  "newsletter-priority",
] as const;
export type AiJob = (typeof AI_JOBS)[number];
export type AiModelOption = {
  id: string;
  label: string;
  /** Actual loaded capacity, never the model's theoretical maximum. */
  contextLength?: number;
};
export type AiModelsResponse = {
  provider: AiProvider;
  models: AiModelOption[];
  defaultModel: string;
  checkedAt: string;
  cached: boolean;
  localOnly: boolean;
  error?: string;
};

export type AudiencePlatform =
  | "youtube"
  | "x"
  | "instagram"
  | "facebook"
  | "linkedin"
  | "threads"
  | "tiktok";

export type AudienceAccountInput = {
  id: string;
  platform: AudiencePlatform;
  label: string;
  username: string;
  accountId: string;
  profileUrl: string;
  credential?: string;
  credentialSet?: boolean;
  clearCredential?: boolean;
};

export type PublicSettings = {
  general: {
    workspaceName: string;
  };
  industry: {
    sources: IndustrySource[];
    keywords: string[];
    description: string;
    excludedTerms: string[];
    dailyLimit: number;
  };
  mentions: {
    terms: string[];
    websites: string[];
    identityAnchors: string[];
    negativeTerms: string[];
    strictMode: boolean;
    excludeOwnedSites: boolean;
  };
  newsletters: {
    googleClientId: string;
    googleClientSecretSet: boolean;
    connected: boolean;
    connectedEmail: string;
    gmailQuery: string;
  };
  audience: {
    accounts: AudienceAccountInput[];
  };
  ai: {
    provider: AiProvider;
    model: string;
    localBaseUrls: Record<LocalAiProvider, string>;
    gatewayBaseUrl: string;
    /** Per-job model override; an absent or empty entry uses the default model. */
    jobModels: Partial<Record<AiJob, string>>;
    keySet: Record<AiKeyProvider, boolean>;
    keySource: Record<AiKeyProvider, "none" | "settings" | "environment">;
  };
  dailyBrief: {
    sourceLabels: string[];
    lookbackDays: number;
    sections: { industry: number; mentions: number; newsletters: number };
  };
  /**
   * An optional publication pipeline this dashboard observes. The pipeline runs
   * itself; this is a read-only operator view over the artifacts it writes.
   */
  pipeline: {
    root: string;
    publicUrl: string;
  };
};

export type PipelineEdition = {
  date: string;
  title: string;
  format: "html" | "markdown";
  isToday: boolean;
  writerModel?: string;
};

export type PipelineCheck = {
  name: string;
  ok: boolean;
  detail?: string;
};

export type PipelineRunAttempt = {
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  status: string;
};

export type PipelineSourceState = {
  name: string;
  category: "sources" | "dependencies";
  state: string;
  detail?: string;
  checkedAt?: string;
};

export type PipelineRouteUsage = {
  route: string;
  calls: number;
  ok: number;
  failed: number;
  totalTokens: number;
  averageLatencyMs: number;
  outcomes: Record<string, number>;
};

export type PipelineUsage = {
  day: string;
  calls: number;
  ok: number;
  failed: number;
  retriedAttempts: number;
  totalTokens: number;
  routes: PipelineRouteUsage[];
  roles: { role: string; calls: number; totalTokens: number }[];
};

export type PipelineRoutePreflight = {
  route: string;
  role: string;
  ok: boolean;
  required: boolean;
  kind?: string;
  detail?: string;
};

export type PipelineSnapshot = {
  configured: boolean;
  rootReadable: boolean;
  day: string;
  publicUrl?: string;
  error?: string;
  editions: PipelineEdition[];
  latestEdition?: PipelineEdition;
  publication?: {
    day?: string;
    ready?: boolean;
    writerModel?: string;
    checks: PipelineCheck[];
    passed: number;
    failed: number;
  };
  run?: { status: string; attempts: PipelineRunAttempt[] };
  sources: PipelineSourceState[];
  preflight?: { ok: boolean; reachable: boolean; checkedAt?: string; routes: PipelineRoutePreflight[] };
  usage?: PipelineUsage;
  radar?: { counts: Record<string, number>; enabled: number; disabled: number };
  /** This dashboard's own model calls, recorded locally rather than read from the pipeline. */
  dashboardUsage?: {
    since: string;
    calls: number;
    ok: number;
    failed: number;
    rows: { provider: string; model: string; job: string; calls: number; ok: number; failed: number; averageLatencyMs: number }[];
  };
  profile?: { lanes: string[]; painPoints: string[]; weights: Record<string, number> };
};

/**
 * The newsroom: what the publication considered on a given day, and what became
 * of each candidate. The pipeline records this on every run, published or not.
 */
export type NewsroomDisposition = "selected" | "quarantined" | "also_noted";

export type NewsroomFetch = {
  /** The link that was fetched on this candidate's behalf. */
  url: string;
  ok: boolean;
  error?: string;
};

export type NewsroomCandidate = {
  candidateId: string;
  source: string;
  title: string;
  url: string;
  score: number;
  disposition: NewsroomDisposition;
  /** Why it was withheld, when it was. */
  reason?: string;
  mergedCount: number;
  mergedSources: string[];
  /** First-party sources that were verified, for a candidate that was kept. */
  primaryUrls: string[];
  /** Every fetch attempted for this candidate, joined from the research receipt. */
  fetches: NewsroomFetch[];
  /** The headline it was published under, when it reached the page. */
  headline?: string;
};

export type NewsroomSourceTally = {
  source: string;
  considered: number;
  selected: number;
  quarantined: number;
  alsoNoted: number;
};

export type NewsroomSnapshot = {
  configured: boolean;
  rootReadable: boolean;
  day: string;
  error?: string;
  /** False when no brief artifact exists for this day at all. */
  available: boolean;
  /**
   * True when the day carries a recorded trail. Editions written before the
   * trail existed are reconstructed from what their artifact does hold, which
   * is less than the whole picture — the UI must not present the two as equal.
   */
  complete: boolean;
  generatedAt?: string;
  writer?: string;
  writerModel?: string;
  publicationState?: string;
  reason?: string;
  counts: {
    considered: number;
    selected: number;
    quarantined: number;
    alsoNoted: number;
    published: number;
  };
  research?: { attempted: number; succeeded: number; failed: number };
  tallies: NewsroomSourceTally[];
  candidates: NewsroomCandidate[];
  /** Days with a readable brief artifact, newest first. */
  days: string[];
};

export type SettingsUpdate = Omit<
  PublicSettings,
  "newsletters" | "audience" | "industry" | "mentions" | "ai"
> & {
  industry: Omit<PublicSettings["industry"], "description" | "excludedTerms" | "dailyLimit"> &
    Partial<Pick<PublicSettings["industry"], "description" | "excludedTerms" | "dailyLimit">>;
  mentions: Omit<PublicSettings["mentions"], "negativeTerms" | "excludeOwnedSites"> &
    Partial<Pick<PublicSettings["mentions"], "negativeTerms" | "excludeOwnedSites">>;
  newsletters: PublicSettings["newsletters"] & {
    googleClientSecret?: string;
  };
  audience: {
    accounts: AudienceAccountInput[];
  };
  pipeline?: { root?: string; publicUrl?: string };
  ai?: {
    provider: AiProvider;
    model: string;
    localBaseUrls?: Partial<Record<LocalAiProvider, string>>;
    gatewayBaseUrl?: string;
    jobModels?: Partial<Record<AiJob, string>>;
    apiKeys?: Partial<Record<AiKeyProvider, string>>;
    clearKeys?: AiKeyProvider[];
  };
};

export type ContentWorkflow = {
  archiveReason: "user" | "expired" | "not-current";
  archivedAt?: string;
  restoreEligible: boolean;
};

export type LiveStory = {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string;
  discoveredAt?: string;
  lastModifiedAt?: string;
  matchedTerm?: string;
  kind?: "feed" | "sitemap" | "topic" | "mention";
  confidence?: "high" | "medium";
  matchReasons?: string[];
  importanceScore?: number;
  importanceReason?: string;
  aiSummary?: string;
  curationMode?: "local" | AiKeyProvider;
  collectionScope?: string;
  workflow?: ContentWorkflow;
};

export type IndustrySourceStatus = {
  sourceId: string;
  source: string;
  mode: "feed" | "sitemap" | "topics";
  endpoint: string;
  state: "live" | "baseline" | "unchanged" | "changed";
  message: string;
};

export type LiveFeedResponse = {
  configured: boolean;
  checkedAt: string;
  items: LiveStory[];
  errors: string[];
  sourceStatuses?: IndustrySourceStatus[];
  filteredOut?: number;
  reviewCount?: number;
  windowDays?: number;
  providerStatuses?: Array<{
    provider: string;
    state: "live" | "degraded" | "disabled";
    message: string;
  }>;
  freshnessHours?: number;
  discoveredCount?: number;
  surfacedLimit?: number;
  curationMode?: "local" | AiKeyProvider;
  archivedItems?: LiveStory[];
  archiveCount?: number;
  historyItems?: LiveStory[];
  historyCount?: number;
};

export type NewsletterFeedResponse = {
  configured: boolean;
  connected: boolean;
  aiConfigured?: boolean;
  aiProvider?: AiKeyProvider;
  curationMode?: "local" | AiKeyProvider;
  checkedAt: string;
  items: NewsletterTopic[];
  archivedItems: NewsletterTopic[];
  archiveCount: number;
  historyItems?: NewsletterTopic[];
  historyCount?: number;
  freshnessHours?: number;
  errors: string[];
  issueCount?: number;
  mentionCount?: number;
  newsletterCount?: number;
  newIssueCount?: number;
  pendingIssueCount?: number;
};

export type AudiencePrimaryMetric = "followers" | "subscribers" | "page likes";

export type AudienceMetric = {
  id: string;
  platform: AudiencePlatform;
  label: string;
  handle: string;
  total: number | null;
  change: number | null;
  changeComparedAt?: string;
  primaryLabel?: AudiencePrimaryMetric;
  secondaryLabel?: string;
  secondaryValue?: number;
  checkedAt: string;
  error?: string;
  source?: string;
  stale?: boolean;
  lastSuccessfulAt?: string;
};

export type NewsletterItem = {
  id: string;
  sender: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  gmailUrl: string;
  workflow?: ContentWorkflow;
};

export type NewsletterSourceLink = {
  url: string;
  title: string;
  publisher: string;
};

export type NewsletterTopic = {
  id: string;
  kind: "newsletter-topic";
  title: string;
  summary: string;
  importanceScore?: number;
  importanceBaseScore?: number;
  importanceReason?: string;
  curationMode?: "local" | AiKeyProvider;
  receivedAt: string;
  url: string;
  gmailUrl: string;
  coverageCount: number;
  newsletterCount: number;
  newsletterSources: string[];
  evidenceIssueIds?: string[];
  sourceLinks: NewsletterSourceLink[];
  collectionScope: string;
  workflow?: ContentWorkflow;
};

export type ReminderItem = {
  id: string | number;
  type: string;
  title: string;
  source: string;
  note: string;
  accent: string;
  url?: string;
  createdAt?: string;
  archivedAt?: string;
  added?: string;
};

export type TaskItem = {
  id: string | number;
  title: string;
  description: string;
  due: string;
  recurrence: string;
  priority: string;
  done: boolean;
  createdAt?: string;
  completedAt?: string;
  seriesId?: string | number;
  recurrenceAnchorDay?: number;
};

export type WorkspaceState = {
  reminders: ReminderItem[];
  tasks: TaskItem[];
};

export type WorkspaceStateResponse = WorkspaceState & {
  initialized: boolean;
  legacyBrowserImportAllowed: boolean;
};

export type DailyBriefItem = {
  id: string;
  source: string;
  title: string;
  summary: string;
  kind: "action" | "meeting" | "message" | "info";
  occurredAt: string;
  dueAt?: string;
  url?: string;
  syncedAt: string;
};

export type DailyBriefResponse = {
  configured: boolean;
  checkedAt: string;
  items: DailyBriefItem[];
  snapshot?: DailyBriefSnapshotSection[];
  sourceStatuses: Array<{
    source: string;
    lastSyncedAt: string;
    lastAttemptAt: string;
    itemCount: number;
    state: "waiting" | "live" | "error";
    message: string;
  }>;
};

export type BriefCategory = "industry" | "mentions" | "newsletters";
export type DailyBriefSnapshotSection = {
  category: BriefCategory;
  requestedCount: number;
  availableCount: number;
  checkedAt: string;
  configured: boolean;
  stale: boolean;
  items: Array<{ id: string; title: string; summary: string; url: string; source: string; importanceScore?: number }>;
};
