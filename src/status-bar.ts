import * as vscode from "vscode";
import type { ConnectionState } from "./gateway-client";

let statusBarItem: vscode.StatusBarItem | undefined;

const STATE_CONFIG: Record<ConnectionState, { text: string; tooltip: string; color?: string }> = {
  disconnected: { text: "$(circle-slash) OpenClaw", tooltip: "OpenClaw: Disconnected — click to connect" },
  connecting: { text: "$(sync~spin) OpenClaw", tooltip: "OpenClaw: Connecting..." },
  connected: { text: "$(check) OpenClaw", tooltip: "OpenClaw: Connected — click to disconnect" },
};

export function createStatusBar(): vscode.StatusBarItem {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = "openclaw.toggleConnection";
  updateState("disconnected");
  statusBarItem.show();
  return statusBarItem;
}

export function updateState(state: ConnectionState): void {
  if (!statusBarItem) return;
  const cfg = STATE_CONFIG[state];
  statusBarItem.text = cfg.text;
  statusBarItem.tooltip = cfg.tooltip;
}

export function dispose(): void {
  statusBarItem?.dispose();
  statusBarItem = undefined;
}
