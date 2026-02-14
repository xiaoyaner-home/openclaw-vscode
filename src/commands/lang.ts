import * as vscode from "vscode";
import { resolveWorkspacePath } from "../security";
import { log } from "../logger";
import { getConfig } from "../config";

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

// ─── Shared helpers ───

interface LocationResult {
  path: string;
  line: number;
  character: number;
  endLine?: number;
  endCharacter?: number;
}

function locationsFromResult(
  results: vscode.Location[] | vscode.LocationLink[] | undefined
): LocationResult[] {
  if (!results) return [];
  return results.map((r) => {
    const range = "targetRange" in r ? r.targetRange : r.range;
    const uri = "targetUri" in r ? r.targetUri : r.uri;
    return {
      path: vscode.workspace.asRelativePath(uri),
      line: range.start.line + 1,
      character: range.start.character,
      endLine: range.end.line + 1,
      endCharacter: range.end.character,
    };
  });
}

async function positionFromParams(params: {
  path: string;
  line: number;
  character?: number;
}): Promise<{ uri: vscode.Uri; position: vscode.Position; doc: vscode.TextDocument }> {
  const uri = resolveWorkspacePath(params.path);
  const doc = await vscode.workspace.openTextDocument(uri);
  const position = new vscode.Position(params.line - 1, params.character ?? 0);
  return { uri, position, doc };
}

// ─── lang.definition ───

interface DefinitionParams {
  path: string;
  line: number;
  character?: number;
}

export async function langDefinition(
  params: DefinitionParams
): Promise<{ locations: LocationResult[] }> {
  const { uri, position } = await positionFromParams(params);
  const results = await vscode.commands.executeCommand<
    vscode.Location[] | vscode.LocationLink[]
  >("vscode.executeDefinitionProvider", uri, position);

  const locations = locationsFromResult(results);
  log(`lang.definition: ${params.path}:${params.line} → ${locations.length} results`);
  return { locations };
}

// ─── lang.references ───

interface ReferencesParams {
  path: string;
  line: number;
  character?: number;
  includeDeclaration?: boolean;
}

export async function langReferences(
  params: ReferencesParams
): Promise<{ locations: LocationResult[] }> {
  const { uri, position } = await positionFromParams(params);
  const results = await vscode.commands.executeCommand<vscode.Location[]>(
    "vscode.executeReferenceProvider",
    uri,
    position,
    { includeDeclaration: params.includeDeclaration ?? true }
  );

  const locations = locationsFromResult(results ?? []);
  log(`lang.references: ${params.path}:${params.line} → ${locations.length} results`);
  return { locations };
}

// ─── lang.hover ───

interface HoverParams {
  path: string;
  line: number;
  character?: number;
}

export async function langHover(
  params: HoverParams
): Promise<{ contents: string[] }> {
  const { uri, position } = await positionFromParams(params);
  const results = await vscode.commands.executeCommand<vscode.Hover[]>(
    "vscode.executeHoverProvider",
    uri,
    position
  );

  const contents: string[] = [];
  for (const hover of results ?? []) {
    for (const c of hover.contents) {
      if (typeof c === "string") {
        contents.push(c);
      } else if ("value" in c) {
        contents.push(c.value);
      }
    }
  }

  log(`lang.hover: ${params.path}:${params.line} → ${contents.length} entries`);
  return { contents };
}

// ─── lang.symbols ───

