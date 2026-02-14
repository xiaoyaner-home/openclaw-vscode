import * as vscode from "vscode";

export interface OpenClawConfig {
  gatewayHost: string;
  gatewayPort: number;
  gatewayToken: string;
  gatewayTls: boolean;
  autoConnect: boolean;
  displayName: string;
  readOnly: boolean;
  confirmWrites: boolean;
  terminalEnabled: boolean;
  terminalAllowlist: string[];
  commandTimeout: number;
  // Agent
  agentEnabled: boolean;
  agentCliPath: string;
  agentDefaultMode: string;
  agentDefaultModel: string;
  agentTimeoutMs: number;
}

export function getConfig(): OpenClawConfig {
  const cfg = vscode.workspace.getConfiguration("openclaw");
  return {
    gatewayHost: cfg.get<string>("gatewayHost", "127.0.0.1"),
    gatewayPort: cfg.get<number>("gatewayPort", 18789),
    gatewayToken: cfg.get<string>("gatewayToken", ""),
    gatewayTls: cfg.get<boolean>("gatewayTls", false),
    autoConnect: cfg.get<boolean>("autoConnect", false),
    displayName: cfg.get<string>("displayName", "VS Code"),
    readOnly: cfg.get<boolean>("readOnly", false),
    confirmWrites: cfg.get<boolean>("confirmWrites", false),
    terminalEnabled: cfg.get<boolean>("terminal.enabled", false),
    terminalAllowlist: cfg.get<string[]>("terminal.allowlist", [
      "git", "npm", "pnpm", "npx", "node", "tsc",
    ]),
    commandTimeout: cfg.get<number>("commandTimeout", 90),
    agentEnabled: cfg.get<boolean>("agent.enabled", false),
    agentCliPath: cfg.get<string>("agent.cliPath", "agent"),
    agentDefaultMode: cfg.get<string>("agent.defaultMode", "agent"),
    agentDefaultModel: cfg.get<string>("agent.defaultModel", ""),
    agentTimeoutMs: cfg.get<number>("agent.timeoutMs", 300000),
  };
}
