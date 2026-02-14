import * as vscode from "vscode";
import { resolveWorkspacePath } from "../security";
import { log } from "../logger";

// ─── debug.launch ───

interface DebugLaunchParams {
  config?: Record<string, unknown>; // launch.json config override
  name?: string; // name of existing launch config to use
  noDebug?: boolean; // run without debugging
}

export async function debugLaunch(
  params: DebugLaunchParams
): Promise<{ ok: boolean; message: string }> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) throw new Error("No workspace folder open");

  let config: vscode.DebugConfiguration | undefined;

  if (params.config) {
    config = params.config as vscode.DebugConfiguration;
  } else if (params.name) {
    // Let VS Code find the named config from launch.json
    const configs = vscode.workspace
      .getConfiguration("launch", folders[0].uri)
      .get<vscode.DebugConfiguration[]>("configurations");
    config = configs?.find((c) => c.name === params.name);
    if (!config) {
      throw new Error(`Debug configuration "${params.name}" not found`);
    }
  }

  const started = await vscode.debug.startDebugging(
    folders[0],
    config ?? { type: "", name: "OpenClaw Debug", request: "launch" },
    { noDebug: params.noDebug }
  );

  log(`debug.launch: started=${started}`);
  return {
    ok: started,
    message: started
      ? "Debug session started"
      : "Failed to start debug session. Check launch.json configuration.",
  };
}

// ─── debug.stop ───

export async function debugStop(): Promise<{ ok: boolean }> {
  const session = vscode.debug.activeDebugSession;
  if (!session) {
    return { ok: true }; // already stopped
  }

  await vscode.commands.executeCommand("workbench.action.debug.stop");
  log("debug.stop: stopped active session");
  return { ok: true };
}

// ─── debug.breakpoint ───

interface BreakpointParams {
  action: "add" | "remove" | "list" | "clear";
  path?: string;
  line?: number;
  condition?: string;
  hitCondition?: string;
  logMessage?: string;
}

interface BreakpointInfo {
  id: string;
  enabled: boolean;
  path?: string;
  line?: number;
  condition?: string;
  hitCondition?: string;
  logMessage?: string;
}

export async function debugBreakpoint(
  params: BreakpointParams
): Promise<{ ok: boolean; breakpoints?: BreakpointInfo[] }> {
  switch (params.action) {
    case "add": {
      if (!params.path || !params.line) {
        throw new Error("path and line required for adding breakpoint");
      }
      const uri = resolveWorkspacePath(params.path);
      const location = new vscode.Location(
        uri,
        new vscode.Position(params.line - 1, 0)
      );
      const bp = new vscode.SourceBreakpoint(location, true, params.condition, params.hitCondition, params.logMessage);
      vscode.debug.addBreakpoints([bp]);
      log(`debug.breakpoint: added at ${params.path}:${params.line}`);
      return { ok: true };
    }

    case "remove": {
      if (!params.path || !params.line) {
        throw new Error("path and line required for removing breakpoint");
      }
      const uri = resolveWorkspacePath(params.path);
      const targetLine = params.line - 1;
      const toRemove = vscode.debug.breakpoints.filter((bp) => {
        if (bp instanceof vscode.SourceBreakpoint) {
          return (
            bp.location.uri.fsPath === uri.fsPath &&
            bp.location.range.start.line === targetLine
          );
        }
        return false;
      });
      if (toRemove.length > 0) {
        vscode.debug.removeBreakpoints(toRemove);
      }
      log(`debug.breakpoint: removed ${toRemove.length} at ${params.path}:${params.line}`);
      return { ok: true };
    }

    case "list": {
      const breakpoints: BreakpointInfo[] = vscode.debug.breakpoints
        .filter((bp): bp is vscode.SourceBreakpoint => bp instanceof vscode.SourceBreakpoint)
        .map((bp) => ({
          id: bp.id,
          enabled: bp.enabled,
          path: vscode.workspace.asRelativePath(bp.location.uri),
          line: bp.location.range.start.line + 1,
          condition: bp.condition,
          hitCondition: bp.hitCondition,
          logMessage: bp.logMessage,
        }));
      log(`debug.breakpoint: list → ${breakpoints.length}`);
      return { ok: true, breakpoints };
    }

    case "clear": {
      const all = vscode.debug.breakpoints;
      if (all.length > 0) {
        vscode.debug.removeBreakpoints(all);
      }
      log(`debug.breakpoint: cleared ${all.length}`);
      return { ok: true };
    }

    default:
      throw new Error(`Unknown breakpoint action: ${params.action}`);
  }
}

