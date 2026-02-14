import * as path from "path";
import * as vscode from "vscode";

/**
 * Resolve a relative path to an absolute path within the workspace.
 * Throws if the path escapes the workspace sandbox.
 */
export function resolveWorkspacePath(relativePath: string): vscode.Uri {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error("No workspace folder open");
  }

  const rootUri = workspaceFolders[0].uri;
  const rootPath = rootUri.fsPath;

  // Reject absolute paths
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Absolute paths not allowed: ${relativePath}`);
  }

  // Resolve and check containment
  const resolved = path.resolve(rootPath, relativePath);
  const normalizedRoot = path.resolve(rootPath) + path.sep;
  const normalizedResolved = path.resolve(resolved);

  // Allow exact root match or must be inside root
  if (normalizedResolved !== path.resolve(rootPath) &&
      !normalizedResolved.startsWith(normalizedRoot)) {
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }

  return vscode.Uri.file(resolved);
}

/**
 * Check if a terminal command is in the allowlist.
 */
export function isCommandAllowed(command: string, allowlist: string[]): boolean {
  // Extract the base command (first token)
  const baseCmd = command.trim().split(/\s+/)[0];
  if (!baseCmd) {
    return false;
  }
  // Check against allowlist (base name only, no path)
  const baseName = path.basename(baseCmd);
  return allowlist.some(
    (allowed) => allowed === "*" || baseName === allowed || baseName === `${allowed}.exe`
  );
}
