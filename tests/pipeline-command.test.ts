import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

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

function pipelineRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "pipecmd-"));
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  return root;
}

function script(root: string, name: string, source: string) {
  const target = path.join(root, "scripts", name);
  writeFileSync(target, source);
  chmodSync(target, 0o755);
}

const settingsFor = (root: string) => ({ pipeline: { root, publicUrl: "" } }) as never;

test("only named actions can be run", async () => {
  const { isPipelineAction, PIPELINE_ACTIONS } = await import("../lib/server/pipeline-command");
  assert.equal(isPipelineAction("preflight"), true);
  // Nothing outside the table is reachable, so there is no argument to inject into.
  for (const attempt of ["rm", "../../bin/sh", "preflight; rm -rf /", "__proto__", "constructor", ""])
    assert.equal(isPipelineAction(attempt), false, attempt);
  for (const spec of Object.values(PIPELINE_ACTIONS))
    assert.ok(spec.script.startsWith("scripts/"), spec.script);
});

test("a command runs in the pipeline directory and returns its output", async () => {
  const { runPipelineCommand } = await import("../lib/server/pipeline-command");
  const root = pipelineRoot();
  // macOS resolves the temp directory through a symlink, so compare real paths.
  script(root, "llm_usage_report.py", 'import json, os\nprint(json.dumps({"cwd_ok": os.path.realpath(os.getcwd()) == os.path.realpath(os.environ["EXPECT_CWD"]), "calls": 7}))\n');
  process.env.EXPECT_CWD = root;
  const result = await runPipelineCommand(settingsFor(root), "usage");
  delete process.env.EXPECT_CWD;
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.json, { cwd_ok: true, calls: 7 });
  assert.ok(result.durationMs >= 0);
});

test("a failing command reports its exit code and stderr rather than throwing", async () => {
  const { runPipelineCommand } = await import("../lib/server/pipeline-command");
  const root = pipelineRoot();
  script(root, "preflight_routes.py", 'import sys\nsys.stderr.write("required route unhealthy\\n")\nsys.exit(1)\n');
  const result = await runPipelineCommand(settingsFor(root), "preflight");
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /required route unhealthy/);
});

test("a payload reaches the script on stdin, not through the argument vector", async () => {
  const { runPipelineCommand } = await import("../lib/server/pipeline-command");
  const root = pipelineRoot();
  script(root, "source_registry.py", 'import sys, json\nargv = sys.argv[1:]\npayload = json.loads(sys.stdin.read() or "{}")\nprint(json.dumps({"argv": argv, "payload": payload}))\n');
  const result = await runPipelineCommand(settingsFor(root), "sources-add", {
    kind: "x",
    value: "@newhandle; rm -rf /",
  });
  const output = result.json as { argv: string[]; payload: Record<string, string> };
  // The shell metacharacters arrive as data and never touch a command line.
  assert.deepEqual(output.argv, ["add"]);
  assert.equal(output.payload.value, "@newhandle; rm -rf /");
});

test("a missing script is reported instead of running something else", async () => {
  const { runPipelineCommand } = await import("../lib/server/pipeline-command");
  const root = pipelineRoot();
  const result = await runPipelineCommand(settingsFor(root), "backup");
  assert.equal(result.ok, false);
  assert.match(result.error || "", /not present in the pipeline directory/);
});

test("an unconfigured pipeline runs nothing", async () => {
  const { runPipelineCommand } = await import("../lib/server/pipeline-command");
  const result = await runPipelineCommand({ pipeline: { root: "", publicUrl: "" } } as never, "backup");
  assert.equal(result.ok, false);
  assert.match(result.error || "", /No pipeline directory is configured/);
});

test("output is capped so a runaway script cannot exhaust memory", async () => {
  const { runPipelineCommand } = await import("../lib/server/pipeline-command");
  const root = pipelineRoot();
  script(root, "hn_ingest.py", 'import sys\nsys.stdout.write("x" * 400000)\n');
  const result = await runPipelineCommand(settingsFor(root), "collect-hn");
  assert.ok(result.stdout.length <= 200_000, String(result.stdout.length));
});
