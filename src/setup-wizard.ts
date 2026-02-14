import * as vscode from "vscode";
import { log } from "./logger";
import { agentStatus, getEnhancedEnv } from "./commands/agent";

let panel: vscode.WebviewPanel | null = null;

export async function showSetupWizard(context: vscode.ExtensionContext): Promise<void> {
  if (panel) { panel.reveal(); return; }

  const isCursor = vscode.env.appName?.toLowerCase().includes("cursor") ?? false;
  const cli = await agentStatus();

  panel = vscode.window.createWebviewPanel("openclawSetup", "OpenClaw Setup", vscode.ViewColumn.One, {
    enableScripts: true, retainContextWhenHidden: true,
  });

  const cfg = vscode.workspace.getConfiguration("openclaw");

  panel.webview.html = getWizardHtml({
    isCursor,
    cliFound: cli.cliFound,
    cliVersion: cli.cliVersion || "",
    gatewayHost: cfg.get("gatewayHost", "127.0.0.1"),
    gatewayPort: cfg.get("gatewayPort", 18789),
    gatewayToken: cfg.get("gatewayToken", ""),
    gatewayTls: cfg.get("gatewayTls", false),
    autoConnect: cfg.get("autoConnect", false),
    displayName: cfg.get("displayName", "VS Code"),
    readOnly: cfg.get("readOnly", false),
    confirmWrites: cfg.get("confirmWrites", false),
    terminalEnabled: cfg.get("terminal.enabled", false),
    terminalAllowlist: cfg.get<string[]>("terminal.allowlist", ["git", "npm", "pnpm", "npx", "node", "tsc"]).join(", "),
    agentEnabled: cfg.get("agent.enabled", false),
    agentCliPath: cfg.get("agent.cliPath", "agent"),
    agentDefaultMode: cfg.get("agent.defaultMode", "agent"),
    agentDefaultModel: cfg.get("agent.defaultModel", ""),
    agentTimeoutMs: cfg.get("agent.timeoutMs", 300000),
  });

  panel.webview.onDidReceiveMessage(async (msg) => {
    const cliPath = vscode.workspace.getConfiguration("openclaw").get<string>("agent.cliPath", "agent");

    if (msg.type === "save") {
      const d = msg.data;
      const c = vscode.workspace.getConfiguration("openclaw");
      await c.update("gatewayHost", d.gatewayHost, vscode.ConfigurationTarget.Global);
      await c.update("gatewayPort", Number(d.gatewayPort), vscode.ConfigurationTarget.Global);
      await c.update("gatewayToken", d.gatewayToken, vscode.ConfigurationTarget.Global);
      await c.update("gatewayTls", d.gatewayTls, vscode.ConfigurationTarget.Global);
      await c.update("autoConnect", d.autoConnect, vscode.ConfigurationTarget.Global);
      await c.update("displayName", d.displayName, vscode.ConfigurationTarget.Global);
      await c.update("readOnly", d.readOnly, vscode.ConfigurationTarget.Global);
      await c.update("confirmWrites", d.confirmWrites, vscode.ConfigurationTarget.Global);
      await c.update("terminal.enabled", d.terminalEnabled, vscode.ConfigurationTarget.Global);
      await c.update("terminal.allowlist", d.terminalAllowlist.split(",").map((s: string) => s.trim()).filter(Boolean), vscode.ConfigurationTarget.Global);
      await c.update("agent.enabled", d.agentEnabled, vscode.ConfigurationTarget.Global);
      await c.update("agent.cliPath", d.agentCliPath, vscode.ConfigurationTarget.Global);
      await c.update("agent.defaultMode", d.agentDefaultMode, vscode.ConfigurationTarget.Global);
      await c.update("agent.defaultModel", d.agentDefaultModel, vscode.ConfigurationTarget.Global);
      await c.update("agent.timeoutMs", Number(d.agentTimeoutMs), vscode.ConfigurationTarget.Global);
      log("Setup wizard: settings saved");
      vscode.window.showInformationMessage("✅ OpenClaw configured! Connecting...");
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

    if (msg.type === "detectCli") {
      const status = await agentStatus();
      panel?.webview.postMessage({ type: "cliStatus", found: status.cliFound, version: status.cliVersion || "", path: status.cliPath });
    }

    if (msg.type === "agentLogin") {
      const term = vscode.window.createTerminal("Cursor Agent Login");
      term.show();
      term.sendText(`${cliPath} login`);
    }

    if (msg.type === "checkAuth") {
      const cp = await import("child_process");
      try {
        // Use --list-models --trust as auth check (auth status gets blocked by workspace trust)
        const out = cp.execSync(`${cliPath} --list-models --trust 2>&1`, { encoding: "utf-8", timeout: 20000, env: getEnhancedEnv() });
        const clean = out.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
        const ok = clean.includes("Available models") && !clean.includes("No models") && !clean.includes("Authentication required");
        panel?.webview.postMessage({ type: "authStatus", ok, detail: ok ? "Authenticated" : clean });
      } catch (e: any) {
        const msg = (e.stdout || e.message || "").replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
        const isTrust = msg.includes("Workspace Trust");
        panel?.webview.postMessage({ type: "authStatus", ok: false, detail: isTrust ? "Run `agent` interactively first to trust the workspace" : (msg.slice(0, 200) || "Not authenticated") });
      }
    }

    if (msg.type === "listModels") {
      const cp = await import("child_process");
      try {
        const out = cp.execSync(`${cliPath} --list-models --trust 2>&1`, { encoding: "utf-8", timeout: 20000, env: getEnhancedEnv() });
        // Parse "id - Display Name" lines, e.g. "opus-4.6-thinking - Claude 4.6 Opus (Thinking)"
        const models = out.split("\n")
          .map(l => l.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim())
          .filter(l => l.includes(" - ") && !l.startsWith("Loading") && !l.startsWith("Available") && !l.startsWith("Tip:"))
          .map(l => {
            const [id, ...rest] = l.split(" - ");
            return { id: id.trim(), name: rest.join(" - ").replace(/\s*\(current.*?\)/, "").trim() };
          })
          .filter(m => m.id && m.id !== "auto");
        panel?.webview.postMessage({ type: "modelList", models, error: null });
      } catch (e: any) {
        panel?.webview.postMessage({ type: "modelList", models: [], error: e.message || "Failed" });
      }
    }
  });

  panel.onDidDispose(() => { panel = null; });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface WizardData {
  isCursor: boolean; cliFound: boolean; cliVersion: string;
  gatewayHost: string; gatewayPort: number; gatewayToken: string; gatewayTls: boolean;
  autoConnect: boolean; displayName: string;
  readOnly: boolean; confirmWrites: boolean;
  terminalEnabled: boolean; terminalAllowlist: string;
  agentEnabled: boolean; agentCliPath: string; agentDefaultMode: string;
  agentDefaultModel: string; agentTimeoutMs: number;
}

function getWizardHtml(d: WizardData): string {
  const installCmd = process.platform === "win32"
    ? "irm &#39;https://cursor.com/install?win32=true&#39; | iex"
    : "curl https://cursor.com/install -fsSL | bash";

  return /*html*/`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<style>
:root{--bg:var(--vscode-editor-background);--fg:var(--vscode-editor-foreground);--border:var(--vscode-widget-border,#444);--card:var(--vscode-sideBar-background,#252526);--accent:var(--vscode-button-background,#0e639c);--accent-fg:var(--vscode-button-foreground,#fff);--muted:var(--vscode-descriptionForeground,#888);--ok:#4ec9b0;--err:#f14c4c;--warn:#dcdcaa}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);color:var(--fg);background:var(--bg)}
.wiz{max-width:640px;margin:0 auto;padding:20px}
h1{font-size:20px;margin-bottom:4px}
.sub{color:var(--muted);font-size:13px;margin-bottom:20px}
.progress{display:flex;gap:4px;margin-bottom:24px}
.dot{flex:1;height:4px;border-radius:2px;background:var(--border);transition:background .3s}
.dot.active{background:var(--accent)}.dot.done{background:var(--ok)}
.step{display:none}.step.visible{display:block}
.st{font-size:16px;font-weight:600;margin-bottom:4px}
.sd{color:var(--muted);font-size:12px;margin-bottom:16px;line-height:1.5}
.field{margin-bottom:12px}
.field label{display:block;font-size:12px;font-weight:500;margin-bottom:4px}
.field input[type="text"],.field input[type="number"],.field input[type="password"],.field select{width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:4px;background:var(--card);color:var(--fg);font-size:13px}
.hint{font-size:11px;color:var(--muted);margin-top:2px}
.row{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.row input[type="checkbox"]{width:16px;height:16px}
.row label{font-size:13px;cursor:pointer}
.preset-btns{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}
.preset{padding:4px 10px;border:1px solid var(--border);border-radius:12px;background:transparent;color:var(--fg);cursor:pointer;font-size:11px}
.preset:hover,.preset.active{background:var(--accent);color:var(--accent-fg);border-color:transparent}
.sta{padding:10px 14px;border-radius:6px;margin-bottom:8px;border:1px solid var(--border);font-size:12px}
.sta.ok{border-color:var(--ok);background:rgba(78,201,176,.08)}
.sta.warn{border-color:var(--warn);background:rgba(220,220,170,.08)}
.sta.neu{border-color:var(--muted)}
code{background:var(--card);padding:2px 6px;border-radius:3px;font-size:11px}
.buttons{display:flex;gap:8px;margin-top:20px}
.btn{padding:8px 20px;border-radius:4px;border:none;cursor:pointer;font-size:13px;font-weight:500}
.btn-p{background:var(--accent);color:var(--accent-fg)}
.btn-s{background:transparent;border:1px solid var(--border);color:var(--fg)}
.btn-skip{background:transparent;color:var(--muted);border:none;font-size:12px}
.btn:hover{opacity:.9}
.btn-sm{padding:4px 12px;font-size:11px}
.spacer{flex:1}
.card{margin-bottom:16px;padding:12px;border:1px solid var(--border);border-radius:6px}
.card-title{font-weight:600;font-size:13px;margin-bottom:8px}
.btn-row{display:flex;gap:6px;margin-bottom:4px}
</style></head><body>
<div class="wiz">
  <h1>🔌 OpenClaw Setup</h1>
  <div class="sub">Connect your IDE to OpenClaw Gateway${d.isCursor ? " (Cursor detected ✨)" : ""}</div>
  <div class="progress"><div class="dot" id="d0"></div><div class="dot" id="d1"></div><div class="dot" id="d2"></div><div class="dot" id="d3"></div></div>

  <!-- Step 0: Gateway -->
  <div class="step" id="s0">
    <div class="st">📡 Step 1: Gateway Connection</div>
    <div class="sd">Connect to your OpenClaw Gateway.</div>
    <div class="field"><label>Host</label><input type="text" id="gatewayHost" value="${esc(d.gatewayHost)}" placeholder="127.0.0.1"><div class="hint">LAN IP for local, ZeroTier IP for remote</div></div>
    <div class="field"><label>Port</label><input type="number" id="gatewayPort" value="${d.gatewayPort}"></div>
    <div class="field"><label>Token</label><input type="password" id="gatewayToken" value="${esc(d.gatewayToken)}" placeholder="gateway.auth.token from config"><div class="hint">Find in your OpenClaw config: <code>gateway.auth.token</code></div></div>
    <div class="row"><input type="checkbox" id="gatewayTls" ${d.gatewayTls ? "checked" : ""}><label for="gatewayTls">Use TLS (wss://)</label></div>
    <div class="field"><label>Display Name</label><input type="text" id="displayName" value="${esc(d.displayName)}" placeholder="My VS Code"><div class="hint">How this node appears in Gateway</div></div>
    <div class="row"><input type="checkbox" id="autoConnect" ${d.autoConnect ? "checked" : ""}><label for="autoConnect">Auto-connect on startup</label></div>
  </div>

  <!-- Step 1: Security -->
  <div class="step" id="s1">
    <div class="st">🔒 Step 2: Security & Permissions</div>
    <div class="sd">Control what OpenClaw can do in your workspace.</div>
    <div class="sd" style="font-weight:500;color:var(--fg)">Quick Presets:</div>
    <div class="preset-btns">
      <button class="preset" onclick="applyPreset('strict')">🔐 Strict (read-only)</button>
      <button class="preset" onclick="applyPreset('standard')">⚖️ Standard (confirm writes)</button>
      <button class="preset" onclick="applyPreset('trusted')">🤝 Trusted (full access)</button>
    </div>
    <div class="row"><input type="checkbox" id="readOnly" ${d.readOnly ? "checked" : ""}><label for="readOnly">Read-only mode</label></div>
    <div class="row"><input type="checkbox" id="confirmWrites" ${d.confirmWrites ? "checked" : ""}><label for="confirmWrites">Confirm before writes/deletes</label></div>
    <div style="margin-top:16px"><div class="sd" style="font-weight:500;color:var(--fg)">🖥️ Terminal Access</div></div>
    <div class="row"><input type="checkbox" id="terminalEnabled" ${d.terminalEnabled ? "checked" : ""}><label for="terminalEnabled">Enable terminal commands</label></div>
    <div class="field"><label>Allowlist</label><input type="text" id="terminalAllowlist" value="${esc(d.terminalAllowlist)}" placeholder="git, npm, pnpm"><div class="hint">Comma-separated. <code>*</code> = allow all (⚠️)</div></div>
  </div>

  <!-- Step 2: Agent CLI -->
  <div class="step" id="s2">
    <div class="st">🤖 Step 3: Cursor Agent CLI (Optional)</div>
    <div class="sd">Delegate coding tasks to Cursor Agent. <b>Skip if not needed.</b></div>

    <div class="card">
      <div class="card-title">1️⃣ Install CLI</div>
      <div class="sta ${d.cliFound ? "ok" : "warn"}" id="cliSta">${d.cliFound ? "✅ Installed — " + esc(d.cliVersion) : "⚠️ Not installed"}</div>
      <div class="btn-row"><button class="btn btn-s btn-sm" onclick="installCli()">📥 Install</button><button class="btn btn-s btn-sm" onclick="detectCli()">🔄 Re-detect</button></div>
      <div class="hint"><code>${installCmd}</code></div>
    </div>

    <div class="card">
      <div class="card-title">2️⃣ Login to Cursor</div>
      <div class="sta neu" id="authSta">🔑 Click "Login" to authenticate</div>
      <div class="btn-row"><button class="btn btn-s btn-sm" onclick="agentLogin()">🔑 Login</button><button class="btn btn-s btn-sm" onclick="checkAuth()">🔄 Check</button></div>
      <div class="hint">Opens browser to authorize. Or set <code>CURSOR_API_KEY</code> env var.</div>
    </div>

    <div class="card">
      <div class="card-title">3️⃣ Configure</div>
      <div class="row"><input type="checkbox" id="agentEnabled" ${d.agentEnabled ? "checked" : ""} onchange="toggleAgent()"><label for="agentEnabled">Enable Agent integration</label></div>
      <div id="agentFields" style="display:${d.agentEnabled ? "block" : "none"}">
        <div class="field"><label>CLI Path</label><input type="text" id="agentCliPath" value="${esc(d.agentCliPath)}" placeholder="agent"></div>
        <div class="field"><label>Default Mode</label>
          <select id="agentDefaultMode">
            <option value="agent" ${d.agentDefaultMode === "agent" ? "selected" : ""}>Agent — Full access</option>
            <option value="plan" ${d.agentDefaultMode === "plan" ? "selected" : ""}>Plan — Design first</option>
            <option value="ask" ${d.agentDefaultMode === "ask" ? "selected" : ""}>Ask — Read-only</option>
          </select>
        </div>
        <div class="field"><label>Default Model</label>
          <select id="agentDefaultModel"><option value="">auto (recommended)</option></select>
          <div class="btn-row" style="margin-top:4px"><button class="btn btn-s btn-sm" onclick="loadModels()">📋 Load Models</button></div>
          <div class="hint" id="modelHint">Click "Load Models" after login to fetch available models</div>
        </div>
        <div class="field"><label>Timeout (ms)</label><input type="number" id="agentTimeoutMs" value="${d.agentTimeoutMs}"></div>
      </div>
    </div>
  </div>

  <!-- Step 3: Review -->
  <div class="step" id="s3">
    <div class="st">✅ Step 4: Review & Connect</div>
    <div class="sd">Review your configuration and connect.</div>
    <div id="summary" style="background:var(--card);border:1px solid var(--border);border-radius:6px;padding:12px;font-size:12px;line-height:1.8"></div>
  </div>

  <div class="buttons">
    <button class="btn btn-s" id="btnBack" onclick="prev()" style="display:none">← Back</button>
    <span class="spacer"></span>
    <button class="btn btn-skip" id="btnSkip" onclick="skip()" style="display:none">Skip →</button>
    <button class="btn btn-p" id="btnNext" onclick="next()">Next →</button>
  </div>
</div>

<script>
const vscode = acquireVsCodeApi();
let step = 0, total = 4;
let savedModel = "${esc(d.agentDefaultModel)}";

function show(s) {
  step = s;
  for (let i = 0; i < total; i++) {
    document.getElementById('s'+i).classList.toggle('visible', i===s);
    const dot = document.getElementById('d'+i);
    dot.classList.toggle('active', i===s);
    dot.classList.toggle('done', i<s);
  }
  document.getElementById('btnBack').style.display = s>0?'':'none';
  document.getElementById('btnSkip').style.display = s===2?'':'none';
  document.getElementById('btnNext').textContent = s===total-1?'🚀 Save & Connect':'Next →';
  if (s===total-1) renderSummary();
}

function next() {
  if (step===0 && !document.getElementById('gatewayToken').value.trim()) {
    if (!confirm('No token set. Continue?')) return;
  }
  if (step===total-1) { save(); return; }
  show(step+1);
}
function prev() { if(step>0) show(step-1); }
function skip() { show(step+1); }

function applyPreset(p) {
  const ro=document.getElementById('readOnly'), cw=document.getElementById('confirmWrites');
  const te=document.getElementById('terminalEnabled'), al=document.getElementById('terminalAllowlist');
  document.querySelectorAll('.preset').forEach(b=>b.classList.remove('active'));
  event.target.classList.add('active');
  if(p==='strict'){ro.checked=true;cw.checked=false;te.checked=false;al.value='';}
  if(p==='standard'){ro.checked=false;cw.checked=true;te.checked=true;al.value='git, npm, pnpm, npx, node, tsc';}
  if(p==='trusted'){ro.checked=false;cw.checked=false;te.checked=true;al.value='*';}
}

function toggleAgent() {
  document.getElementById('agentFields').style.display = document.getElementById('agentEnabled').checked?'block':'none';
}

function getData() {
  return {
    gatewayHost:document.getElementById('gatewayHost').value,
    gatewayPort:document.getElementById('gatewayPort').value,
    gatewayToken:document.getElementById('gatewayToken').value,
    gatewayTls:document.getElementById('gatewayTls').checked,
    autoConnect:document.getElementById('autoConnect').checked,
    displayName:document.getElementById('displayName').value,
    readOnly:document.getElementById('readOnly').checked,
    confirmWrites:document.getElementById('confirmWrites').checked,
    terminalEnabled:document.getElementById('terminalEnabled').checked,
    terminalAllowlist:document.getElementById('terminalAllowlist').value,
    agentEnabled:document.getElementById('agentEnabled').checked,
    agentCliPath:document.getElementById('agentCliPath').value,
    agentDefaultMode:document.getElementById('agentDefaultMode').value,
    agentDefaultModel:document.getElementById('agentDefaultModel').value,
    agentTimeoutMs:document.getElementById('agentTimeoutMs').value,
  };
}

function renderSummary() {
  const d=getData();
  const l=[
    '<b>📡 Gateway:</b> '+esc(d.gatewayHost)+':'+d.gatewayPort+(d.gatewayTls?' (TLS)':''),
    '<b>🏷️ Name:</b> '+esc(d.displayName),
    '<b>🔑 Token:</b> '+(d.gatewayToken?'***':'⚠️ none'),
    '<b>🔄 Auto-connect:</b> '+(d.autoConnect?'Yes':'No'),
    '',
    '<b>🔒 Security:</b> '+(d.readOnly?'Read-only':d.confirmWrites?'Confirm writes':'Full access'),
    '<b>🖥️ Terminal:</b> '+(d.terminalEnabled?'Enabled ('+esc(d.terminalAllowlist||'none')+')':'Disabled'),
    '',
    '<b>🤖 Agent:</b> '+(d.agentEnabled?'Enabled (mode: '+d.agentDefaultMode+(d.agentDefaultModel?', model: '+esc(d.agentDefaultModel):'')+')':'Disabled'),
  ];
  document.getElementById('summary').innerHTML=l.join('<br>');
}

function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}

function save(){vscode.postMessage({type:'save',data:getData()});}
function installCli(){vscode.postMessage({type:'installCli'});}
function detectCli(){vscode.postMessage({type:'detectCli'});}
function agentLogin(){vscode.postMessage({type:'agentLogin'});}
function checkAuth(){vscode.postMessage({type:'checkAuth'});}
function loadModels(){
  document.getElementById('modelHint').textContent='Loading...';
  vscode.postMessage({type:'listModels'});
}

window.addEventListener('message', e=>{
  const m=e.data;
  if(m.type==='cliStatus'){
    const el=document.getElementById('cliSta');
    if(m.found){el.className='sta ok';el.textContent='✅ Installed — '+m.version;document.getElementById('agentEnabled').checked=true;toggleAgent();}
    else{el.className='sta warn';el.textContent='⚠️ Not installed';}
  }
  if(m.type==='authStatus'){
    const el=document.getElementById('authSta');
    if(m.ok){el.className='sta ok';el.textContent='✅ Authenticated';}
    else{el.className='sta warn';el.textContent='⚠️ '+(m.detail||'Not authenticated');}
  }
  if(m.type==='modelList'){
    const sel=document.getElementById('agentDefaultModel');
    const hint=document.getElementById('modelHint');
    sel.innerHTML='<option value="">auto (recommended)</option>';
    if(m.error){hint.textContent='❌ '+m.error;return;}
    if(!m.models.length){hint.textContent='No models found. Login first?';return;}
    m.models.forEach(mod=>{
      const opt=document.createElement('option');
      const id = mod.id || mod;
      const label = mod.name ? (mod.name + ' (' + id + ')') : id;
      opt.value=id;opt.textContent=label;
      if(id===savedModel) opt.selected=true;
      sel.appendChild(opt);
    });
    hint.textContent='✅ '+m.models.length+' models loaded';
  }
});

show(0);
</script></body></html>`;
}
