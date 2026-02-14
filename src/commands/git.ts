import * as vscode from "vscode";
import { log } from "../logger";
import { spawn } from "child_process";

// ─── Helpers ───

const MAX_OUTPUT = 200_000;

function getCwd(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) throw new Error("No workspace folder open");
  return folders[0].uri.fsPath;
}

function runGit(args: string[], cwd: string, timeoutMs = 30_000): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.toString("utf8").slice(0, MAX_OUTPUT - stdout.length);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.toString("utf8").slice(0, MAX_OUTPUT - stderr.length);
    });

    const timer = setTimeout(() => {
      if (!settled) { settled = true; try { child.kill("SIGKILL"); } catch {} resolve({ exitCode: null, stdout, stderr: stderr + "\n[TIMEOUT]" }); }
    }, timeoutMs);

    child.on("close", (code) => {
      if (!settled) { settled = true; clearTimeout(timer); resolve({ exitCode: code, stdout, stderr }); }
    });
    child.on("error", (err) => {
      if (!settled) { settled = true; clearTimeout(timer); resolve({ exitCode: null, stdout, stderr: err.message }); }
    });
  });
}

// ─── git.status ───

export async function gitStatus(): Promise<{
  branch: string;
  staged: string[];
  modified: string[];
  untracked: string[];
  ahead: number;
  behind: number;
}> {
  const cwd = getCwd();

  const [branchResult, statusResult] = await Promise.all([
    runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
    runGit(["status", "--porcelain=v1", "-b"], cwd),
  ]);

  const branch = branchResult.stdout.trim();
  const lines = statusResult.stdout.split("\n").filter(Boolean);

  let ahead = 0, behind = 0;
  const staged: string[] = [];
  const modified: string[] = [];
  const untracked: string[] = [];

  for (const line of lines) {
    if (line.startsWith("##")) {
      const m = line.match(/\[ahead (\d+)(?:, behind (\d+))?\]/);
      if (m) { ahead = parseInt(m[1]); behind = parseInt(m[2] ?? "0"); }
      const m2 = line.match(/\[behind (\d+)\]/);
      if (!m && m2) { behind = parseInt(m2[1]); }
      continue;
    }
    const x = line[0], y = line[1];
    const file = line.slice(3);
    if (x === "?" && y === "?") { untracked.push(file); }
    else if (x !== " " && x !== "?") { staged.push(file); }
    if (y !== " " && y !== "?") { modified.push(file); }
  }

  log(`git.status: ${branch} (+${ahead}/-${behind}), ${staged.length} staged, ${modified.length} modified, ${untracked.length} untracked`);
  return { branch, staged, modified, untracked, ahead, behind };
}

// ─── git.diff ───

interface GitDiffParams {
  path?: string;
  staged?: boolean;
  ref?: string; // e.g. "HEAD~1", "main"
}

export async function gitDiff(params: GitDiffParams): Promise<{ diff: string }> {
  const cwd = getCwd();
  const args = ["diff"];
  if (params.staged) args.push("--staged");
  if (params.ref) args.push(params.ref);
  args.push("--");
  if (params.path) args.push(params.path);

  const result = await runGit(args, cwd);
  log(`git.diff: ${params.path ?? "all"} (staged=${params.staged ?? false}) → ${result.stdout.length} chars`);
  return { diff: result.stdout };
}

// ─── git.log ───

interface GitLogParams {
  limit?: number;
  path?: string;
  oneline?: boolean;
}

export async function gitLog(params: GitLogParams): Promise<{ log: string }> {
  const cwd = getCwd();
  const limit = params.limit ?? 20;
  const args = ["log", `-${limit}`];
  if (params.oneline) {
    args.push("--oneline");
  } else {
    args.push("--format=%H|%an|%ai|%s");
  }
  if (params.path) { args.push("--"); args.push(params.path); }

  const result = await runGit(args, cwd);
  log(`git.log: ${limit} entries`);
  return { log: result.stdout };
}

// ─── git.blame ───

interface GitBlameParams {
  path: string;
  startLine?: number;
  endLine?: number;
}

export async function gitBlame(params: GitBlameParams): Promise<{ blame: string }> {
  const cwd = getCwd();
  const args = ["blame", "--porcelain"];
  if (params.startLine && params.endLine) {
    args.push(`-L${params.startLine},${params.endLine}`);
  }
  args.push(params.path);

  const result = await runGit(args, cwd);
  log(`git.blame: ${params.path}`);
  return { blame: result.stdout };
}

// ─── git.stage ───

interface GitStageParams {
  paths: string[];
}

export async function gitStage(params: GitStageParams): Promise<{ ok: boolean }> {
  const cwd = getCwd();
  const result = await runGit(["add", ...params.paths], cwd);
  if (result.exitCode !== 0) throw new Error(result.stderr);
  log(`git.stage: ${params.paths.join(", ")}`);
  return { ok: true };
}

// ─── git.unstage ───

interface GitUnstageParams {
  paths: string[];
}

export async function gitUnstage(params: GitUnstageParams): Promise<{ ok: boolean }> {
  const cwd = getCwd();
  const result = await runGit(["reset", "HEAD", ...params.paths], cwd);
  if (result.exitCode !== 0) throw new Error(result.stderr);
  log(`git.unstage: ${params.paths.join(", ")}`);
  return { ok: true };
}

// ─── git.commit ───

interface GitCommitParams {
  message: string;
  amend?: boolean;
}

export async function gitCommit(params: GitCommitParams): Promise<{ ok: boolean; output: string }> {
  const cwd = getCwd();
  const args = ["commit", "-m", params.message];
  if (params.amend) args.push("--amend");

  const result = await runGit(args, cwd);
  if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout);
  log(`git.commit: "${params.message.slice(0, 50)}..."`);
  return { ok: true, output: result.stdout };
}

// ─── git.stash ───

interface GitStashParams {
  action: "push" | "pop" | "list";
  message?: string;
}

export async function gitStash(params: GitStashParams): Promise<{ ok: boolean; output: string }> {
  const cwd = getCwd();
  let args: string[];
  switch (params.action) {
    case "push":
      args = ["stash", "push"];
      if (params.message) args.push("-m", params.message);
      break;
    case "pop":
      args = ["stash", "pop"];
      break;
    case "list":
      args = ["stash", "list"];
      break;
  }

  const result = await runGit(args, cwd);
  if (result.exitCode !== 0 && params.action !== "list") throw new Error(result.stderr || result.stdout);
  log(`git.stash: ${params.action}`);
  return { ok: true, output: result.stdout };
}
