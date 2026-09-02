import "server-only";

import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { resolveWithin } from "@/lib/server/pipeline";
import type { StoredSettings } from "@/lib/server/settings";

export type PipelineActionId =
  | "preflight"
  | "backup"
  | "backup-offsite"
  | "usage"
  | "sources-list"
  | "sources-add"
  | "collect-hn"
  | "collect-producthunt"
  | "collect-github"
  | "collect-feeds";

type ActionSpec = {
  label: string;
  script: string;
  args: string[];
  timeoutMs: number;
  /** Whether this action sends a JSON payload on stdin. */
  input?: boolean;
  destructive?: boolean;
};

/**
 * Every command this dashboard can run, named in full.
 *
 * The argument vector is fixed here rather than assembled from a request, so
 * there is nothing for a caller to inject into: the only variable input any
 * action accepts is a JSON payload on stdin, which the pipeline validates
 * itself. Nothing runs through a shell.
 */
export const PIPELINE_ACTIONS: Record<PipelineActionId, ActionSpec> = {
  preflight: { label: "Check model routes", script: "scripts/preflight_routes.py", args: ["--json"], timeoutMs: 120_000 },
  backup: { label: "Back up state", script: "scripts/backup_state.py", args: [], timeoutMs: 300_000 },
  "backup-offsite": { label: "Ship backup off-host", script: "scripts/backup_offsite.py", args: [], timeoutMs: 600_000 },
  usage: { label: "Model usage today", script: "scripts/llm_usage_report.py", args: ["--json"], timeoutMs: 60_000 },
  "sources-list": { label: "List sources", script: "scripts/source_registry.py", args: ["list"], timeoutMs: 30_000 },
  "sources-add": { label: "Add a source", script: "scripts/source_registry.py", args: ["add"], timeoutMs: 30_000, input: true },
  "collect-hn": { label: "Collect Hacker News", script: "scripts/hn_ingest.py", args: [], timeoutMs: 180_000 },
  "collect-producthunt": { label: "Collect Product Hunt", script: "scripts/ph_ingest.py", args: [], timeoutMs: 180_000 },
  "collect-github": { label: "Collect GitHub Trending", script: "scripts/github_trending_ingest.py", args: [], timeoutMs: 180_000 },
  "collect-feeds": { label: "Collect feeds", script: "scripts/web_ingest.py", args: [], timeoutMs: 180_000 },
};

export type PipelineCommandResult = {
  action: PipelineActionId;
  label: string;
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  json?: unknown;
  error?: string;
};

const MAX_OUTPUT = 200_000;

export function isPipelineAction(value: unknown): value is PipelineActionId {
  return typeof value === "string" && Object.hasOwn(PIPELINE_ACTIONS, value);
}

function tail(value: string) {
  return value.length > MAX_OUTPUT ? value.slice(-MAX_OUTPUT) : value;
}

export async function runPipelineCommand(
  settings: StoredSettings,
  action: PipelineActionId,
  payload?: unknown,
): Promise<PipelineCommandResult> {
  const spec = PIPELINE_ACTIONS[action];
  const started = Date.now();
  const base = { action, label: spec.label, durationMs: 0, stdout: "", stderr: "" };

  const root = settings.pipeline.root;
  if (!root)
    return { ...base, ok: false, exitCode: null, error: "No pipeline directory is configured." };

  let script: string;
  try {
    script = resolveWithin(root, spec.script);
    if (!statSync(script, { throwIfNoEntry: false })?.isFile())
      return { ...base, ok: false, exitCode: null, error: `${spec.script} is not present in the pipeline directory.` };
  } catch (error) {
    return { ...base, ok: false, exitCode: null, error: error instanceof Error ? error.message : "Invalid pipeline path." };
  }

  const body = spec.input ? JSON.stringify(payload ?? {}) : undefined;

  return await new Promise<PipelineCommandResult>((resolve) => {
    const child = execFile(
      "python3",
      [script, ...spec.args],
      {
        cwd: root,
        timeout: spec.timeoutMs,
        maxBuffer: MAX_OUTPUT * 2,
        // The pipeline resolves its own configuration from the environment it
        // is deployed with; this only adds the interpreter path it needs.
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - started;
        const code = (error as NodeJS.ErrnoException & { code?: number })?.code;
        const exitCode = typeof code === "number" ? code : error ? null : 0;
        let parsed: unknown;
        try { parsed = stdout.trim() ? JSON.parse(stdout) : undefined; } catch { parsed = undefined; }
        resolve({
          action,
          label: spec.label,
          ok: !error,
          exitCode,
          durationMs,
          stdout: tail(stdout),
          stderr: tail(stderr),
          json: parsed,
          ...(error && !stderr ? { error: error.message } : {}),
        });
      },
    );
    if (body !== undefined) {
      child.stdin?.end(body);
    }
  });
}
