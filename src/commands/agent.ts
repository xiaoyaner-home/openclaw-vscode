import * as vscode from "vscode";
import { spawn } from "child_process";
import * as path from "path";
import * as os from "os";
import { log, logError, logWarn } from "../logger";
import { getConfig } from "../config";

/** Get PATH with common CLI install locations added */
function getEnhancedPath(): string {
  const home = os.homedir();
  const extra = [
    path.join(home, ".cursor", "bin"),
    path.join(home, ".local", "bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
  ];
  const current = process.env.PATH || "";
  return [...extra, current].join(path.delimiter);
}

export function getEnhancedEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: getEnhancedPath() };
}

interface AgentRunParams {
  prompt: string;
  mode?: "agent" | "plan" | "ask";
  model?: string;
  cwd?: string;
  timeoutMs?: number;
}

interface AgentRunResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
}

const MAX_OUTPUT = 200_000;

/** Detect if agent CLI is available */
async function detectAgentCli(): Promise<{ found: boolean; path: string; version?: string }> {
  const cfg = getConfig();
  const cliPath = cfg.agentCliPath || "agent";

  return new Promise((resolve) => {
    const child = spawn(cliPath, ["--version"], {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
      env: getEnhancedEnv(),
    });
    let out = "";
    child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ found: true, path: cliPath, version: out.trim() });
      } else {
        resolve({ found: false, path: cliPath });
      }
    });
    child.on("error", () => resolve({ found: false, path: cliPath }));
  });
}

/** Check agent CLI status — used by setup wizard and status commands */
export async function agentStatus(): Promise<{
  cliFound: boolean;
  cliPath: string;
  cliVersion?: string;
  isCursor: boolean;
}> {
  const isCursor = vscode.env.appName?.toLowerCase().includes("cursor") ?? false;
  const cli = await detectAgentCli();
  return {
    cliFound: cli.found,
    cliPath: cli.path,
    cliVersion: cli.version,
    isCursor,
  };
}

/** Resolve CLI path — if bare name, find full path via PATH lookup (needed for shell:false) */
async function resolveCliPath(name: string): Promise<string> {
  if (name.includes("/") || name.includes("\\")) return name; // already a path
  const { execFileSync } = require("child_process");
  try {
    const resolved = execFileSync(
      process.platform === "win32" ? "where" : "which",
      [name],
      { env: getEnhancedEnv(), encoding: "utf8", timeout: 3000 }
    ).trim().split("\n")[0];
    return resolved || name;
  } catch {
    return name; // fallback to bare name
  }
}

/** Run Cursor Agent CLI with a prompt */
export async function agentRun(params: AgentRunParams): Promise<AgentRunResult> {
  const cfg = getConfig();

  if (!cfg.agentEnabled) {
    throw new Error(
      "Agent integration is disabled. Enable it in OpenClaw Settings → Agent section."
    );
  }

  const cliPath = await resolveCliPath(cfg.agentCliPath || "agent");
  const mode = params.mode || cfg.agentDefaultMode || "agent";
  const model = params.model || cfg.agentDefaultModel || undefined;

  // Build command
  const args: string[] = ["--trust", "-p", params.prompt]; // --trust bypasses Workspace Trust prompt
  if (mode !== "agent") args.push(`--mode=${mode}`);
  if (model) args.push(`--model`, model);
  args.push("--output-format", "text");

  logWarn(`agent.run: mode=${mode} model=${model || "auto"} prompt="${params.prompt.slice(0, 80)}..."`);

  let cwd: string | undefined;
  if (params.cwd) {
    const path = require("path");
    const folders = vscode.workspace.workspaceFolders;
    cwd = folders ? path.resolve(folders[0].uri.fsPath, params.cwd) : undefined;
  } else {
    cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  const timeoutMs = params.timeoutMs ?? cfg.agentTimeoutMs ?? 300_000; // 5 min default

  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    let settled = false;

    const child = spawn(cliPath, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: getEnhancedEnv(),
    });

    const collect = (chunk: Buffer) => {
      if (output.length < MAX_OUTPUT) {
        output += chunk.toString("utf8").slice(0, MAX_OUTPUT - output.length);
      }
    };

    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGKILL"); } catch {}
    }, timeoutMs);

    const finalize = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      log(`agent.run done: exit=${exitCode} timedOut=${timedOut} output=${output.length} chars`);
      resolve({ exitCode, output, timedOut });
    };

    child.on("close", (code) => finalize(code));
    child.on("error", (err) => {
      logError(`agent.run error: ${err.message}`);
      finalize(null);
    });
  });
}

/** Show setup wizard if agent CLI is not configured */
export async function agentSetup(): Promise<{
  cliFound: boolean;
  isCursor: boolean;
  message: string;
}> {
  const status = await agentStatus();

  if (status.cliFound) {
    return {
      cliFound: true,
      isCursor: status.isCursor,
      message: `✅ Agent CLI found: ${status.cliPath} (${status.cliVersion || "unknown version"})`,
    };
  }

  // Show guided setup
  const installCmd = process.platform === "win32"
    ? "irm 'https://cursor.com/install?win32=true' | iex"
    : "curl https://cursor.com/install -fsSL | bash";

  const choice = await vscode.window.showInformationMessage(
    "Cursor Agent CLI not found. Install it to enable AI coding agent integration.",
    "Install Now",
    "Enter Path",
    "Later"
  );

  if (choice === "Install Now") {
    // Open terminal with install command
    const term = vscode.window.createTerminal("Install Cursor Agent");
    term.show();
    term.sendText(installCmd);
    return {
      cliFound: false,
      isCursor: status.isCursor,
      message: `Installing... Run the command in the terminal, then re-check with "OpenClaw: Agent Setup".`,
    };
  }

  if (choice === "Enter Path") {
    const path = await vscode.window.showInputBox({
      prompt: "Path to Cursor Agent CLI binary",
      placeHolder: "/usr/local/bin/agent",
    });
    if (path) {
      const cfg = vscode.workspace.getConfiguration("openclaw");
      await cfg.update("agent.cliPath", path, vscode.ConfigurationTarget.Global);
      return {
        cliFound: false,
        isCursor: status.isCursor,
        message: `Path saved. Restart or re-check to verify.`,
      };
    }
  }

  return {
    cliFound: false,
    isCursor: status.isCursor,
    message: "Agent CLI setup skipped. You can configure it later in OpenClaw Settings.",
  };
}
