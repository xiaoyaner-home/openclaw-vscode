import * as vscode from "vscode";
import { log } from "./logger";

let panel: vscode.WebviewPanel | null = null;

export function showSettingsPanel(context: vscode.ExtensionContext): void {
  if (panel) {
    panel.reveal();
    return;
  }

  panel = vscode.window.createWebviewPanel(
    "openclawSettings",
    "OpenClaw Settings",
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  const cfg = vscode.workspace.getConfiguration("openclaw");

  panel.webview.html = getHtml({
    gatewayHost: cfg.get<string>("gatewayHost", "127.0.0.1"),
    gatewayPort: cfg.get<number>("gatewayPort", 18789),
    gatewayToken: cfg.get<string>("gatewayToken", ""),
    gatewayTls: cfg.get<boolean>("gatewayTls", false),
    autoConnect: cfg.get<boolean>("autoConnect", false),
    displayName: cfg.get<string>("displayName", "VS Code"),
    readOnly: cfg.get<boolean>("readOnly", false),
    confirmWrites: cfg.get<boolean>("confirmWrites", false),
    terminalEnabled: cfg.get<boolean>("terminal.enabled", false),
    terminalAllowlist: cfg.get<string[]>("terminal.allowlist", ["git", "npm", "pnpm", "npx", "node", "tsc"]).join(", "),
    agentEnabled: cfg.get<boolean>("agent.enabled", false),
    agentCliPath: cfg.get<string>("agent.cliPath", "agent"),
    agentDefaultMode: cfg.get<string>("agent.defaultMode", "agent"),
    agentDefaultModel: cfg.get<string>("agent.defaultModel", ""),
    agentTimeoutMs: cfg.get<number>("agent.timeoutMs", 300000),
  });

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.type === "save") {
      const data = msg.data;
      const cfg = vscode.workspace.getConfiguration("openclaw");
      await cfg.update("gatewayHost", data.gatewayHost, vscode.ConfigurationTarget.Global);
      await cfg.update("gatewayPort", Number(data.gatewayPort), vscode.ConfigurationTarget.Global);
      await cfg.update("gatewayToken", data.gatewayToken, vscode.ConfigurationTarget.Global);
      await cfg.update("gatewayTls", data.gatewayTls, vscode.ConfigurationTarget.Global);
      await cfg.update("autoConnect", data.autoConnect, vscode.ConfigurationTarget.Global);
      await cfg.update("displayName", data.displayName, vscode.ConfigurationTarget.Global);
      await cfg.update("readOnly", data.readOnly, vscode.ConfigurationTarget.Global);
      await cfg.update("confirmWrites", data.confirmWrites, vscode.ConfigurationTarget.Global);
      await cfg.update("terminal.enabled", data.terminalEnabled, vscode.ConfigurationTarget.Global);
      await cfg.update("terminal.allowlist", data.terminalAllowlist.split(",").map((s: string) => s.trim()).filter(Boolean), vscode.ConfigurationTarget.Global);
      await cfg.update("agent.enabled", data.agentEnabled, vscode.ConfigurationTarget.Global);
      await cfg.update("agent.cliPath", data.agentCliPath, vscode.ConfigurationTarget.Global);
      await cfg.update("agent.defaultMode", data.agentDefaultMode, vscode.ConfigurationTarget.Global);
      await cfg.update("agent.defaultModel", data.agentDefaultModel, vscode.ConfigurationTarget.Global);
      await cfg.update("agent.timeoutMs", Number(data.agentTimeoutMs), vscode.ConfigurationTarget.Global);

      log("Settings saved");
      vscode.window.showInformationMessage("OpenClaw settings saved! Use 'OpenClaw: Connect' to connect.");
    }

    if (msg.type === "connect") {
      await vscode.commands.executeCommand("openclaw.connect");
    }

    if (msg.type === "installCli") {
      const cmd = process.platform === "win32"
        ? "irm 'https://cursor.com/install?win32=true' | iex"
        : "curl https://cursor.com/install -fsSL | bash";
      const term = vscode.window.createTerminal("Install Cursor Agent");
      term.show();
      term.sendText(cmd);
    }

    if (msg.type === "agentLogin") {
      const term = vscode.window.createTerminal("Cursor Agent Login");
      term.show();
      term.sendText("agent login");
    }

    if (msg.type === "loadModels") {
      try {
        const { getEnhancedEnv } = await import("./commands/agent");
        const { spawn } = require("child_process");
        const cliPath = vscode.workspace.getConfiguration("openclaw").get<string>("agent.cliPath") || "agent";
        const child = spawn(cliPath, ["--list-models", "--trust"], {
          shell: true,
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 10000,
          env: getEnhancedEnv(),
        });
        let out = "";
        child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
        child.on("close", (code: number) => {
          if (code === 0 && out.trim()) {
            const models = out.trim().split("\n")
              .map((l: string) => l.trim())
              .filter((l: string) => l && !l.startsWith("Available") && !l.startsWith("---"));
            // Parse "id - Display Name" format
            const parsed = models.map((m: string) => {
              const dash = m.indexOf(" - ");
              return dash > 0 ? { id: m.slice(0, dash).trim(), label: m.trim() } : { id: m, label: m };
            });
            panel?.webview.postMessage({ type: "modelsLoaded", models: parsed });
          } else {
            panel?.webview.postMessage({ type: "modelsError", error: "Failed to load models. Is CLI authenticated?" });
          }
        });
      } catch (e: any) {
        panel?.webview.postMessage({ type: "modelsError", error: e.message });
      }
    }
  });

  panel.onDidDispose(() => {
    panel = null;
  });
}

