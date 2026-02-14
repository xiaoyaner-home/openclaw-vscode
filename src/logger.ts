import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("OpenClaw");
  }
  return channel;
}

export function log(message: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  getOutputChannel().appendLine(`[${ts}] ${message}`);
}

export function logWarn(message: string): void {
  log(`⚠️  ${message}`);
}

export function logError(message: string): void {
  log(`❌ ${message}`);
}

export function dispose(): void {
  channel?.dispose();
  channel = undefined;
}