interface SymbolsParams {
  path?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

interface SymbolEntry {
  name: string;
  kind: string;
  path: string;
  line: number;
  endLine: number;
  containerName?: string;
}

const symbolKindNames: Record<number, string> = {
  [vscode.SymbolKind.File]: "File",
  [vscode.SymbolKind.Module]: "Module",
  [vscode.SymbolKind.Namespace]: "Namespace",
  [vscode.SymbolKind.Package]: "Package",
  [vscode.SymbolKind.Class]: "Class",
  [vscode.SymbolKind.Method]: "Method",
  [vscode.SymbolKind.Property]: "Property",
  [vscode.SymbolKind.Field]: "Field",
  [vscode.SymbolKind.Constructor]: "Constructor",
  [vscode.SymbolKind.Enum]: "Enum",
  [vscode.SymbolKind.Interface]: "Interface",
  [vscode.SymbolKind.Function]: "Function",
  [vscode.SymbolKind.Variable]: "Variable",
  [vscode.SymbolKind.Constant]: "Constant",
  [vscode.SymbolKind.String]: "String",
  [vscode.SymbolKind.Number]: "Number",
  [vscode.SymbolKind.Boolean]: "Boolean",
  [vscode.SymbolKind.Array]: "Array",
  [vscode.SymbolKind.Object]: "Object",
  [vscode.SymbolKind.Key]: "Key",
  [vscode.SymbolKind.Null]: "Null",
  [vscode.SymbolKind.EnumMember]: "EnumMember",
  [vscode.SymbolKind.Struct]: "Struct",
  [vscode.SymbolKind.Event]: "Event",
  [vscode.SymbolKind.Operator]: "Operator",
  [vscode.SymbolKind.TypeParameter]: "TypeParameter",
};

function flattenDocSymbols(
  symbols: vscode.DocumentSymbol[],
  path: string,
  container?: string
): SymbolEntry[] {
  const entries: SymbolEntry[] = [];
  for (const s of symbols) {
    entries.push({
      name: s.name,
      kind: symbolKindNames[s.kind] ?? "Unknown",
      path,
      line: s.range.start.line + 1,
      endLine: s.range.end.line + 1,
      containerName: container,
    });
    if (s.children?.length) {
      entries.push(...flattenDocSymbols(s.children, path, s.name));
    }
  }
  return entries;
}

export async function langSymbols(
  params: SymbolsParams
): Promise<{ symbols: SymbolEntry[] }> {
  // Document symbols (specific file)
  if (params.path) {
    const uri = resolveWorkspacePath(params.path);
    const doc = await vscode.workspace.openTextDocument(uri);
    const results = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      "vscode.executeDocumentSymbolProvider",
      doc.uri
    );
    const symbols = flattenDocSymbols(results ?? [], params.path);
    log(`lang.symbols: ${params.path} → ${symbols.length} symbols`);
    return { symbols };
  }

  // Workspace symbols (search query)
  const query = params.query ?? "";
  const timeoutMs = getConfig().commandTimeout * 1000;
  const results = await withTimeout(
    vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      "vscode.executeWorkspaceSymbolProvider",
      query
    ),
    timeoutMs,
    `workspace symbols "${query}"`
  );

  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  const all: SymbolEntry[] = (results ?? []).map((s) => ({
    name: s.name,
    kind: symbolKindNames[s.kind] ?? "Unknown",
    path: vscode.workspace.asRelativePath(s.location.uri),
    line: s.location.range.start.line + 1,
    endLine: s.location.range.end.line + 1,
    containerName: s.containerName || undefined,
  }));

  const symbols = all.slice(offset, offset + limit);
  log(`lang.symbols: query="${query}" → ${all.length} total, returning ${symbols.length} (offset=${offset}, limit=${limit})`);
  return { symbols, total: all.length };
}

// ─── lang.rename ───

interface RenameParams {
  path: string;
  line: number;
  character?: number;
  newName: string;
}

export async function langRename(
  params: RenameParams
): Promise<{ ok: boolean; filesChanged: number; editsApplied: number }> {
  const { uri, position } = await positionFromParams(params);

  const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
    "vscode.executeDocumentRenameProvider",
    uri,
    position,
    params.newName
  );

  if (!edit) {
    throw new Error("Rename not available at this position");
  }

  const filesChanged = edit.size;
  let editsApplied = 0;
  for (const [, edits] of edit.entries()) {
    editsApplied += edits.length;
  }

  const success = await vscode.workspace.applyEdit(edit);
  if (!success) {
    throw new Error("Failed to apply rename edits");
  }

  log(`lang.rename: ${params.path}:${params.line} → "${params.newName}" (${filesChanged} files, ${editsApplied} edits)`);
  return { ok: true, filesChanged, editsApplied };
}

// ─── lang.codeActions ───

interface CodeActionsParams {
  path: string;
  line: number;
  endLine?: number;
  character?: number;
  endCharacter?: number;
  kind?: string; // e.g. "quickfix", "refactor", "source.organizeImports"
}

interface CodeActionEntry {
  title: string;
  kind: string;
  isPreferred: boolean;
  index: number;
}