interface SettingsData {
  gatewayHost: string;
  gatewayPort: number;
  gatewayToken: string;
  gatewayTls: boolean;
  autoConnect: boolean;
  displayName: string;
  readOnly: boolean;
  confirmWrites: boolean;
  terminalEnabled: boolean;
  terminalAllowlist: string;
  agentEnabled: boolean;
  agentCliPath: string;
  agentDefaultMode: string;
  agentDefaultModel: string;
  agentTimeoutMs: number;
}

function getHtml(data: SettingsData): string {
  return /*html*/ `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body {
    font-family: var(--vscode-font-family, system-ui);
    padding: 20px;
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    max-width: 600px;
  }
  h1 { font-size: 1.5em; margin-bottom: 4px; }
  .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 24px; font-size: 0.9em; }
  .section { margin-bottom: 24px; }
  .section-title {
    font-size: 1.1em;
    font-weight: 600;
    margin-bottom: 12px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--vscode-widget-border, #444);
  }
  .field { margin-bottom: 14px; }
  label {
    display: block;
    margin-bottom: 4px;
    font-weight: 500;
    font-size: 0.9em;
  }
  .hint {
    color: var(--vscode-descriptionForeground);
    font-size: 0.8em;
    margin-top: 2px;
  }
  input[type="text"], input[type="number"], input[type="password"], select {
    width: 100%;
    padding: 6px 8px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, #444);
    border-radius: 4px;
    font-size: 0.9em;
    box-sizing: border-box;
  }
  input:focus, select:focus {
    outline: 1px solid var(--vscode-focusBorder);
    border-color: var(--vscode-focusBorder);
  }
  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .checkbox-row input[type="checkbox"] {
    width: 16px;
    height: 16px;
  }
  .checkbox-row label {
    margin: 0;
    font-weight: normal;
  }
  .buttons {
    display: flex;
    gap: 10px;
    margin-top: 20px;
  }
  button {
    padding: 8px 20px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9em;
    font-weight: 500;
  }
  .btn-primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
  .btn-secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
</style>
</head>
<body>

<h1>🔌 OpenClaw Node</h1>
<div class="subtitle">Connect your IDE to OpenClaw Gateway</div>

<div class="section">
  <div class="section-title">🌐 Gateway Connection</div>
  <div class="field">
    <label>Host</label>
    <input type="text" id="gatewayHost" value="${escHtml(data.gatewayHost)}" placeholder="localhost">
    <div class="hint">Gateway IP or hostname (use ZeroTier IP for remote access)</div>
  </div>
  <div class="field">
    <label>Port</label>
    <input type="number" id="gatewayPort" value="${data.gatewayPort}" placeholder="18789">
  </div>
  <div class="field">
    <label>Token</label>
    <input type="password" id="gatewayToken" value="${escHtml(data.gatewayToken)}" placeholder="Your gateway token">
    <div class="hint">Same token used by other OpenClaw Nodes</div>
  </div>
  <div class="checkbox-row">
    <input type="checkbox" id="gatewayTls" ${data.gatewayTls ? "checked" : ""}>
    <label for="gatewayTls">Use TLS (wss://)</label>
  </div>
</div>

<div class="section">
  <div class="section-title">⚙️ Node Settings</div>
  <div class="field">
    <label>Display Name</label>
    <input type="text" id="displayName" value="${escHtml(data.displayName)}" placeholder="Cursor MacBook">
    <div class="hint">How this node appears in Gateway</div>
  </div>
  <div class="checkbox-row">
    <input type="checkbox" id="autoConnect" ${data.autoConnect ? "checked" : ""}>
    <label for="autoConnect">Auto-connect on startup</label>
  </div>
</div>

<div class="section">
  <div class="section-title">🔒 Security</div>
  <div class="checkbox-row">
    <input type="checkbox" id="readOnly" ${data.readOnly ? "checked" : ""}>
    <label for="readOnly">Read-only mode (no file writes/deletes)</label>
  </div>
  <div class="checkbox-row">
    <input type="checkbox" id="confirmWrites" ${data.confirmWrites ? "checked" : ""}>
    <label for="confirmWrites">Confirm before writes/deletes</label>
  </div>
</div>

<div class="section">
  <div class="section-title">🖥️ Terminal</div>
  <div class="checkbox-row">
    <input type="checkbox" id="terminalEnabled" ${data.terminalEnabled ? "checked" : ""}>
    <label for="terminalEnabled">Enable terminal commands</label>
  </div>
  <div class="field">
    <label>Allowlist</label>
    <input type="text" id="terminalAllowlist" value="${escHtml(data.terminalAllowlist)}" placeholder="git, npm, pnpm">
    <div class="hint">Comma-separated list of allowed commands</div>
  </div>
</div>

<div class="section">
  <div class="section-title">🤖 Agent (Cursor CLI)</div>
  <div class="hint" style="margin-bottom:8px">
    Integrate with <a href="https://cursor.com/docs/cli/overview">Cursor Agent CLI</a> to delegate coding tasks.
  </div>
  <div style="display:flex;gap:6px;margin-bottom:10px">
    <button class="btn-secondary" style="padding:4px 10px;font-size:11px" onclick="vscode.postMessage({type:'installCli'})">📥 Install CLI</button>
    <button class="btn-secondary" style="padding:4px 10px;font-size:11px" onclick="vscode.postMessage({type:'agentLogin'})">🔑 Login</button>
  </div>
  <div class="row">
    <input type="checkbox" id="agentEnabled" ${data.agentEnabled ? "checked" : ""} onchange="document.getElementById('agentFields').style.display=this.checked?'block':'none'">
    <label for="agentEnabled">Enable Agent integration</label>
  </div>
  <div id="agentFields" style="display:${data.agentEnabled ? "block" : "none"}">
    <div class="field">
      <label>CLI Path</label>
      <input type="text" id="agentCliPath" value="${escHtml(data.agentCliPath)}" placeholder="agent">
      <div class="hint">Path to Cursor Agent CLI binary (default: "agent")</div>
    </div>
    <div class="field">
      <label>Default Mode</label>
      <select id="agentDefaultMode">
        <option value="agent" ${data.agentDefaultMode === "agent" ? "selected" : ""}>Agent — Full access, complex tasks</option>
        <option value="plan" ${data.agentDefaultMode === "plan" ? "selected" : ""}>Plan — Design first, then code</option>
        <option value="ask" ${data.agentDefaultMode === "ask" ? "selected" : ""}>Ask — Read-only exploration</option>
      </select>
    </div>
    <div class="field">
      <label>Default Model</label>
      <div style="display:flex;gap:6px;align-items:center">
        <select id="agentDefaultModel" style="flex:1">
          <option value="">auto (Cursor decides)</option>
          ${data.agentDefaultModel && data.agentDefaultModel !== "" ? `<option value="${escHtml(data.agentDefaultModel)}" selected>${escHtml(data.agentDefaultModel)}</option>` : ""}
        </select>
        <button class="btn-secondary" style="padding:4px 10px;font-size:11px;white-space:nowrap" onclick="vscode.postMessage({type:'loadModels'})">⟳ Load</button>
      </div>
      <div class="hint">Click "Load" to fetch available models from Cursor CLI</div>
    </div>
    <div class="field">
      <label>Timeout (ms)</label>
      <input type="number" id="agentTimeoutMs" value="${data.agentTimeoutMs}" placeholder="300000">
      <div class="hint">Max time for agent tasks (default: 300000 = 5 min)</div>
    </div>
  </div>
</div>

<div class="buttons">
  <button class="btn-primary" onclick="save()">💾 Save Settings</button>
  <button class="btn-secondary" onclick="saveAndConnect()">🔌 Save & Connect</button>
</div>

<script>
  const vscode = acquireVsCodeApi();

  function getData() {
    return {
      gatewayHost: document.getElementById('gatewayHost').value,
      gatewayPort: document.getElementById('gatewayPort').value,
      gatewayToken: document.getElementById('gatewayToken').value,
      gatewayTls: document.getElementById('gatewayTls').checked,
      autoConnect: document.getElementById('autoConnect').checked,
      displayName: document.getElementById('displayName').value,
      readOnly: document.getElementById('readOnly').checked,
      confirmWrites: document.getElementById('confirmWrites').checked,
      terminalEnabled: document.getElementById('terminalEnabled').checked,
      terminalAllowlist: document.getElementById('terminalAllowlist').value,
      agentEnabled: document.getElementById('agentEnabled').checked,
      agentCliPath: document.getElementById('agentCliPath').value,
      agentDefaultMode: document.getElementById('agentDefaultMode').value,
      agentDefaultModel: document.getElementById('agentDefaultModel').value,
      agentTimeoutMs: document.getElementById('agentTimeoutMs').value,
    };
  }

  function save() {
    vscode.postMessage({ type: 'save', data: getData() });
  }

  function saveAndConnect() {
    vscode.postMessage({ type: 'save', data: getData() });
    setTimeout(() => vscode.postMessage({ type: 'connect' }), 300);
  }

  // Listen for messages from extension
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'modelsLoaded') {
      const sel = document.getElementById('agentDefaultModel');
      const current = sel.value;
      sel.innerHTML = '<option value="">auto (Cursor decides)</option>';
      msg.models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.label;
        if (m.id === current) opt.selected = true;
        sel.appendChild(opt);
      });
    }
    if (msg.type === 'modelsError') {
      alert(msg.error);
    }
  });
</script>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
