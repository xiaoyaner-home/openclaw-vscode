import * as vscode from "vscode";
import { log } from "../logger";

export async function editorActive(): Promise<{
  path: string | null;
  language: string | null;
  selections: Array<{ line: number; character: number }>;
}> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return { path: null, language: null, selections: [] };
  }

  const path = vscode.workspace.asRelativePath(editor.document.uri);
  const language = editor.document.languageId;
  const selections = editor.selections.map((s) => ({
    line: s.active.line + 1,
    character: s.active.character,
  }));

  log(`editor.active: ${path} (${language})`);
  return { path, language, selections };
}

interface DiagnosticsParams {
  path?: string;
}

interface DiagnosticEntry {
  path: string;
  line: number;
  character: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  source?: string;
}

const severityMap: Record<number, DiagnosticEntry["severity"]> = {
  [vscode.DiagnosticSeverity.Error]: "error",
  [vscode.DiagnosticSeverity.Warning]: "warning",
  [vscode.DiagnosticSeverity.Information]: "info",
  [vscode.DiagnosticSeverity.Hint]: "hint",
};

export async function diagnosticsGet(
  params: DiagnosticsParams
): Promise<{ diagnostics: DiagnosticEntry[] }> {
  const all = vscode.languages.getDiagnostics();
  const entries: DiagnosticEntry[] = [];

  for (const [uri, diagnostics] of all) {
    const relativePath = vscode.workspace.asRelativePath(uri);

    // Filter by path if specified
    if (params.path && relativePath !== params.path) {
      continue;
    }

    for (const d of diagnostics) {
      entries.push({
        path: relativePath,
        line: d.range.start.line + 1,
        character: d.range.start.character,
        severity: severityMap[d.severity] ?? "info",
        message: d.message,
        source: d.source,
      });
    }
  }

  log(`diagnostics.get: ${params.path ?? "all"} (${entries.length} items)`);
  return { diagnostics: entries };
}

export async function workspaceInfo(): Promise<{
  name: string | null;
  rootPath: string | null;
  folders: string[];
}> {
  const folders = vscode.workspace.workspaceFolders;
  return {
    name: vscode.workspace.name ?? null,
    rootPath: folders?.[0]?.uri.fsPath ?? null,
    folders: folders?.map((f) => f.uri.fsPath) ?? [],
  };
}