// ─── debug.evaluate ───

interface EvaluateParams {
  expression: string;
  context?: "watch" | "repl" | "hover" | "clipboard";
  frameId?: number;
}

export async function debugEvaluate(
  params: EvaluateParams
): Promise<{ result: string; type?: string; variablesReference?: number }> {
  const session = vscode.debug.activeDebugSession;
  if (!session) {
    throw new Error("No active debug session");
  }

  const response = await session.customRequest("evaluate", {
    expression: params.expression,
    context: params.context ?? "repl",
    frameId: params.frameId,
  });

  log(`debug.evaluate: "${params.expression}" → ${response.result}`);
  return {
    result: response.result,
    type: response.type,
    variablesReference: response.variablesReference,
  };
}

// ─── debug.stackTrace ───

interface StackTraceParams {
  threadId?: number;
  levels?: number;
}

interface StackFrameInfo {
  id: number;
  name: string;
  path?: string;
  line?: number;
  column?: number;
}

export async function debugStackTrace(
  params: StackTraceParams
): Promise<{ frames: StackFrameInfo[] }> {
  const session = vscode.debug.activeDebugSession;
  if (!session) {
    throw new Error("No active debug session");
  }

  // Get threads first if no threadId specified
  let threadId = params.threadId;
  if (threadId === undefined) {
    const threads = await session.customRequest("threads");
    if (threads.threads?.length > 0) {
      threadId = threads.threads[0].id;
    } else {
      throw new Error("No threads available");
    }
  }

  const response = await session.customRequest("stackTrace", {
    threadId,
    startFrame: 0,
    levels: params.levels ?? 20,
  });

  const frames: StackFrameInfo[] = (response.stackFrames ?? []).map(
    (f: { id: number; name: string; source?: { path?: string }; line?: number; column?: number }) => ({
      id: f.id,
      name: f.name,
      path: f.source?.path
        ? vscode.workspace.asRelativePath(vscode.Uri.file(f.source.path))
        : undefined,
      line: f.line,
      column: f.column,
    })
  );

  log(`debug.stackTrace: ${frames.length} frames`);
  return { frames };
}

// ─── debug.variables ───

interface VariablesParams {
  frameId?: number;
  scope?: "locals" | "arguments" | "globals";
}

interface VariableInfo {
  name: string;
  value: string;
  type?: string;
  variablesReference: number; // > 0 means expandable
}

export async function debugVariables(
  params: VariablesParams
): Promise<{ variables: VariableInfo[] }> {
  const session = vscode.debug.activeDebugSession;
  if (!session) {
    throw new Error("No active debug session");
  }

  // Get stack trace to find frameId
  let frameId = params.frameId;
  if (frameId === undefined) {
    const threads = await session.customRequest("threads");
    if (!threads.threads?.length) throw new Error("No threads");
    const stack = await session.customRequest("stackTrace", {
      threadId: threads.threads[0].id,
      startFrame: 0,
      levels: 1,
    });
    if (!stack.stackFrames?.length) throw new Error("No stack frames");
    frameId = stack.stackFrames[0].id;
  }

  // Get scopes
  const scopes = await session.customRequest("scopes", { frameId });
  const targetScope = params.scope ?? "locals";

  let variablesReference: number | undefined;
  for (const scope of scopes.scopes ?? []) {
    const scopeName = (scope.name as string).toLowerCase();
    if (scopeName.includes(targetScope)) {
      variablesReference = scope.variablesReference;
      break;
    }
  }

  if (!variablesReference && scopes.scopes?.length > 0) {
    // Fall back to first scope
    variablesReference = scopes.scopes[0].variablesReference;
  }

  if (!variablesReference) {
    return { variables: [] };
  }

  const response = await session.customRequest("variables", {
    variablesReference,
  });

  const variables: VariableInfo[] = (response.variables ?? []).map(
    (v: { name: string; value: string; type?: string; variablesReference: number }) => ({
      name: v.name,
      value: v.value,
      type: v.type,
      variablesReference: v.variablesReference,
    })
  );

  log(`debug.variables: ${variables.length} variables (scope=${targetScope})`);
  return { variables };
}

// ─── debug.status ───

export async function debugStatus(): Promise<{
  active: boolean;
  sessionName?: string;
  sessionType?: string;
}> {
  const session = vscode.debug.activeDebugSession;
  if (!session) {
    return { active: false };
  }
  return {
    active: true,
    sessionName: session.name,
    sessionType: session.type,
  };
}
