import * as vscode from "vscode";
import { activityStore, type Activity } from "./activity-store";

/** Sidebar Webview provider — shows in the secondary sidebar or panel */
export class ActivityViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "openclaw.activityView";
  private view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getHtml();

    const update = () => {
      webviewView.webview.postMessage({
        type: "update",
        activities: activityStore.getAll(),
        stats: activityStore.getStats(),
      });
    };

    activityStore.on("change", update);
    webviewView.onDidDispose(() => {
      activityStore.removeListener("change", update);
      this.view = undefined;
    });

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "clear") activityStore.clear();
    });

    // Initial render
    update();
  }
}

function getHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root {
    --bg: var(--vscode-sideBar-background, #1e1e1e);
    --fg: var(--vscode-sideBar-foreground, #ccc);
    --border: var(--vscode-widget-border, #333);
    --card-bg: var(--vscode-editor-background, #252526);
    --ok: #4ec9b0;
    --err: #f14c4c;
    --running: #dcdcaa;
    --muted: var(--vscode-descriptionForeground, #888);
    --accent: var(--vscode-textLink-foreground, #3794ff);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family); font-size: 12px; color: var(--fg); background: var(--bg); }

  .header { padding: 8px 10px 4px; display: flex; align-items: center; justify-content: space-between; }
  .stats { font-size: 11px; color: var(--muted); display: flex; gap: 8px; }
  .stats .ok { color: var(--ok); }
  .stats .err { color: var(--err); }
  .clear-btn {
    font-size: 10px; padding: 2px 6px; border: 1px solid var(--border);
    background: transparent; color: var(--muted); cursor: pointer; border-radius: 3px;
  }
  .clear-btn:hover { color: var(--err); border-color: var(--err); }

  .filters { padding: 2px 10px 6px; display: flex; flex-wrap: wrap; gap: 3px; }
  .fbtn {
    font-size: 10px; padding: 1px 6px; border-radius: 8px; border: 1px solid var(--border);
    background: transparent; color: var(--muted); cursor: pointer;
  }
  .fbtn.active { background: var(--accent); color: #fff; border-color: transparent; }

  .timeline { padding: 0 6px 8px; }

  .card {
    border: 1px solid var(--border); border-radius: 5px; background: var(--card-bg);
    margin-bottom: 4px; overflow: hidden; cursor: pointer;
  }
  .card:hover { border-color: var(--accent); }
  .card.s-ok { border-left: 3px solid var(--ok); }
  .card.s-error { border-left: 3px solid var(--err); }
  .card.s-running { border-left: 3px solid var(--running); }

  .card-main { padding: 6px 8px; }
  .intent { font-size: 12px; font-weight: 500; line-height: 1.4; }
  .meta { display: flex; gap: 6px; align-items: center; margin-top: 3px; font-size: 10px; color: var(--muted); }
  .cmd { opacity: 0.7; }
  .dur { }
  .time { margin-left: auto; }
  .badge-ok { color: var(--ok); }
  .badge-err { color: var(--err); }
  .badge-running { color: var(--running); }

  .details { display: none; padding: 0 8px 6px; border-top: 1px solid var(--border); margin-top: 4px; padding-top: 6px; }
  .card.expanded .details { display: block; }
  .dlabel { font-size: 10px; color: var(--muted); margin-bottom: 2px; }
  .dbox {
    font-family: var(--vscode-editor-font-family, monospace); font-size: 10px;
    background: var(--bg); border: 1px solid var(--border); border-radius: 3px;
    padding: 4px 6px; white-space: pre-wrap; word-break: break-all;
    max-height: 150px; overflow-y: auto; margin-bottom: 4px;
  }
  .dbox.err { color: var(--err); }
  .empty { text-align: center; color: var(--muted); padding: 30px 10px; font-size: 11px; }
  .spinner { display: inline-block; width: 8px; height: 8px; border: 1.5px solid var(--running); border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; vertical-align: middle; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <div class="header">
    <div class="stats" id="stats"></div>
    <button class="clear-btn" id="clearBtn">Clear</button>
  </div>
  <div class="filters" id="filters"></div>
  <div class="timeline" id="timeline"></div>

<script>
  const vscode = acquireVsCodeApi();
  let activities = [];
  let stats = {};
  let filter = "all";
  const CATS = ["all","📁 File","✏️ Editor","🔍 Language","🌿 Git","🖥️ Terminal","🧪 Test","🐛 Debug","⚠️ Diagnostics","📦 Workspace"];

  function fmt(ts) { return new Date(ts).toLocaleTimeString("en-GB",{hour12:false,hour:"2-digit",minute:"2-digit",second:"2-digit"}); }
  function dur(ms) { if(ms==null) return ""; return ms<1000 ? ms+"ms" : (ms/1000).toFixed(1)+"s"; }
  function esc(s) { const d=document.createElement("div"); d.textContent=s; return d.innerHTML; }
  function trunc(o,m) { const s=typeof o==="string"?o:JSON.stringify(o,null,2); if(!s) return "—"; return s.length>m ? s.slice(0,m)+"…" : s; }

  function render() {
    // Stats
    document.getElementById("stats").innerHTML =
      '<span>' + stats.total + '</span>' +
      '<span class="ok">✓' + stats.ok + '</span>' +
      (stats.errors ? '<span class="err">✗' + stats.errors + '</span>' : '') +
      (stats.running ? '<span class="badge-running">⏳' + stats.running + '</span>' : '');

    // Filters
    document.getElementById("filters").innerHTML = CATS.map(c =>
      '<button class="fbtn ' + (filter===c?"active":"") + '" data-c="' + c + '">' + (c==="all"?"All":c) + '</button>'
    ).join("");
    document.querySelectorAll(".fbtn").forEach(b => b.onclick = () => { filter=b.dataset.c; render(); });

    // Timeline
    const el = document.getElementById("timeline");
    const list = filter==="all" ? activities : activities.filter(a=>a.category===filter);
    if(!list.length) { el.innerHTML='<div class="empty">Waiting for commands…<br>Operations from your OpenClaw AI will appear here ✨</div>'; return; }

    el.innerHTML = list.map(a => {
      const icon = a.status==="ok" ? "✓" : a.status==="error" ? "✗" : '<span class="spinner"></span>';
      return '<div class="card s-'+a.status+'" data-id="'+a.id+'">' +
        '<div class="card-main">' +
          '<div class="intent">' + esc(a.intent) + '</div>' +
          '<div class="meta">' +
            '<span class="badge-'+a.status+'">'+icon+'</span>' +
            '<span class="cmd">'+a.command.replace("vscode.","")+'</span>' +
            '<span class="dur">'+dur(a.durationMs)+'</span>' +
            '<span class="time">'+fmt(a.startedAt)+'</span>' +
          '</div>' +
        '</div>' +
        '<div class="details">' +
          '<div class="dlabel">Params</div><div class="dbox">'+esc(trunc(a.params,500))+'</div>' +
          (a.status==="ok" && a.payload ? '<div class="dlabel">Result</div><div class="dbox">'+esc(trunc(a.payload,800))+'</div>' : '') +
          (a.status==="error" && a.error ? '<div class="dlabel">Error</div><div class="dbox err">'+esc(a.error)+'</div>' : '') +
        '</div></div>';
    }).join("");

    el.querySelectorAll(".card").forEach(c => c.onclick = () => c.classList.toggle("expanded"));
  }

  document.getElementById("clearBtn").onclick = () => vscode.postMessage({type:"clear"});

  window.addEventListener("message", e => {
    if(e.data.type==="update") { activities=e.data.activities; stats=e.data.stats; render(); }
  });
  render();
</script>
</body>
</html>`;
}
