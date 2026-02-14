import * as vscode from "vscode";
import { GatewayClient, type ConnectionState } from "./gateway-client";
import { getConfig } from "./config";
import { getRegisteredCommands, dispatchCommand } from "./commands/registry";
import { createStatusBar, updateState, dispose as disposeStatusBar } from "./status-bar";
import { log, logError, getOutputChannel, dispose as disposeLogger } from "./logger";
import { showSettingsPanel } from "./settings-panel";
import { ActivityViewProvider } from "./activity-panel";
import { agentSetup } from "./commands/agent";
import { showSetupWizard } from "./setup-wizard";

let client: GatewayClient | null = null;

function createClient(): GatewayClient {
  const cfg = getConfig();
  return new GatewayClient({
    host: cfg.gatewayHost,
    port: cfg.gatewayPort,
    tls: cfg.gatewayTls,
    token: cfg.gatewayToken || undefined,
    displayName: cfg.displayName,
    commands: getRegisteredCommands(),
    caps: ["vscode"],
    onInvoke: (command, params) => dispatchCommand(command, params),
    onStateChange: (state: ConnectionState) => {
      updateState(state);
      log(`State: ${state}`);
    },
  });
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  log("OpenClaw extension activating...");

  // Status bar
  const statusBar = createStatusBar();
  context.subscriptions.push(statusBar);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("openclaw.connect", () => {
      if (client) client.stop();
      client = createClient();
      client.start();
    }),

    vscode.commands.registerCommand("openclaw.disconnect", () => {
      client?.stop();
      client = null;
    }),

    vscode.commands.registerCommand("openclaw.toggleConnection", () => {
      if (client && client.state !== "disconnected") {
        vscode.commands.executeCommand("openclaw.disconnect");
      } else {
        vscode.commands.executeCommand("openclaw.connect");
      }
    }),

    vscode.commands.registerCommand("openclaw.showLog", () => {
      getOutputChannel().show();
    }),

    vscode.commands.registerCommand("openclaw.settings", () => {
      showSettingsPanel(context);
    }),

    vscode.commands.registerCommand("openclaw.agentSetup", async () => {
      const result = await agentSetup();
      vscode.window.showInformationMessage(result.message);
    }),

    vscode.commands.registerCommand("openclaw.setup", () => {
      showSetupWizard(context);
    }),

    // Activity sidebar view
    vscode.window.registerWebviewViewProvider(
      ActivityViewProvider.viewType,
      new ActivityViewProvider(context.extensionUri)
    ),

    vscode.commands.registerCommand("openclaw.toggleReadOnly", () => {
      const cfg = vscode.workspace.getConfiguration("openclaw");
      const current = cfg.get<boolean>("readOnly", false);
      cfg.update("readOnly", !current, vscode.ConfigurationTarget.Global);
      log(`Read-only mode: ${!current}`);
    })
  );

  // Auto-connect if configured (with retry — Cursor may load settings late)
  const tryAutoConnect = () => {
    const cfg = getConfig();
    log(`autoConnect=${cfg.autoConnect}, host=${cfg.gatewayHost}, token=${cfg.gatewayToken ? "***" : "(empty)"}`);
    if (cfg.autoConnect && cfg.gatewayToken) {
      client = createClient();
      client.start();
      return true;
    }
    return false;
  };

  if (!tryAutoConnect()) {
    // Retry after a short delay — settings may not be ready yet
    const retryTimer = setTimeout(() => {
      if (!client) {
        log("Retrying auto-connect...");
        tryAutoConnect();
      }
    }, 3000);
    context.subscriptions.push({ dispose: () => clearTimeout(retryTimer) });
  }

  // First-run: show setup wizard if no token configured
  const initialCfg = getConfig();
  if (!initialCfg.gatewayToken) {
    const choice = await vscode.window.showInformationMessage(
      "Welcome to OpenClaw! Set up your Gateway connection to get started.",
      "Run Setup",
      "Later"
    );
    if (choice === "Run Setup") {
      showSetupWizard(context);
    }
  }

  log(`OpenClaw extension activated. Commands: ${getRegisteredCommands().join(", ")}`);
}

export function deactivate(): void {
  client?.stop();
  client = null;
  disposeStatusBar();
  disposeLogger();
}
