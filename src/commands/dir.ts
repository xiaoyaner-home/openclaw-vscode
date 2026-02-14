import * as vscode from "vscode";
import { resolveWorkspacePath } from "../security";
import { log } from "../logger";

interface DirListParams {
  path?: string;
  recursive?: boolean;
  pattern?: string;
}

interface DirEntry {
  name: string;
  type: "file" | "directory" | "symlink" | "unknown";
  size?: number;
}

export async function dirList(
  params: DirListParams
): Promise<{ entries: DirEntry[] }> {
  const relPath = params.path || ".";
  const uri = resolveWorkspacePath(relPath);

  if (params.pattern) {
    // Use glob pattern via findFiles
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) throw new Error("No workspace folder open");

    const basePattern =
      relPath === "." ? params.pattern : `${relPath}/${params.pattern}`;
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(workspaceFolders[0], basePattern),
      undefined,
      1000
    );

    const rootPath = workspaceFolders[0].uri.fsPath;
    const entries: DirEntry[] = uris.map((u) => {
      const relative = u.fsPath.replace(rootPath + "/", "").replace(rootPath + "\\", "");
      return { name: relative, type: "file" as const };
    });

    log(`dir.list: ${relPath} (pattern: ${params.pattern}, ${entries.length} files)`);
    return { entries };
  }

  // Direct directory listing
  const items = await vscode.workspace.fs.readDirectory(uri);
  const entries: DirEntry[] = [];

  for (const [name, fileType] of items) {
    let type: DirEntry["type"] = "unknown";
    if (fileType === vscode.FileType.File) type = "file";
    else if (fileType === vscode.FileType.Directory) type = "directory";
    else if (fileType === vscode.FileType.SymbolicLink) type = "symlink";

    let size: number | undefined;
    if (type === "file") {
      try {
        const stat = await vscode.workspace.fs.stat(
          vscode.Uri.joinPath(uri, name)
        );
        size = stat.size;
      } catch {
        // ignore
      }
    }

    entries.push({ name, type, size });
  }

  log(`dir.list: ${relPath} (${entries.length} entries)`);
  return { entries };
}
