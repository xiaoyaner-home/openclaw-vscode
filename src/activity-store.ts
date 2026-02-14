import { EventEmitter } from "events";

export interface Activity {
  id: number;
  command: string;
  category: string;
  intent: string;
  params: unknown;
  status: "running" | "ok" | "error";
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  payload?: unknown;
  error?: string;
}

const CATEGORY_MAP: Record<string, string> = {
  "vscode.file": "📁 File",
  "vscode.dir": "📁 File",
  "vscode.editor": "✏️ Editor",
  "vscode.lang": "🔍 Language",
  "vscode.code": "🔍 Language",
  "vscode.git": "🌿 Git",
  "vscode.test": "🧪 Test",
  "vscode.debug": "🐛 Debug",
  "vscode.terminal": "🖥️ Terminal",
  "vscode.diagnostics": "⚠️ Diagnostics",
  "vscode.workspace": "📦 Workspace",
};

function getCategory(command: string): string {
  const prefix = command.split(".").slice(0, 2).join(".");
  return CATEGORY_MAP[prefix] || "❓ Other";
}

/** Generate a human-readable intent description */
export function describeIntent(command: string, params: unknown): string {
  const p = (params || {}) as Record<string, unknown>;
  switch (command) {
    // File
    case "vscode.file.read": return `Read ${shortPath(p.path)}`;
    case "vscode.file.write": return `Write ${shortPath(p.path)}`;
    case "vscode.file.edit": return `Edit ${shortPath(p.path)}`;
    case "vscode.file.delete": return `Delete ${shortPath(p.path)}`;
    case "vscode.dir.list": return `List ${shortPath(p.path) || "/"}`;
    // Editor
    case "vscode.editor.active": return "Get active editor";
    case "vscode.editor.openFiles": return "List open files";
    case "vscode.editor.selections": return "Get selections";
    case "vscode.diagnostics.get": return p.path ? `Diagnostics ${shortPath(p.path)}` : "Get diagnostics";
    case "vscode.workspace.info": return "Workspace info";
    // Language
    case "vscode.lang.definition": return `Go to definition ${shortPath(p.path)}:${p.line}`;
    case "vscode.lang.references": return `Find references ${shortPath(p.path)}:${p.line}`;
    case "vscode.lang.hover": return `Hover info ${shortPath(p.path)}:${p.line}`;
    case "vscode.lang.symbols": return p.path ? `Symbols in ${shortPath(p.path)}` : `Search symbols "${p.query}"`;
    case "vscode.lang.rename": return `Rename → ${p.newName}`;
    case "vscode.lang.codeActions": return `Code actions ${shortPath(p.path)}:${p.line}`;
    case "vscode.lang.applyCodeAction": return "Apply code action";
    case "vscode.code.format": return `Format ${shortPath(p.path)}`;
    // Git
    case "vscode.git.status": return "Git status";
    case "vscode.git.diff": return p.path ? `Diff ${shortPath(p.path)}` : "Diff all";
    case "vscode.git.log": return `Git log${p.count ? ` (${p.count})` : ""}`;
    case "vscode.git.blame": return `Blame ${shortPath(p.path)}`;
    case "vscode.git.stage": return `Stage ${shortPath(p.path) || "all"}`;
    case "vscode.git.unstage": return `Unstage ${shortPath(p.path) || "all"}`;
    case "vscode.git.commit": return `Commit: ${truncStr(String(p.message || ""), 40)}`;
    case "vscode.git.stash": return `Stash ${p.action || "push"}`;
    // Test
    case "vscode.test.list": return "List tests";
    case "vscode.test.run": return `Run tests ${p.pattern || ""}`;
    case "vscode.test.results": return "Test results";
    // Debug
    case "vscode.debug.launch": return `Launch debug ${p.config || ""}`;
    case "vscode.debug.stop": return "Stop debug";
    case "vscode.debug.breakpoint": return `Breakpoint ${shortPath(p.path)}:${p.line}`;
    case "vscode.debug.evaluate": return `Eval: ${truncStr(String(p.expression || ""), 30)}`;
    case "vscode.debug.stackTrace": return "Stack trace";
    case "vscode.debug.variables": return "Variables";
    case "vscode.debug.status": return "Debug status";
    // Terminal
    case "vscode.terminal.run": return `Run: ${truncStr(String(p.command || ""), 60)}`;
    // Agent
    case "vscode.agent.run": return `Agent: ${truncStr(String(p.prompt || ""), 50)}`;
    case "vscode.agent.status": return "Agent status";
    case "vscode.agent.setup": return "Agent setup";
    default: return command.replace("vscode.", "");
  }
}

function shortPath(p: unknown): string {
  if (!p || typeof p !== "string") return "";
  const parts = p.split("/");
  return parts.length > 3 ? "…/" + parts.slice(-2).join("/") : p;
}

function truncStr(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

class ActivityStore extends EventEmitter {
  private activities: Activity[] = [];
  private nextId = 1;
  private maxEntries = 200;

  start(command: string, params: unknown): number {
    const id = this.nextId++;
    const activity: Activity = {
      id,
      command,
      category: getCategory(command),
      intent: describeIntent(command, params),
      params,
      status: "running",
      startedAt: Date.now(),
    };
    this.activities.unshift(activity);
    if (this.activities.length > this.maxEntries) {
      this.activities.length = this.maxEntries;
    }
    this.emit("change");
    return id;
  }

  finish(id: number, ok: boolean, result?: unknown, error?: string): void {
    const activity = this.activities.find((a) => a.id === id);
    if (!activity) return;
    activity.status = ok ? "ok" : "error";
    activity.finishedAt = Date.now();
    activity.durationMs = activity.finishedAt - activity.startedAt;
    if (ok) activity.payload = result;
    if (error) activity.error = error;
    this.emit("change");
  }

  getAll(): Activity[] {
    return this.activities;
  }

  clear(): void {
    this.activities = [];
    this.emit("change");
  }

  getStats() {
    const total = this.activities.length;
    const ok = this.activities.filter((a) => a.status === "ok").length;
    const errors = this.activities.filter((a) => a.status === "error").length;
    const running = this.activities.filter((a) => a.status === "running").length;
    return { total, ok, errors, running };
  }
}

export const activityStore = new ActivityStore();
