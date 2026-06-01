/**
 * Herdr + Pi integration tests using Node test runner.
 * Each test is fully isolated: starts its own server, cleans up after itself.
 * Uses polling instead of fixed sleeps to minimise wait time.
 *
 * Run: devenv shell -- node --experimental-strip-types --test --test-timeout 30000 src/tests.ts
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

const projectRoot = resolve(import.meta.dirname!, "..");
const cacheDir = resolve(projectRoot, "node_modules/.cache/herdr-tests");
const resumeMarker = resolve(projectRoot, ".devenv/state/herdr/resume-session");

// Ensure no stale resume marker from previous runs
try { unlinkSync(resumeMarker); } catch {}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function freshState() {
  const name = randomBytes(4).toString("hex");
  const dir = resolve(cacheDir, name);
  mkdirSync(dir, { recursive: true });
  return {
    dir,
    socket: resolve(dir, "herdr.sock"),
    log: resolve(dir, "herdr-server.log"),
  };
}

type Server = Awaited<ReturnType<typeof startServer>>;

async function startServer() {
  // Clean any stale resume marker from previous runs within this process
  try { unlinkSync(resumeMarker); } catch {}

  const state = freshState();
  const env = {
    ...process.env,
    HERDR_ENV: "1",
    HERDR_CONFIG_PATH: resolve(projectRoot, ".herdr.toml"),
    HERDR_SOCKET_PATH: state.socket,
    HERDR_PANE_ID: "",  // Set by herdr per pane, extension will fill in
    // Isolate herdr logs/state.
    XDG_CONFIG_HOME: state.dir,
    // Use bizon provider (the local LLM)
    PI_HERDR_PROVIDER: "bizon",
    PI_HERDR_MODEL: "MiniMax-M2.7",
  };

  const proc = spawn("herdr", ["server"], {
    cwd: projectRoot,
    env,
    detached: true,
    stdio: "ignore",
  });
  proc.unref();

  // Poll for socket (max 8s)
  for (let i = 0; i < 80; i++) {
    await sleep(100);
    if (existsSync(state.socket)) break;
  }
  if (!existsSync(state.socket)) throw new Error("socket not created after 8s");

  return {
    state,
    env,
    stop: async () => {
      try { await herdr(env, "server stop"); } catch {}
      try { proc.kill("SIGTERM"); } catch {}
      await sleep(500);
      try { rmSync(state.dir, { recursive: true, force: true }); } catch {}
    },
  };
}

async function herdr(env: NodeJS.ProcessEnv, args: string): Promise<string> {
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  return (await promisify(exec)(`herdr ${args}`, { env })).stdout;
}

async function tailLog(path: string, n: number): Promise<string> {
  try {
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    return (await promisify(exec)(`tail -${n} "${path}"`)).stdout;
  } catch { return ""; }
}

/** Create workspace and return its pane IDs. */
async function createWorkspace(env: NodeJS.ProcessEnv) {
  const out = await herdr(env, "workspace create --label test");
  const wm = out.match(/"workspace_id":"([^"]+)"/);
  assert.ok(wm, "no workspace_id in create response");
  const workspaceId = wm![1];

  // Poll briefly for the pane to appear and pi to spawn
  for (let i = 0; i < 10; i++) {
    await sleep(500);
    const list = await herdr(env, "pane list");
    const pm = list.match(/"pane_id":"([^"]+)"/);
    if (pm) return { workspaceId, paneId: pm[1] };
  }
  assert.fail("no pane appeared within 5s");
}

async function sendPrompt(env: NodeJS.ProcessEnv, paneId: string, text: string) {
  await herdr(env, `pane send-text "${paneId}" "${text}"`);
  await sleep(300);
  await herdr(env, `pane send-keys "${paneId}" enter`);
}

/** Poll until pane output matches regex. Returns the last output if matched, null on timeout. */
async function pollOutput(
  env: NodeJS.ProcessEnv,
  paneId: string,
  regex: RegExp,
  timeoutMs: number,
  pollMs = 300,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const out = await herdr(env, `pane read "${paneId}" --lines 20`);
    if (regex.test(out)) return out;
    await sleep(pollMs);
  }
  return null;
}

/** Check pane output contains dates */
function hasDates(output: string | null): boolean {
  if (!output) return false;
  return /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/.test(output) || /\d{4}/.test(output);
}