export async function langCodeActions(
  params: CodeActionsParams
): Promise<{ actions: CodeActionEntry[] }> {
  const uri = resolveWorkspacePath(params.path);
  const doc = await vscode.workspace.openTextDocument(uri);

  const startLine = params.line - 1;
  const endLine = (params.endLine ?? params.line) - 1;
  const range = new vscode.Range(
    startLine,
    params.character ?? 0,
    endLine,
    params.endCharacter ?? doc.lineAt(endLine).text.length
  );

  const results = await vscode.commands.executeCommand<vscode.CodeAction[]>(
    "vscode.executeCodeActionProvider",
    doc.uri,
    range,
    params.kind
  );

  const actions: CodeActionEntry[] = (results ?? []).map((a, i) => ({
    title: a.title,
    kind: a.kind?.value ?? "unknown",
    isPreferred: a.isPreferred ?? false,
    index: i,
  }));

  log(`lang.codeActions: ${params.path}:${params.line} → ${actions.length} actions`);
  return { actions };
}

// ─── lang.applyCodeAction ───

interface ApplyCodeActionParams {
  path: string;
  line: number;
  endLine?: number;
  character?: number;
  endCharacter?: number;
  kind?: string;
  index: number; // which action to apply (from codeActions result)
}

export async function langApplyCodeAction(
  params: ApplyCodeActionParams
): Promise<{ ok: boolean; title: string }> {
  const uri = resolveWorkspacePath(params.path);
  const doc = await vscode.workspace.openTextDocument(uri);

  const startLine = params.line - 1;
  const endLine = (params.endLine ?? params.line) - 1;
  const range = new vscode.Range(
    startLine,
    params.character ?? 0,
    endLine,
    params.endCharacter ?? doc.lineAt(endLine).text.length
  );

  const results = await vscode.commands.executeCommand<vscode.CodeAction[]>(
    "vscode.executeCodeActionProvider",
    doc.uri,
    range,
    params.kind
  );

  if (!results || params.index >= results.length) {
    throw new Error(`Code action index ${params.index} out of range (${results?.length ?? 0} available)`);
  }

  const action = results[params.index];

  // Apply workspace edit if present
  if (action.edit) {
    const success = await vscode.workspace.applyEdit(action.edit);
    if (!success) {
      throw new Error(`Failed to apply edit for: ${action.title}`);
    }
  }

  // Execute command if present
  if (action.command) {
    await vscode.commands.executeCommand(
      action.command.command,
      ...(action.command.arguments ?? [])
    );
  }

  log(`lang.applyCodeAction: applied "${action.title}"`);
  return { ok: true, title: action.title };
}

// ─── code.format ───

interface FormatParams {
  path: string;
  tabSize?: number;
  insertSpaces?: boolean;
}

export async function codeFormat(
  params: FormatParams
): Promise<{ ok: boolean; editsApplied: number }> {
  const uri = resolveWorkspacePath(params.path);
  const doc = await vscode.workspace.openTextDocument(uri);

  const options: vscode.FormattingOptions = {
    tabSize: params.tabSize ?? 2,
    insertSpaces: params.insertSpaces ?? true,
  };

  const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
    "vscode.executeFormatDocumentProvider",
    doc.uri,
    options
  );

  if (!edits || edits.length === 0) {
    log(`code.format: ${params.path} → no changes`);
    return { ok: true, editsApplied: 0 };
  }

  const wsEdit = new vscode.WorkspaceEdit();
  for (const edit of edits) {
    wsEdit.replace(doc.uri, edit.range, edit.newText);
  }

  const success = await vscode.workspace.applyEdit(wsEdit);
  if (success) {
    await doc.save();
  }

  log(`code.format: ${params.path} → ${edits.length} edits`);
  return { ok: success, editsApplied: edits.length };
}

// ─── editor.openFiles ───

export async function editorOpenFiles(): Promise<{
  files: Array<{ path: string; language: string; isDirty: boolean }>;
}> {
  const files = vscode.workspace.textDocuments
    .filter((d) => d.uri.scheme === "file")
    .map((d) => ({
      path: vscode.workspace.asRelativePath(d.uri),
      language: d.languageId,
      isDirty: d.isDirty,
    }));

  log(`editor.openFiles: ${files.length} files`);
  return { files };
}

// ─── editor.selections ───

export async function editorSelections(): Promise<{
  path: string | null;
  selections: Array<{
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
    text: string;
  }>;
}> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return { path: null, selections: [] };
  }

  const path = vscode.workspace.asRelativePath(editor.document.uri);
  const selections = editor.selections.map((s) => ({
    startLine: s.start.line + 1,
    startCharacter: s.start.character,
    endLine: s.end.line + 1,
    endCharacter: s.end.character,
    text: editor.document.getText(s),
  }));

  log(`editor.selections: ${path} → ${selections.length} selections`);
  return { path, selections };
}
