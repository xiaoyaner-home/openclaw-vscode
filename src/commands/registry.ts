import { fileRead, fileWrite, fileEdit, fileDelete } from "./file";
import { dirList } from "./dir";
import { editorActive, diagnosticsGet, workspaceInfo } from "./editor";
import {
  langDefinition,
  langReferences,
  langHover,
  langSymbols,
  langRename,
  langCodeActions,
  langApplyCodeAction,
  codeFormat,
  editorOpenFiles,
  editorSelections,
} from "./lang";
import { testList, testRun, testResults } from "./test";
import {
  gitStatus,
  gitDiff,
  gitLog,
  gitBlame,
  gitStage,
  gitUnstage,
  gitCommit,
  gitStash,
} from "./git";
import {
  debugLaunch,
  debugStop,
  debugBreakpoint,
  debugEvaluate,
  debugStackTrace,
  debugVariables,
  debugStatus,
} from "./debug";
import { terminalRun } from "./terminal";
import { agentRun, agentSetup, agentStatus } from "./agent";
import { log } from "../logger";
import { activityStore } from "../activity-store";

type CommandHandler = (params: unknown) => Promise<unknown>;

const handlers = new Map<string, CommandHandler>();

// ── Phase 1: File operations ──
handlers.set("vscode.file.read", (p) => fileRead(p as Parameters<typeof fileRead>[0]));
handlers.set("vscode.file.write", (p) => fileWrite(p as Parameters<typeof fileWrite>[0]));
handlers.set("vscode.file.edit", (p) => fileEdit(p as Parameters<typeof fileEdit>[0]));
handlers.set("vscode.file.delete", (p) => fileDelete(p as Parameters<typeof fileDelete>[0]));
handlers.set("vscode.dir.list", (p) => dirList(p as Parameters<typeof dirList>[0]));

// ── Phase 1: Editor context ──
handlers.set("vscode.editor.active", () => editorActive());
handlers.set("vscode.diagnostics.get", (p) => diagnosticsGet(p as Parameters<typeof diagnosticsGet>[0]));
handlers.set("vscode.workspace.info", () => workspaceInfo());

// ── Phase 2: Language intelligence ──
handlers.set("vscode.lang.definition", (p) => langDefinition(p as Parameters<typeof langDefinition>[0]));
handlers.set("vscode.lang.references", (p) => langReferences(p as Parameters<typeof langReferences>[0]));
handlers.set("vscode.lang.hover", (p) => langHover(p as Parameters<typeof langHover>[0]));
handlers.set("vscode.lang.symbols", (p) => langSymbols(p as Parameters<typeof langSymbols>[0]));
handlers.set("vscode.lang.rename", (p) => langRename(p as Parameters<typeof langRename>[0]));
handlers.set("vscode.lang.codeActions", (p) => langCodeActions(p as Parameters<typeof langCodeActions>[0]));
handlers.set("vscode.lang.applyCodeAction", (p) => langApplyCodeAction(p as Parameters<typeof langApplyCodeAction>[0]));
handlers.set("vscode.code.format", (p) => codeFormat(p as Parameters<typeof codeFormat>[0]));
handlers.set("vscode.editor.openFiles", () => editorOpenFiles());
handlers.set("vscode.editor.selections", () => editorSelections());

// ── Phase 3: Testing ──
handlers.set("vscode.test.list", (p) => testList(p as Parameters<typeof testList>[0]));
handlers.set("vscode.test.run", (p) => testRun(p as Parameters<typeof testRun>[0]));
handlers.set("vscode.test.results", () => testResults());

// ── Phase 3: Git ──
handlers.set("vscode.git.status", () => gitStatus());
handlers.set("vscode.git.diff", (p) => gitDiff(p as Parameters<typeof gitDiff>[0]));
handlers.set("vscode.git.log", (p) => gitLog(p as Parameters<typeof gitLog>[0]));
handlers.set("vscode.git.blame", (p) => gitBlame(p as Parameters<typeof gitBlame>[0]));
handlers.set("vscode.git.stage", (p) => gitStage(p as Parameters<typeof gitStage>[0]));
handlers.set("vscode.git.unstage", (p) => gitUnstage(p as Parameters<typeof gitUnstage>[0]));
handlers.set("vscode.git.commit", (p) => gitCommit(p as Parameters<typeof gitCommit>[0]));
handlers.set("vscode.git.stash", (p) => gitStash(p as Parameters<typeof gitStash>[0]));

// ── Phase 4: Debug ──
handlers.set("vscode.debug.launch", (p) => debugLaunch(p as Parameters<typeof debugLaunch>[0]));
handlers.set("vscode.debug.stop", () => debugStop());
handlers.set("vscode.debug.breakpoint", (p) => debugBreakpoint(p as Parameters<typeof debugBreakpoint>[0]));
handlers.set("vscode.debug.evaluate", (p) => debugEvaluate(p as Parameters<typeof debugEvaluate>[0]));
handlers.set("vscode.debug.stackTrace", (p) => debugStackTrace(p as Parameters<typeof debugStackTrace>[0]));
handlers.set("vscode.debug.variables", (p) => debugVariables(p as Parameters<typeof debugVariables>[0]));
handlers.set("vscode.debug.status", () => debugStatus());
handlers.set("vscode.terminal.run", (p) => terminalRun(p as Parameters<typeof terminalRun>[0]));

// ── Phase 6: Agent ──
handlers.set("vscode.agent.run", (p) => agentRun(p as Parameters<typeof agentRun>[0]));
handlers.set("vscode.agent.setup", () => agentSetup());
handlers.set("vscode.agent.status", () => agentStatus());

export function getRegisteredCommands(): string[] {
  return [...handlers.keys()];
}

export async function dispatchCommand(
  command: string,
  params: unknown
): Promise<
  | { ok: true; payload?: unknown }
  | { ok: false; error: { code: string; message: string } }
> {
  const handler = handlers.get(command);
  if (!handler) {
    return {
      ok: false,
      error: { code: "UNKNOWN_COMMAND", message: `Unknown command: ${command}` },
    };
  }

  const activityId = activityStore.start(command, params);
  try {
    const payload = await handler(params);
    log(`→ ${command}: ok`);
    activityStore.finish(activityId, true, payload);
    return { ok: true, payload };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`→ ${command}: error — ${message}`);
    activityStore.finish(activityId, false, undefined, message);
    return {
      ok: false,
      error: { code: "COMMAND_ERROR", message },
    };
  }
}