// ── Suite: Environment ──────────────────────────────────────────────────────

describe("Environment", () => {
  it("HERDR_CONFIG_PATH is set", () => assert.ok(process.env.HERDR_CONFIG_PATH));
  it("HERDR_SOCKET_PATH is set", () => assert.ok(process.env.HERDR_SOCKET_PATH));
  it("XDG_CONFIG_HOME is set", () => assert.ok(process.env.XDG_CONFIG_HOME));
});

// ── Suite: Configuration ────────────────────────────────────────────────────

describe("Configuration", () => {
  it("herdr config has default_shell = pi-herdr", () => {
    const cfg = process.env.HERDR_CONFIG_PATH!;
    assert.ok(existsSync(cfg));
    assert.ok(readFileSync(cfg, "utf-8").includes('default_shell = "pi-herdr"'));
  });
  it("extension source exists", () => assert.ok(existsSync(resolve(projectRoot, "src/index.ts"))));
  it("local pi binary exists", () => assert.ok(existsSync(resolve(projectRoot, "node_modules/.bin/pi"))));
});

// ── Suite: Server ───────────────────────────────────────────────────────────

describe("Server", () => {
  it("starts, creates workspace, pi registers", async () => {
    const srv = await startServer();
    try {
      const { workspaceId, paneId } = await createWorkspace(srv.env);
      assert.ok(workspaceId.length > 0);
      assert.ok(paneId.length > 0);
    } finally {
      await srv.stop();
    }
  });

  it("pi pane does not crash (no exit code 1)", async () => {
    const srv = await startServer();
    try {
      await createWorkspace(srv.env);
      // Give pi a moment to fully settle
      await sleep(2000);
      const log = await tailLog(srv.state.log, 20);
      const crashed = log.includes("pane child exited") && log.includes('code: 1');
      assert.ok(!crashed, "pane exited code 1");
    } finally {
      await srv.stop();
    }
  });

  it("pi pane stays alive", async () => {
    const srv = await startServer();
    try {
      await createWorkspace(srv.env);
      await sleep(4000);
      const log = await tailLog(srv.state.log, 20);
      assert.ok(!log.includes("pane child exited"), "pane exited");
    } finally {
      await srv.stop();
    }
  });
});

// ── Suite: /bg command ──────────────────────────────────────────────────────

describe("/bg command", () => {
  it("creates a new herdr tab", async () => {
    const srv = await startServer();
    try {
      const { paneId, workspaceId } = await createWorkspace(srv.env);

      // Count panes and tabs before
      const beforeList = await herdr(srv.env, "pane list");
      const beforeCount = (beforeList.match(/"pane_id":/g) || []).length;

      // Send /bg directly (no LLM) — it always creates a tab
      await sendPrompt(srv.env, paneId, "/bg");
      await sleep(8000);  // Give pi time to process /bg and create tab

      // Read pane output to see what happened
      const paneOut = await herdr(srv.env, `pane read "${paneId}" --lines 30`);
      const tabList = await herdr(srv.env, `tab list --workspace "${workspaceId}"`);
      const tabCount = (tabList.match(/"tab_id":/g) || []).length;
      assert.ok(tabCount >= 2,
        `expected >=2 tabs, got ${tabCount}. pane output:\n${paneOut}\ntab list:\n${tabList}`);

      // Original pane should still exist
      const afterList = await herdr(srv.env, "pane list");
      assert.ok(afterList.includes(paneId), "original pane disappeared");
    } finally {
      await srv.stop();
    }
  });

  it("backgrounds a pane while it's busy running a script", async () => {
    const srv = await startServer();
    try {
      const { paneId } = await createWorkspace(srv.env);

      await sendPrompt(
        srv.env,
        paneId,
        "Run this bash command: while true; do date; sleep 1; done"
      );

      const out = await pollOutput(
        srv.env, paneId,
        /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b|\d{4}/,
        30000,
      );
      assert.ok(hasDates(out), "LLM did not execute the date command within 30s");

      // Background the running task
      await sendPrompt(srv.env, paneId, "/bg");
      await sleep(2000);

      // Original pane must still be printing dates
      const after = await pollOutput(
        srv.env, paneId,
        /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b|\d{4}/,
        10000,
      );
      assert.ok(hasDates(after), "original pane stopped — /bg killed the task");
    } finally {
      await srv.stop();
    }
  });
});
