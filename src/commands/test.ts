import * as vscode from "vscode";
import { log } from "../logger";

// ─── test.list ───

interface TestListParams {
  path?: string;
}

export async function testList(
  _params: TestListParams
): Promise<{ available: boolean; message: string }> {
  // We can check if test-related commands exist
  const commands = await vscode.commands.getCommands(true);
  const testCommands = commands.filter((c) => c.startsWith("testing."));
  const hasTestFramework = testCommands.length > 0;

  log(`test.list: ${testCommands.length} test commands available`);
  return {
    available: hasTestFramework,
    message: hasTestFramework
      ? `Test framework detected (${testCommands.length} commands). Use test.run to execute.`
      : "No test framework detected. Install a test extension (e.g. Vitest, Jest).",
  };
}

// ─── test.run ───

interface TestRunParams {
  path?: string;
  debug?: boolean;
}

export async function testRun(
  params: TestRunParams
): Promise<{ ok: boolean; message: string }> {
  try {
    if (params.debug) {
      await vscode.commands.executeCommand("testing.debugCurrentFile");
    } else if (params.path) {
      const folders = vscode.workspace.workspaceFolders;
      if (folders) {
        const uri = vscode.Uri.joinPath(folders[0].uri, params.path);
        await vscode.window.showTextDocument(uri);
      }
      await vscode.commands.executeCommand("testing.runCurrentFile");
    } else {
      await vscode.commands.executeCommand("testing.runAll");
    }

    log(`test.run: triggered (path=${params.path ?? "all"}, debug=${params.debug ?? false})`);
    return { ok: true, message: "Test run triggered. Check diagnostics for failures." };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: msg };
  }
}

// ─── test.results ───

export async function testResults(): Promise<{
  hasResults: boolean;
  summary: string;
}> {
  // The test results are best accessed through diagnostics
  // since the TestResults API shape varies across VS Code versions.
  // We provide a pragmatic approach: check diagnostics for test-related errors.
  const allDiags = vscode.languages.getDiagnostics();
  let testErrors = 0;
  for (const [uri, diags] of allDiags) {
    const path = uri.fsPath;
    if (path.includes(".test.") || path.includes(".spec.") || path.includes("__tests__")) {
      testErrors += diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length;
    }
  }

  log(`test.results: ${testErrors} test-related errors`);
  return {
    hasResults: true,
    summary: testErrors > 0
      ? `${testErrors} test-related errors found. Use vscode.diagnostics.get to see details.`
      : "No test errors detected in diagnostics. Tests may be passing or not yet run.",
  };
}
