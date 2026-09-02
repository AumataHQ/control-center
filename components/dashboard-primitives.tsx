"use client";

/**
 * Pieces every dashboard view shares: layout shells, the polling data hook, the
 * archive helper, and the small formatting utilities. Extracted so a view can be
 * read — and changed — without scrolling past everything else in the app.
 */

import { useEffect, useState } from "react";
import { CircleAlert, Plus, RefreshCw, Settings2, X } from "lucide-react";
import type { CachedFeedPayload } from "@/lib/live-response";
import type { AudiencePlatform, WorkspaceState } from "@/lib/types";
import { SettingsInput } from "@/components/settings-input";
import { applyArchiveToPayload } from "@/lib/live-response";

export function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}
export function Panel({
  children,
  className = "",
  ...props
}: React.ComponentPropsWithoutRef<"section">) {
  return (
    <section className={`panel ${className}`} {...props}>
      {children}
    </section>
  );
}
export function Label({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <span
      className={classNames(
        "label",
        tone && `label-${tone.toLowerCase().replaceAll(" ", "-")}`,
      )}
    >
      {children}
    </span>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading reveal">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  const difference = Date.now() - date.getTime();
  if (difference < 60 * 60 * 1000)
    return `${Math.max(1, Math.round(difference / 60_000))} min ago`;
  if (difference < 24 * 60 * 60 * 1000)
    return `${Math.round(difference / 3_600_000)} hr ago`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: Math.abs(value) >= 100_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export function localDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatTaskDue(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
}

export function isTaskDueToday(value: string) {
  return value === "Today" || value === localDateValue();
}

export function readLegacyList<T>(key: string): T[] {
  try {
    const value = window.localStorage.getItem(key);
    if (!value) return [];
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export const WORKSPACE_RECOVERY_KEY = "control-center-v3-workspace-recovery";
const THEME_STORAGE_KEY = "control-center-theme";

export function toggleColorTheme() {
  const root = document.documentElement;
  const nextTheme = root.dataset.theme === "light" ? "dark" : "light";
  root.dataset.theme = nextTheme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  } catch {
    // The selected theme still applies for this session when storage is unavailable.
  }
}

export type WorkspaceRecovery = {
  id: string;
  savedAt: string;
  workspace: WorkspaceState;
};

export function readWorkspaceRecovery(): WorkspaceRecovery | null {
  try {
    const value = window.localStorage.getItem(WORKSPACE_RECOVERY_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<WorkspaceRecovery>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.savedAt !== "string" ||
      !parsed.workspace ||
      !Array.isArray(parsed.workspace.reminders) ||
      !Array.isArray(parsed.workspace.tasks)
    ) return null;
    return parsed as WorkspaceRecovery;
  } catch {
    return null;
  }
}

export function SetupEmpty({
  icon,
  title,
  description,
  onSetup,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onSetup: () => void;
}) {
  return (
    <Panel className="empty-state setup-empty">
      <div className="setup-empty-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{description}</p>
      <button className="button button-primary" onClick={onSetup}>
        <Settings2 size={15} /> Open settings
      </button>
    </Panel>
  );
}

export function ErrorNotice({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <div className="error-notice">
      <CircleAlert size={17} />
      <div>
        <b>Some sources could not be read</b>
        {errors.map((error) => (
          <p key={error}>{error}</p>
        ))}
      </div>
    </div>
  );
}

const liveDataCache = new Map<string, unknown>();

export function clearLiveDataCache() {
  liveDataCache.clear();
}

export function useLiveData<T>(
  endpoint: string,
  refreshEveryMs = 15 * 60 * 1000,
  manualEndpoint = endpoint,
) {
  const initialData = liveDataCache.get(endpoint) as T | undefined;
  const [data, setData] = useState<T | null>(initialData || null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const load = async (requestEndpoint = endpoint) => {
      setLoading(true);
      try {
        const response = await fetch(requestEndpoint, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok)
          throw new Error(
            payload.errors?.[0] || payload.error || "Live data request failed.",
          );
        if (!cancelled) {
          setData(payload as T);
          liveDataCache.set(endpoint, payload as T);
          setError("");
        }
      } catch (requestError) {
        if (!cancelled)
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Live data request failed.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    if (nonce > 0) void load(manualEndpoint);
    else void load(endpoint);
    const interval = window.setInterval(
      () => void load(manualEndpoint),
      refreshEveryMs,
    );
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [endpoint, manualEndpoint, nonce, refreshEveryMs]);
  return {
    data,
    loading,
    error,
    refresh: () => setNonce((value) => value + 1),
    mutate: (updater: (current: T) => T) =>
      setData((current) => {
        if (!current) return current;
        const next = updater(current);
        liveDataCache.set(endpoint, next);
        return next;
      }),
  };
}

export function LoadingPanel() {
  return (
    <Panel className="empty-state">
      <RefreshCw className="spin" size={24} />
      <h2>Checking live sources</h2>
      <p>This can take a few seconds when several providers are configured.</p>
    </Panel>
  );
}

export function LiveLoadError({ error, retry }: { error: string; retry: () => void }) {
  return (
    <Panel className="empty-state error-state" role="alert">
      <CircleAlert size={26} />
      <h2>Live data could not be loaded</h2>
      <p>{error}</p>
      <button className="button button-primary" onClick={retry}>
        <RefreshCw size={15} /> Retry
      </button>
    </Panel>
  );
}

export function useArchiveAction<T extends CachedFeedPayload>(
  category: "industry" | "mentions" | "newsletters",
  mutate: (updater: (current: T) => T) => void,
) {
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const update = async (id: string, archived: boolean) => {
    setPending(id);
    setError("");
    try {
      const response = await fetch("/api/library", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, id, archived }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "Could not update the archive.");
      liveDataCache.delete("/api/brief");
      mutate((current) => applyArchiveToPayload(current, id, archived));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not update the archive.",
      );
    } finally {
      setPending("");
    }
  };
  return { pending, error, update };
}

export function TagEditor({
  label,
  help,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  help: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  const [value, setValue] = useState("");
  const add = () => {
    const cleaned = value.trim();
    if (!cleaned || values.includes(cleaned)) return;
    onChange([...values, cleaned]);
    setValue("");
  };
  return (
    <div className="settings-field">
      <label>
        {label}
        <small>{help}</small>
      </label>
      <div className="tag-input">
        <SettingsInput
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
        />
        <button type="button" onClick={add}>
          <Plus size={15} /> Add
        </button>
      </div>
      <div className="tag-list">
        {values.map((item) => (
          <span key={item}>
            {item}
            <button
              type="button"
              aria-label={`Remove ${item}`}
              onClick={() =>
                onChange(values.filter((valueItem) => valueItem !== item))
              }
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}


export function profilePlaceholder(platform: AudiencePlatform) {
  return {
    youtube: "https://youtube.com/@your-handle",
    x: "https://x.com/your-handle",
    instagram: "https://instagram.com/your-handle",
    facebook: "https://facebook.com/your-page",
    linkedin: "https://linkedin.com/in/your-name",
    threads: "https://threads.net/@your-handle",
    tiktok: "https://tiktok.com/@your-handle",
  }[platform];
}
