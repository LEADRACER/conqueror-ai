/* Alex Operations Console — vanilla JS, no deps. */
"use strict";
/* top-level async + module scope for await */
const __mod = (async () => {

/* ---------- tiny utils ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...childArgs) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  const flatten = (list) => {
    const out = [];
    for (const c of list) {
      if (Array.isArray(c)) out.push(...flatten(c));
      else if (c !== null && c !== undefined) out.push(c);
    }
    return out;
  };
  for (const c of flatten(childArgs)) {
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
};
const esc = (s) => (s ?? "").toString().replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtTime = (iso) => {
  if (!iso) return "–";
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
const ago = (iso) => {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

/* markdown-lite: escape html, then render headings, code blocks, inline code, bold/ital, links, lists */
function md(src) {
  const escaped = esc(src ?? "");
  const blocks = [];
  let out = escaped.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push(`<pre><code>${code.replace(/\n$/, "")}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  out = out
    .replace(/^### (.*)$/gm, '<b>$1</b>')
    .replace(/^## (.*)$/gm, '<h2 style="font-size:14px;margin:10px 0 4px">$1</h2>')
    .replace(/^# (.*)$/gm, '<h2 style="font-size:15px;margin:10px 0 4px">$1</h2>')
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,;:!?)])/g, "$1<i>$2</i>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/^[-*] /gm, "&bull; ");
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)]);
  return out.replace(/\n/g, "<br>");
}

/* ---------- state ---------- */
const state = {
  view: "overview",
  boot: null,
  health: null,
  providers: [],
  conversations: [],
  currentConv: null,
  chatMessages: [],
  toolChips: [],
  streaming: null, // runId currently streaming in chat
  missions: [],
  tasks: [],
  projects: [],
  workflows: [],
  tools: [],
  approvals: [],
  memory: [],
  events: [],
  runs: [],
  runsById: new Map(),
  filters: { activityType: "", taskStatus: "", eventQuery: "" },
  dirty: { missions: true, tasks: true, workflows: true, memory: true, tools: true, conversations: true },
};

const api = async (path, opts = {}) => {
  const resp = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...opts,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = data?.error ?? `HTTP ${resp.status}`;
    if (!opts.quiet) toast(msg, "err");
    throw new Error(msg);
  }
  return data;
};

function toast(msg, kind = "") {
  const t = el("div", { class: `toast ${kind}`, text: typeof msg === "string" ? msg : JSON.stringify(msg) });
  $("#toast-root").append(t);
  setTimeout(() => t.remove(), 5200);
}

/* ---------- SSE ---------- */
let evtSource = null;
let lastEventId = 0;
function connectEvents() {
  if (evtSource) evtSource.close();
  evtSource = new EventSource(`/api/events?since=${lastEventId}${TOKEN ? `&token=${encodeURIComponent(TOKEN)}` : ""}`);
  evtSource.onmessage = (ev) => {
    lastEventId = Number(ev.lastEventId) || lastEventId + 1;
    try {
      handleEvent(JSON.parse(ev.data));
    } catch { /* ignore */ }
  };
}

function handleEvent(evt) {
  const { type } = evt;
  const run = evt.runId ? state.runsById.get(evt.runId) : null;
  if (evt.type.startsWith("run.") || evt.type.startsWith("task.") || evt.type.startsWith("mission.") ||
      evt.type.startsWith("workflow.") || evt.type.startsWith("approval.")) {
    state.events.push(evt);
    if (state.view === "overview") renderOverview();
    if (state.view === "activity" || (state.view === "approvals" && type.startsWith("approval."))) return render();
  }
  if (type === "run.delta" && evt.runId === state.streaming) {
    appendStream(evt.data?.delta ?? "");
  }
  if (type === "run.tool_ok" || type === "run.tool_err" || type === "run.tool_pending") {
    const chip = { name: evt.data?.tool ?? "tool", status: type === "run.tool_ok" ? "ok" : type === "run.tool_err" ? "err" : "wait", ms: evt.data?.ms };
    state.toolChips.push(chip);
    if (evt.runId === state.streaming) renderToolChips();
  }
  if (type === "run.started") {
    state.runsById.set(evt.runId, { id: evt.runId, status: "running", request: evt.data?.request });
    state.dirty.tasks = true; state.dirty.missions = true;
  }
  if (type === "run.completed" || type === "run.failed" || type === "run.cancelled") {
    state.dirty.tasks = true; state.dirty.missions = true; state.dirty.workflows = true;
    if (evt.runId === state.streaming) {
      finalizeStream(type === "run.completed" ? "ok" : (type === "run.cancelled" ? "cancelled" : "err"), evt.message);
    }
    refreshRunsCache();
    if (state.view === "tasks" || state.view === "missions") render();
  }
  if (type === "approval.requested") {
    if (isFresh(evt)) toast(`Approval requested: ${evt.data?.tool ?? ""} (see Approvals)`, "err");
    api("/api/approvals", { quiet: true }).then((d) => { state.approvals = d.approvals; if (state.view === "approvals" || state.view === "overview") render(); });
  }
  if (type === "system.warning" && isFresh(evt)) toast(evt.message, "err");
  updateTopbar();
}

const isFresh = (evt) => (Date.now() - new Date(evt.ts).getTime()) < 5000;

async function refreshRunsCache() {
  try {
    const d = await api("/api/runs", { quiet: true });
    state.runs = d.runs;
    state.runsById = new Map(d.runs.map((r) => [r.id, r]));
  } catch { /* */ }
}

/* ---------- topbar / sidebar ---------- */
const NAV = [
  ["overview", "Overview", "◈"],
  ["chat", "Chat", "◆"],
  ["missions", "Missions", "▲"],
  ["tasks", "Tasks", "≡"],
  ["projects", "Projects", "▣"],
  ["workflows", "Workflows", "⟳"],
  ["approvals", "Approvals", "✓"],
  null,
  ["tools", "Tools", "⬡"],
  ["models", "Models", "≋"],
  ["memory", "Memory", "›"],
  ["activity", "Activity", "≣"],
  ["settings", "Settings", "⚙"],
];

function renderNav() {
  const nav = $("#nav");
  nav.innerHTML = "";
  for (const item of NAV) {
    if (item === null) {
      nav.append(el("div", { class: "nav-section", text: "System" }));
      continue;
    }
    const [id, label, ico] = item;
    const node = el("div", { class: `nav-item ${state.view === id ? "active" : ""}`, role: "button", tabindex: "0", onclick: () => go(id) },
      el("span", { class: "nav-ico", text: ico }), el("span", { text: label }));
    const badge = navBadgeFor(id);
    if (badge) node.append(badge);
    nav.append(node);
  }
}

function navBadgeFor(id) {
  const b = state.boot?.counts;
  if (!b) return null;
  if (id === "approvals" && b.pendingApprovals > 0) return el("span", { class: "nav-badge err", text: String(b.pendingApprovals) });
  if (id === "tasks") return null;
  if (id === "chat" && state.streaming) return el("span", { class: "nav-badge ok", text: "●" });
  return null;
}

function updateTopbar() {
  const a = state.boot?.agent ?? { status: "idle", detail: "" };
  const pill = $("#agent-status");
  pill.innerHTML = "";
  pill.append(el("span", { class: `dot dot-${a.status}` }), el("b", { text: a.status.replace("_", " ") }));
  const s = state.boot?.settings;
  $("#model-pill").textContent = `${s?.provider ?? "–"} / ${s?.model ?? "–"}`;
  renderNav();
}

/* ---------- router ---------- */
function go(view, arg) {
  state.view = view;
  state._arg = arg;
  if (view === "chat") { void setupChat(arg?.conversationId); return; }
  if (view === "memory") void loadMemory().then(render);
  if (view === "tools") void loadTools().then(render);
  if (view === "workflows") void loadWorkflows().then(render);
  if (view === "approvals") void loadApprovals().then(render);
  if (view === "chat") return;
  render();
  location.hash = `#/${view}`;
}

function render() {
  renderNav();
  updateTopbar();
  const ws = $("#workspace");
  ws.innerHTML = "";
  const views = { overview, chat, missions, tasks, projects, workflows, tools, memory, activity, approvals, models, settings };
  (views[state.view] ?? overview)(ws);
}

/* =========================================================
   OVERVIEW
========================================================= */
function overview(ws) {
  const agent = state.boot?.agent ?? { status: "idle", detail: "" };
  const counts = state.boot?.counts ?? {};
  const health = state.health ?? { checks: [] };
  const openRuns = state.runs.filter((r) => r.status === "running" || r.status === "waiting_approval");
  const failed = state.runs.filter((r) => r.status === "failed").slice(0, 5);
  const pending = state.approvals.filter((a) => a.status === "pending");

  const wsEl = ws ?? $("#workspace");
  wsEl.innerHTML = "";
  wsEl.append(el("h1", { text: "Command Center" }), el("p", { class: "page-sub", text: "What Alex is doing, what needs attention, and how the systems are holding up." }));

  /* status strip */
  const strip = el("div", { class: "stat-strip" });
  const mkStat = (k, v) => el("div", { class: "stat" }, [el("div", { class: "k", text: k }), el("div", { class: "v", text: v })]);
  strip.append(
    mkStat("Missions", counts.missions ?? 0),
    mkStat("Tasks", counts.tasks ?? 0),
    mkStat("Conversations", counts.conversations ?? 0),
    mkStat("Runs", counts.runs ?? 0),
    mkStat("Workflows", counts.workflows ?? 0)
  );
  wsEl.append(strip);

  /* agent status */
  const s = state.boot?.settings ?? {};
  const activeRun = openRuns[0];
  const lastDone = state.runs.find((r) => r.status === "completed");
  wsEl.append(el("div", { class: "panel" }, [
    el("h2", { text: "Agent Status" }),
    el("div", { class: "status-big" }, [
      el("span", { class: `dot dot-${agent.status}` }),
      el("div", {}, [
        el("div", { class: "name", text: agent.status === "idle" ? "Idle" : agent.status.replace("_", " ").replace(/^./, (c) => c.toUpperCase()) }),
        el("div", { class: "faint", text: agent.detail ?? "" }),
      ]),
      el("div", { style: "margin-left:auto;text-align:right" }, [
        el("div", { class: "mono", text: `${s.provider ?? "–"} · ${s.model ?? "–"}` }),
        el("div", { class: "faint", style: "font-size:11px", text: lastDone ? `Last success ${ago(lastDone.endedAt)}` : "No completed runs yet" }),
      ]),
    ]),
    activeRun ? el("div", { style: "margin-top:12px;font-size:12.5px" }, [
      el("span", { class: "muted", text: "Active run: " }),
      el("span", { class: "mono", text: (activeRun.request ?? "").slice(0, 90) }),
      el("button", { class: "btn sm ghost", style: "margin-left:8px", text: "Cancel", onclick: () => cancelRun(activeRun.id) }),
    ]) : null,
    agent.status === "waiting_approval" ? el("div", { style: "margin-top:8px" }, el("button", { class: "btn sm", text: "Review approval →", onclick: () => go("approvals") })) : null,
  ]));

  const grid = el("div", { class: "grid cols-2", style: "margin-top:14px" });

  /* attention */
  const attention = el("div", { class: "panel" }, [el("h2", { text: "Attention Required" })]);
  let attentionCount = 0;
  for (const a of pending) {
    attentionCount++;
    attention.append(approvalRow(a, true));
  }
  for (const r of failed) {
    attentionCount++;
    attention.append(el("div", { class: "activity-item" }, [
      el("span", { class: "badge b-failed", text: "failed" }),
      el("div", { class: "activity-msg" }, [
        el("div", { text: (r.request ?? "").slice(0, 80) }),
        el("div", { class: "faint", style: "font-size:11px", text: r.error?.slice(0, 110) ?? "" }),
      ]),
      el("button", { class: "btn sm ghost", text: "Retry", onclick: () => retryRun(r) }),
    ]));
  }
  if (attentionCount === 0) attention.append(el("div", { class: "empty", text: "Nothing needs your attention." }));
  grid.append(attention);

  /* health */
  const healthPanel = el("div", { class: "panel" }, [
    el("h2", { text: "System Health" }),
    ...health.checks.map((c) => {
      return el("div", { class: "health-row" }, [
        el("span", { class: "ok-dot", style: `background:${c.ok === null ? "var(--dim)" : c.ok ? "var(--ok)" : "var(--err)"}` }),
        el("span", { class: "health-name", text: c.label }),
        el("span", { class: "health-detail", text: c.detail }),
      ]);
    }),
    el("div", { style: "margin-top:10px" }, el("button", { class: "btn sm ghost", text: "Re-probe", onclick: () => probeHealth().then(() => { if (state.view === "overview") render(); }) })),
  ]);
  grid.append(healthPanel);
  wsEl.append(grid);

  /* activity */
  const recent = [...state.events].slice(-40).reverse();
  const acts = el("div", { class: "panel", style: "margin-top:14px" }, [
    el("h2", { text: "Recent Activity" }),
    recent.length === 0 ? el("div", { class: "empty", text: "No events yet." }) : recent.map(activityRow),
    recent.length > 0 ? el("div", { style: "margin-top:8px" }, el("button", { class: "btn sm ghost", text: "View all activity →", onclick: () => go("activity") })) : null,
  ]);
  wsEl.append(acts);
}

function activityRow(e) {
  return el("div", { class: "activity-item" }, [
    el("span", { class: "activity-type", text: e.type }),
    el("div", { class: "activity-msg" }, [el("span", { text: e.message })]),
    el("span", { class: "activity-ts", text: ago(e.ts) }),
  ]);
}

function approvalRow(a, compact) {
  return el("div", { class: "panel", style: compact ? "padding:10px 12px;margin-bottom:8px;background:var(--panel-2)" : "" }, [
    el("div", { style: "display:flex;gap:8px;align-items:center" }, [
      el("span", { class: `badge b-pending`, text: "pending approval" }),
      el("b", { class: "mono", text: a.tool }),
      el("span", { class: "faint", mono: "", text: ago(a.createdAt) }),
    ]),
    el("div", { class: "mono faint", style: "margin:6px 0;font-size:11px;word-break:break-all", text: a.argsPreview }),
    el("div", { style: "display:flex;gap:6px" }, [
      el("button", { class: "btn primary sm", text: "Approve", onclick: async () => { await api(`/api/approvals/${a.id}/decision`, { method: "POST", body: { approved: true } }); toast("Approved", "ok"); void loadApprovals().then(render); } }),
      el("button", { class: "btn danger sm", text: "Reject", onclick: async () => { await api(`/api/approvals/${a.id}/decision`, { method: "POST", body: { approved: false } }); toast("Rejected"); void loadApprovals().then(render); } }),
    ]),
  ]);
}

async function probeHealth() {
  try {
    const d = await api("/api/health", { quiet: true });
    state.health = d;
  } catch { /* */ }
}

async function cancelRun(runId) {
  await api(`/api/runs/${runId}/cancel`, { method: "POST", quiet: true });
  toast("Cancellation requested");
}
async function retryRun(r) {
  await api("/api/runs", { method: "POST", body: { request: r.request, conversationId: r.conversationId, missionId: r.missionId, projectId: r.projectId } });
  toast("New run started");
}

/* =========================================================
   CHAT
========================================================= */
async function setupChat(conversationId) {
  if (state.dirty.conversations) {
    try {
      const d = await api("/api/conversations", { quiet: true });
      state.conversations = d.conversations;
      state.dirty.conversations = false;
    } catch { /* */ }
  }
  if (conversationId) state.currentConv = conversationId;
  if (!state.currentConv || !state.conversations.some((c) => c.id === state.currentConv)) {
    state.currentConv = state.conversations[0]?.id ?? null;
  }
  if (state.currentConv) {
    try {
      const d = await api(`/api/conversations/${state.currentConv}`, { quiet: true });
      state.chatMessages = d.conversation.messages;
      state.conversations = state.conversations.map((c) => (c.id === d.conversation.id ? d.conversation : c));
    } catch { /* */ }
  } else {
    state.chatMessages = [];
  }
  state.toolChips = [];
  render();
}

function chat(ws) {
  const conv = state.conversations.find((c) => c.id === state.currentConv);
  const wsEl = ws ?? $("#workspace");
  wsEl.innerHTML = "";

  // list column
  const list = el("div", { class: "chat-list" }, [
    el("div", { class: "chat-list-head" }, [
      el("b", { style: "flex:1", text: "Conversations" }),
      el("button", { class: "icon-btn", text: "+", title: "New conversation", onclick: async () => {
        const d = await api("/api/conversations", { method: "POST" });
        state.conversations.push(d.conversation);
        go("chat", { conversationId: d.conversation.id });
      } }),
    ]),
  ]);
  const items = el("div", { class: "chat-items" });
  for (const c of state.conversations) {
    const item = el("div", { class: `conv-item ${c.id === state.currentConv ? "active" : ""}`, onclick: () => go("chat", { conversationId: c.id }) }, [
      el("div", { class: "conv-title", text: c.title }),
      el("div", { class: "conv-meta", text: `${c.messages.length} msgs · ${ago(c.updatedAt)}` }),
    ]);
    items.append(item);
  }
  if (state.conversations.length === 0) items.append(el("div", { class: "empty", text: "No conversations yet." }));
  list.append(items);

  // main column
  const main = el("div", { class: "chat-main" });
  const head = el("div", { style: "display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--border)" }, [
    el("b", { style: "flex:1", text: conv?.title ?? "New chat" }),
    conv ? el("button", { class: "btn sm ghost", text: "Rename", onclick: () => renameConversation(conv) }) : null,
    conv ? el("button", { class: "btn sm ghost danger", text: "Delete", onclick: async () => { await api(`/api/conversations/${conv.id}`, { method: "DELETE" }); state.currentConv = null; state.dirty.conversations = true; go("chat", {}); } }) : null,
  ]);
  const scroll = el("div", { class: "chat-scroll", id: "chat-scroll" });
  state.chatScroll = scroll;
  scroll.append(el("div", { class: "stream-dot" }));

  for (const m of state.chatMessages) {
    scroll.append(messageNode(m));
  }
  scroll.scrollTop = scroll.scrollHeight;

  // composer
  const ta = el("textarea", { id: "chat-input", placeholder: "Message Alex… (Enter to send, Shift+Enter for newline)" });
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendChat();
    }
  });
  const sendBtn = el("button", { class: "btn primary", text: "Send ▸", onclick: () => void sendChat() });
  const cancelBtn = el("button", { class: "btn danger hidden", id: "chat-cancel", text: "Stop", onclick: () => state.streaming && cancelRun(state.streaming) });
  const composer = el("div", { class: "chat-composer" }, [ta, cancelBtn, sendBtn]);

  // right: tool activity
  const side = el("div", { class: "activity-panel" }, [
    el("h3", { text: "Tool Activity" }),
    el("div", { class: "faint", style: "font-size:11px;margin-bottom:8px", text: "Tools executed in this conversation." }),
    el("div", { id: "tool-chips" }),
  ]);
  main.append(head, scroll, composer);
  wsEl.append(el("div", { class: "chat-layout", style: "margin-top:6px" }, [list, main, side]));
  renderToolChips();
  ta.focus();
}

function messageNode(m) {
  if (m.role === "tool") {
    return el("div", { class: "msg-tool" }, [el("b", { text: "tool: " }), m.content?.slice(0, 200) ?? ""]);
  }
  const node = el("div", { class: `msg ${m.role}` });
  node.append(el("div", { class: "msg-inner" }));
  node.firstChild.innerHTML = md(m.content) + (m.content === "" ? "" : "");
  node.append(el("div", { class: "msg-meta", text: `${m.role} · ${fmtTime(m.ts)}` }));
  return node;
}

function renderToolChips() {
  const box = $("#tool-chips");
  if (!box) return;
  box.innerHTML = "";
  for (const chip of state.toolChips.slice(-15)) {
    box.append(el("div", { class: "tool-chip" }, [
      el("span", { class: `t-${chip.status}`, text: chip.status === "ok" ? "✓" : chip.status === "err" ? "✕" : "⏳" }),
      el("span", { text: chip.name }),
      chip.ms ? el("span", { class: "faint", text: `${chip.ms}ms` }) : null,
    ]));
  }
}

function appendStream(delta) {
  state.streamBuf = (state.streamBuf ?? "") + delta;
  const scroll = state.chatScroll;
  if (!scroll) return;
  state._streamNode = state._streamNode ?? createStreamNode();
  state._streamNode.querySelector(".msg-content").innerHTML = md(state.streamBuf) + '<span class="stream-cursor"></span>';
  scroll.scrollTop = scroll.scrollHeight;
}

function createStreamNode() {
  const scroll = state.chatScroll;
  if (!scroll) return null;
  const node = el("div", { class: "msg assistant" }, [
    el("div", { class: "msg-inner" }, [el("div", { class: "msg-content" })]),
    el("div", { class: "msg-meta", text: "assistant · streaming…" }),
  ]);
  scroll.append(node);
  scroll.scrollTop = scroll.scrollHeight;
  return node;
}

function finalizeStream(status, msg) {
  const scroll = state.chatScroll;
  if (state._streamNode && scroll) {
    const content = state._streamNode.querySelector(".msg-content");
    if (status !== "ok") {
      content.innerHTML = `<span style="color:var(--err)">⚠ ${esc(msg ?? "response ended")}</span>`;
    } else {
      content.innerHTML = md(state.streamBuf ?? ""); // completed
    }
    state._streamNode.querySelector(".msg-meta").textContent = `assistant · ${status === "cancelled" ? "cancelled" : fmtTime(new Date().toISOString())}`;
    scroll.scrollTop = scroll.scrollHeight;
  }
  state._streamNode = null;
  state.streaming = null;
  state.streamBuf = "";
  $("#chat-cancel")?.classList.add("hidden");
  state.dirty.conversations = true;
  void refreshRunsCache().then(() => updateTopbar());
}

async function sendChat() {
  const ta = $("#chat-input");
  const text = ta.value.trim();
  if (!text || state.streaming) return;
  ta.value = "";

  const isNew = !state.currentConv;
  if (isNew) {
    const c = await api("/api/conversations", { method: "POST", body: { title: text.slice(0, 60) } });
    state.conversations.push(c.conversation);
    state.currentConv = c.conversation.id;
  }
  const conv = state.conversations.find((c) => c.id === state.currentConv);
  conv?.messages.push({ id: crypto.randomUUID(), role: "user", content: text, ts: new Date().toISOString() });
  state.chatMessages = conv?.messages ?? state.chatMessages;

  const scroll = state.chatScroll;
  if (scroll) {
    scroll.append(messageNode({ role: "user", content: text, ts: new Date().toISOString() }));
    scroll.scrollTop = scroll.scrollHeight;
  }

  try {
    const d = await api("/api/runs", { method: "POST", body: { request: text, conversationId: state.currentConv } });
    state.streaming = d.runId;
    state._streamNode = null;
    state.streamBuf = "";
    state.toolChips = [];
    renderToolChips();
    $("#chat-cancel")?.classList.remove("hidden");
    updateTopbar();
  } catch (err) {
    finalizeStream("err", err.message);
  }
}

function renameConversation(conv) {
  promptModal("Rename conversation", conv.title, async (title) => {
    await api(`/api/conversations/${conv.id}`, { method: "PATCH", body: { title } });
    conv.title = title;
    render();
  });
}

/* =========================================================
   MISSIONS
========================================================= */
function missions(ws) {
  const wsEl = ws ?? $("#workspace");
  wsEl.innerHTML = "";
  wsEl.append(el("h1", { text: "Missions" }), el("p", { class: "page-sub", text: "Goal-oriented objectives Alex executes across multiple steps." }));

  wsEl.append(el("button", { class: "btn primary", text: "+ New mission", onclick: () => missionModal() }));
  const list = el("div", { class: "panel", style: "margin-top:14px" });
  if (state.missions.length === 0) {
    list.append(el("div", { class: "empty", text: "No missions yet. Create one to give Alex a real objective." }));
  } else {
    const tbl = el("table", {}, [
      el("tr", {}, [
        el("th", { text: "Mission" }), el("th", { text: "Objective" }), el("th", { text: "Priority" }),
        el("th", { text: "Status" }), el("th", { text: "Updated" }), el("th", {}),
      ]),
      ...state.missions.map((m) => el("tr", { class: "clickable", onclick: () => missionDetail(m.id) }, [
        el("td", {}, [el("b", { text: m.name })]),
        el("td", { class: "muted", text: m.objective.slice(0, 90) }),
        el("td", {}, [el("span", { class: `badge b-${m.priority}`, text: m.priority })]),
        el("td", {}, [el("span", { class: `badge b-${m.status}`, text: m.status })]),
        el("td", { class: "faint", text: ago(m.updatedAt) }),
        el("td", { style: "text-align:right" }, [
          m.status === "active" || m.status === "paused" ? el("button", { class: "btn sm", text: "Run", onclick: (e) => { e.stopPropagation(); api(`/api/missions/${m.id}/run`, { method: "POST" }).then(() => toast("Mission run started", "ok")); } }) : null,
          el("button", { class: "btn sm ghost", text: "Plan", onclick: (e) => { e.stopPropagation(); api(`/api/missions/${m.id}/plan`, { method: "POST" }).then(() => toast("Planning started — tasks will appear when the model finishes", "ok")); } }),
          m.status === "active" ? el("button", { class: "btn sm ghost", text: "Pause", onclick: (e) => { e.stopPropagation(); api(`/api/missions/${m.id}`, { method: "PATCH", body: { status: "paused" } }).then(refresh); } }) : null,
          el("button", { class: "btn sm ghost danger", text: "✕", onclick: (e) => { e.stopPropagation(); api(`/api/missions/${m.id}`, { method: "DELETE" }).then(refresh); } }),
        ].filter(Boolean)),
      ])),
    ]);
    list.append(tbl);
  }
  wsEl.append(list);
}

async function missionDetail(id) {
  const { miss, runs, tasks } = await api(`/api/missions/${id}`);
  go("missions");
  openModal(`Mission: ${miss.name}`, (body, close) => {
    body.innerHTML = "";
    body.append(el("div", { class: "kv" }, [
      el("div", { class: "k", text: "Objective" }), el("div", { text: miss.objective }),
      miss.successCriteria ? el("div", { class: "k", text: "Success criteria" }) : null, miss.successCriteria ? el("div", { text: miss.successCriteria }) : null,
      miss.constraints ? el("div", { class: "k", text: "Constraints" }) : null, miss.constraints ? el("div", { text: miss.constraints }) : null,
      miss.deadline ? el("div", { class: "k", text: "Deadline" }) : null, miss.deadline ? el("div", { text: miss.deadline }) : null,
      el("div", { class: "k", text: "Status" }), el("div", {}, [el("span", { class: `badge b-${miss.status}`, text: miss.status })]),
      miss.outcome ? el("div", { class: "k", text: "Outcome" }) : null, miss.outcome ? el("div", { class: "muted", text: miss.outcome }) : null,
    ].filter(Boolean)));
    if (runs?.length) {
      body.append(el("h2", { text: "Runs", style: "margin-top:14px", text: "" }));
      body.append(el("div", {}, runs.slice(0, 10).map(runRowSimple)));
    }
    if (tasks?.length) {
      body.append(el("h2", { style: "margin-top:14px", text: "Tasks" }));
      body.append(el("div", {}, tasks.slice(0, 15).map(taskRowSimple)));
    }
    body.append(el("div", { style: "margin-top:16px;display:flex;gap:8px" }, [
      el("button", { class: "btn primary", text: "Run mission", onclick: async () => { await api(`/api/missions/${miss.id}/run`, { method: "POST" }); closeAllModals(); toast("Mission run started"); } }),
      el("button", { class: "btn", text: "Plan tasks", onclick: async () => { await api(`/api/missions/${miss.id}/plan`, { method: "POST" }); closeAllModals(); toast("Planning started — tasks will appear when the model finishes"); } }),
      miss.status === "active" ? el("button", { class: "btn", text: "Pause", onclick: async () => { await api(`/api/missions/${miss.id}`, { method: "PATCH", body: { status: "paused" } }); closeAllModals(); refresh(); } }) : null,
      miss.status === "paused" ? el("button", { class: "btn", text: "Resume", onclick: async () => { await api(`/api/missions/${miss.id}`, { method: "PATCH", body: { status: "active" } }); closeAllModals(); refresh(); } }) : null,
    ].filter(Boolean)));
  });
}

function missionModal() {
  openModal("New mission", () => {});
  const body = $("#modal-root .modal-body");
  body.innerHTML = `
    <label class="f-label">Name</label><input id="mm-name" placeholder="Mission name">
    <label class="f-label">Objective</label><textarea id="mm-obj" placeholder="What does done look like?"></textarea>
    <label class="f-label">Success criteria (optional)</label><textarea id="mm-crit"></textarea>
    <label class="f-label">Priority</label><select id="mm-prio"><option>low</option><option selected>medium</option><option>high</option></select>
    <div style="margin-top:10px"><input type="checkbox" id="mm-run" checked> <span class="muted">Start a run immediately</span></div>`;
  $("#modal-root .modal-foot").innerHTML = "";
  $("#modal-root .modal-foot").append(
    el("button", { class: "btn", text: "Cancel", onclick: closeAllModals }),
    el("button", { class: "btn primary", text: "Create", onclick: async () => {
      const payload = {
        name: $("#mm-name").value,
        objective: $("#mm-obj").value,
        successCriteria: $("#mm-crit").value || undefined,
        priority: $("#mm-prio").value,
      };
      await api("/api/missions", { method: "POST", body: { ...payload, execute: $("#mm-run").checked } });
      closeAllModals();
      refresh();
    } })
  );
}

/* =========================================================
   TASKS
========================================================= */
function tasks(ws) {
  const wsEl = ws ?? $("#workspace");
  wsEl.innerHTML = "";
  const head = el("div", { style: "display:flex;align-items:flex-start;gap:10px" });
  head.append(
    el("div", { style: "flex:1" }, el("h1", { text: "Tasks" }), el("p", { class: "page-sub", text: "Unit work items with lifecycle state, retries and outputs." })),
    el("button", { class: "btn primary", text: "+ New task", onclick: () => taskModal() })
  );
  wsEl.append(head);

  const sel = el("select", { style: "max-width:190px;margin-bottom:12px" }, ["all", "pending", "running", "awaiting_approval", "completed", "failed", "cancelled"].map((s) => el("option", { text: s, selected: state.filters.taskStatus === s ? "" : null })));
  sel.onchange = () => { state.filters.taskStatus = sel.value; render(); };
  wsEl.append(sel);

  const list = el("div", { class: "panel" });
  const filtered = state.tasks.filter((t) => state.filters.taskStatus === "all" || state.filters.taskStatus === "" || t.status === state.filters.taskStatus);
  if (filtered.length === 0) {
    list.append(el("div", { class: "empty", text: state.tasks.length === 0 ? "No tasks yet." : "No tasks match this filter." }));
  } else {
    list.append(el("table", {}, [
      el("tr", {}, [el("th", { text: "Task" }), el("th", { text: "Status" }), el("th", { text: "Attempts" }), el("th", { text: "Updated" }), el("th", {})]),
      ...filtered.map((t) => el("tr", {}, [
        el("td", {}, [
          el("b", { text: t.title }),
          t.description ? el("div", { class: "faint", style: "font-size:11px", text: t.description.slice(0, 80) }) : null,
          t.error ? el("div", { class: "mono", style: "color:var(--err);font-size:11px", text: t.error.slice(0, 90) }) : null,
        ].filter(Boolean)),
        el("td", {}, [el("span", { class: `badge b-${t.status}`, text: t.status })]),
        el("td", { class: "faint", text: String(t.attempts ?? 0) }),
        el("td", { class: "faint", text: ago(t.updatedAt) }),
        el("td", { style: "text-align:right" }, [
          el("button", { class: "btn sm", text: "Run", onclick: () => api(`/api/tasks/${t.id}/run`, { method: "POST" }).then(() => toast("Task run started")) }),
          t.status !== "completed" ? el("button", { class: "btn sm ghost", text: "Done", onclick: () => api(`/api/tasks/${t.id}`, { method: "PATCH", body: { status: "completed" } }).then(refresh) }) : null,
          el("button", { class: "btn sm ghost danger", text: "✕", onclick: () => api(`/api/tasks/${t.id}`, { method: "DELETE" }).then(refresh) }),
        ].filter(Boolean)),
      ])),
    ]));
  }
  wsEl.append(list);

  if (state.runs.length > 0) {
    const runsPanel = el("div", { class: "panel", style: "margin-top:14px" }, [el("h2", { text: "Recent Runs" }), ...state.runs.slice(0, 12).map(runRowSimple)]);
    wsEl.append(runsPanel);
  }
}

function runRowSimple(r) {
  return el("div", { class: "activity-item" }, [
    el("span", { class: `badge b-${r.status}`, text: r.status }),
    el("div", { class: "activity-msg" }, [el("span", { class: "", text: (r.request ?? "").slice(0, 110) })]),
    r.dims?.charsCompacted > 0 ? el("span", { class: "activity-ts", text: `🗜 ${fmtTokens(r.dims.charsCompacted)} chars saved` }) : null,
    el("span", { class: "activity-ts", text: `${r.dims?.steps ?? 0} steps · ${r.dims?.inputTokens ? fmtTokens(r.dims.inputTokens) + "→" + fmtTokens(r.dims.outputTokens) + " · " : ""}${ago(r.startedAt)}` }),
  ]);
}
function fmtTokens(n) {
  if (n == null) return "–";
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}
function taskRowSimple(t) {
  return el("div", { class: "activity-item" }, [
    el("span", { class: `badge b-${t.status}`, text: t.status }),
    el("div", { class: "activity-msg" }, [el("span", { text: t.title })]),
  ]);
}

function taskModal() {
  openModal("New task", (body) => {
    body.innerHTML = `
      <label class="f-label">Title</label><input id="tm-title" placeholder="What needs to be done?">
      <label class="f-label">Details (optional)</label><textarea id="tm-desc"></textarea>
      <div style="margin-top:10px"><input type="checkbox" id="tm-run" checked> <span class="muted">Execute after creating</span></div>`;
    $("#modal-root .modal-foot").innerHTML = "";
    $("#modal-root .modal-foot").append(
      el("button", { class: "btn", text: "Cancel", onclick: closeAllModals }),
      el("button", { class: "btn primary", text: "Create", onclick: async () => {
        await api("/api/tasks", { method: "POST", body: { title: $("#tm-title").value, description: $("#tm-desc").value || undefined, execute: $("#tm-run").checked } });
        closeAllModals();
        refresh();
      } })
    );
  });
}

/* =========================================================
   PROJECTS
========================================================= */
function projects(ws) {
  const wsEl = ws ?? $("#workspace");
  wsEl.innerHTML = "";
  wsEl.append(
    el("div", { style: "display:flex;gap:10px;align-items:flex-start" }, [
      el("div", { style: "flex:1" }, el("h1", { text: "Projects" }), el("p", { class: "page-sub", text: "Group missions, tasks and conversations by context to keep work isolated." })),
      el("button", { class: "btn primary", text: "+ New project", onclick: () => projectModal() }),
    ])
  );
  const grid = el("div", { class: "grid cols-3" });
  if (state.projects.length === 0) grid.append(el("div", { class: "panel empty", text: "No projects yet." }));
  for (const p of state.projects) {
    const missionCount = state.missions.filter((m) => m.projectId === p.id).length;
    const taskCount = state.tasks.filter((t) => t.projectId === p.id).length;
    grid.append(el("div", { class: "panel", style: "cursor:pointer", onclick: () => projectDetail(p.id) }, [
      el("b", { text: p.name }),
      p.description ? el("div", { class: "muted", style: "font-size:12px;margin-top:4px", text: p.description.slice(0, 110) }) : null,
      el("div", { class: "faint", style: "font-size:11px;margin-top:10px", text: `${missionCount} missions · ${taskCount} tasks · ${ago(p.updatedAt)}` }),
    ].filter(Boolean)));
  }
  wsEl.append(grid);
}

async function projectDetail(id) {
  const d = await api(`/api/projects/${id}`);
  const p = d.project;
  openModal(`Project: ${p.name}`, (body, close) => {
    body.innerHTML = "";
    body.append(el("div", { class: "kv" }, [
      el("div", { class: "k", text: "Description" }), el("div", { class: "muted", text: p.description ?? "–" }),
      el("div", { class: "k", text: "Objectives" }), el("div", { class: "muted", text: p.objectives ?? "–" }),
      el("div", { class: "k", text: "Missions" }), el("div", { text: d.missions.length ? d.missions.map((m) => m.name).join(", ") : "–" }),
      el("div", { class: "k", text: "Tasks" }), el("div", { text: `${d.tasks.length} tasks` }),
      el("div", { class: "k", text: "Runs" }), el("div", { text: `${d.runs.length} runs (last ${d.runs[0] ? ago(d.runs[0].startedAt) : "–"})` }),
    ]));
  });
}

function projectModal() {
  openModal("New project", (body) => {
    body.innerHTML = `
      <label class="f-label">Name</label><input id="pm-name">
      <label class="f-label">Description</label><textarea id="pm-desc"></textarea>
      <label class="f-label">Objectives</label><textarea id="pm-obj"></textarea>`;
    $("#modal-root .modal-foot").innerHTML = "";
    $("#modal-root .modal-foot").append(
      el("button", { class: "btn", text: "Cancel", onclick: closeAllModals }),
      el("button", { class: "btn primary", text: "Create", onclick: async () => {
        await api("/api/projects", { method: "POST", body: { name: $("#pm-name").value, description: $("#pm-desc").value || undefined, objectives: $("#pm-obj").value || undefined } });
        closeAllModals();
        refresh();
      } })
    );
  });
}

/* =========================================================
   WORKFLOWS
========================================================= */
async function loadWorkflows() {
  try {
    const d = await api("/api/workflows", { quiet: true });
    state.workflows = d.workflows;
    state.workflowTimezone = d.timezone;
  } catch { /* */ }
}

function workflows(ws) {
  const wsEl = ws ?? $("#workspace");
  wsEl.innerHTML = "";
  const tz = state.workflowTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  wsEl.append(
    el("div", { style: "display:flex;gap:10px;align-items:flex-start" }, [
      el("div", { style: "flex:1" },
        el("h1", { text: "Workflows" }),
        el("p", { class: "page-sub", text: `Reusable, scheduled automations. Each step runs as a sequential agent run. Server timezone: ${tz}.` })),
      el("button", { class: "btn primary", text: "+ New workflow", onclick: () => workflowModal() }),
    ])
  );

  const list = el("div", { class: "panel" });
  if (state.workflows.length === 0) {
    list.append(el("div", { class: "empty", text: "No workflows yet." }));
  } else {
    for (const wf of state.workflows) {
      const row = el("div", { style: "padding:12px 8px;border-bottom:1px solid var(--border)" }, [
        el("div", { style: "display:flex;gap:10px;align-items:center" }, [
          el("b", { text: wf.name }),
          wf.intervalMinutes ? el("span", { class: "badge b-queued", text: `every ${wf.intervalMinutes}m` }) : el("span", { class: "badge b-idle", text: "manual" }),
          wf.lastStatus ? el("span", { class: `badge b-${wf.lastStatus}`, text: `last: ${wf.lastStatus}` }) : null,
          wf.nextRunAt && wf.enabled ? el("span", { class: "faint", style: "font-size:11px", text: `next: ${fmtTime(wf.nextRunAt)}` }) : null,
          el("div", { style: "margin-left:auto;display:flex;gap:6px" }, [
            el("button", { class: "btn sm", text: wf.enabled ? "Disable" : "Enable", onclick: () => api(`/api/workflows/${wf.id}`, { method: "PATCH", body: { enabled: !wf.enabled } }).then(refresh) }),
            el("button", { class: "btn sm ghost", text: "Run now", onclick: () => api(`/api/workflows/${wf.id}/run`, { method: "POST" }).then(() => toast("Workflow run started")).catch(() => {}) }),
            el("button", { class: "btn sm ghost danger", text: "✕", onclick: () => api(`/api/workflows/${wf.id}`, { method: "DELETE" }).then(refresh) }),
          ]),
        ]),
        wf.description ? el("div", { class: "muted", style: "font-size:12px;margin-top:4px", text: wf.description }) : null,
        el("div", { class: "faint", style: "font-size:11px;margin-top:6px", text: wf.steps.map((s) => s.name).join(" → ") || "no steps" }),
      ]);
      list.append(row);
    }
  }
  wsEl.append(list);
}

function workflowModal() {
  openModal("New workflow", (body) => {
    body.innerHTML = `
      <label class="f-label">Name</label><input id="wm-name">
      <label class="f-label">Interval in minutes (leave empty for manual only)</label><input id="wm-int" type="number" min="1" placeholder="e.g. 30">
      <label class="f-label">Steps — one per line, format: name | prompt</label>
      <textarea id="wm-steps" placeholder="Collect headlines | Use web_search to gather today's top AI headlines.\nSummarize | Summarize the search results into 5 bullets." style="min-height:120px"></textarea>
      <p class="faint" style="font-size:11px">Each step runs as an agent run with tools. Destructive or sensitive tool calls will require approval unless the tool is exempt in Settings.</p>`;
    $("#modal-root .modal-foot").innerHTML = "";
    $("#modal-root .modal-foot").append(
      el("button", { class: "btn", text: "Cancel", onclick: closeAllModals }),
      el("button", { class: "btn primary", text: "Create", onclick: async () => {
        const steps = $("#wm-steps").value.split("\n").filter((l) => l.includes("|")).map((l) => {
          const [name, prompt] = l.split("|");
          return { name: name.trim(), prompt: prompt.trim() };
        });
        const interval = $("#wm-int").value ? Number($("#wm-int").value) : undefined;
        await api("/api/workflows", { method: "POST", body: { name: $("#wm-name").value, intervalMinutes: interval, steps } });
        closeAllModals();
        refresh();
      } })
    );
  });
}

/* =========================================================
   TOOLS
========================================================= */
async function loadTools() {
  try {
    const d = await api("/api/tools", { quiet: true });
    state.tools = d.tools;
  } catch { /* */ }
}

function tools(ws) {
  const wsEl = ws ?? $("#workspace");
  wsEl.innerHTML = "";
  wsEl.append(el("h1", { text: "Tools & Integrations" }), el("p", { class: "page-sub", text: "What Alex can actually do. Tools marked 'approval required' pause runs until you authorize them." }));

  const byCat = new Map();
  for (const t of state.tools) {
    byCat.set(t.category, (byCat.get(t.category) ?? []).concat(t));
  }
  const grid = el("div", { class: "grid cols-2" });
  for (const [cat, list] of [...byCat.entries()].sort()) {
    const panel = el("div", { class: "panel" }, [el("h2", { text: cat })]);
    for (const t of list) {
      panel.append(el("div", { style: "padding:7px 0;border-bottom:1px solid var(--border)" }, [
        el("div", { style: "display:flex;gap:8px;align-items:center" }, [
          el("b", { class: "mono", style: "font-size:12px", text: t.name }),
          t.requiresApproval ? el("span", { class: "badge b-pending", text: "approval" }) : el("span", { class: "badge b-idle", text: "open" }),
        ]),
        el("div", { class: "faint", style: "font-size:11.5px;margin-top:2px", text: t.description }),
      ]));
    }
    grid.append(panel);
  }
  if (state.tools.length === 0) grid.append(el("div", { class: "panel empty", text: "No tools registered." }));
  wsEl.append(grid);
}

/* =========================================================
   MODELS
========================================================= */
async function models(ws) {
  const wsEl = ws ?? $("#workspace");
  wsEl.innerHTML = "";
  wsEl.append(el("h1", { text: "Models & Providers" }), el("p", { class: "page-sub", text: "Gateway connectivity, model catalog and default routing." }));

  const grid = el("div", { class: "grid cols-2" });
  const s = state.boot?.settings ?? {};
  const provCard = el("div", { class: "panel" });
  provCard.append(
    el("h2", { text: "Providers" }),
    ...state.providers.map((p) => el("div", { class: "health-row" }, [
      el("span", { class: "ok-dot", style: `background:${p.online === null ? "var(--dim)" : p.online ? "var(--ok)" : "var(--err)"}` }),
      el("span", { class: "health-name", text: p.name }),
      el("span", { class: "health-detail" }, [
        el("span", { class: "mono faint", text: p.online ? `${p.models.length} models` : p.online === false ? "unreachable" : `registered ` }),
      ]),
      el("span", { class: "faint mono", style: "font-size:10.5px", text: `${p.id}` }),
    ])),
    el("div", { style: "margin-top:10px" }, el("button", { class: "btn sm ghost", text: "Re-probe", onclick: () => probeHealth().then(() => { if (state.view === "models") render(); }) }))
  );
  const defCard = el("div", { class: "panel" }, [
    el("h2", { text: "Default routing" }),
    el("label", { class: "f-label", text: "Provider" }),
    el("select", { id: "set-provider" }, state.providers.map((p) => el("option", { text: p.id, selected: p.id === s.provider ? "" : null }))),
    el("label", { class: "f-label", text: "Model" }),
    el("input", { id: "set-model", value: s.model ?? "" }),
    el("label", { class: "f-label", text: `Run timeout (ms, current ${s.runTimeoutMs ?? "?"})` }),
    el("input", { id: "set-timeout", type: "number", value: s.runTimeoutMs ?? 600000 }),
    el("div", { style: "margin-top:12px" }, el("button", { class: "btn primary sm", text: "Save", onclick: async () => {
      await api("/api/settings", { method: "PATCH", body: {
        provider: $("#set-provider").value,
        model: $("#set-model").value,
        runTimeoutMs: Number($("#set-timeout").value),
      } });
      toast("Saved", "ok");
      await boot(true);
    } })),
  ]);
  grid.append(provCard, defCard);
  wsEl.append(grid);

  const modelPanel = el("div", { class: "panel", style: "margin-top:14px" }, [el("h2", { text: "Available models (from gateway /v1/models)" })]);
  if (state.models?.length > 0) {
    const chips = el("div", { class: "chips" });
    for (const m of state.models) chips.append(el("span", { class: "badge b-idle mono", text: m }));
    modelPanel.append(chips);
  } else {
    modelPanel.append(el("div", { class: "empty", text: "Gateway did not return a model catalog (offline or endpoint does not implement /v1/models)." }));
  }
  wsEl.append(modelPanel);

  /* approval tools */
  const toolsP = await loadSettingsApprovalTools();
  toolsP.style.marginTop = "14px";
  wsEl.append(toolsP);
}

async function loadSettingsApprovalTools() {
  const s = state.boot?.settings ?? {};
  const panel = el("div", { class: "panel" }, [el("h2", { text: "Tool Approval Policy" }), el("p", { class: "faint", style: "font-size:11.5px;margin:0 0 8px", text: "Runs pause before executing any tool on this list until you approve." })]);
  if (state.tools.length === 0) await loadTools();
  const wrap = el("div", {});
  for (const t of state.tools) {
    const checked = s.approvalTools?.includes(t.name) ?? false;
    const cb = el("input", { type: "text", style: "display:none" }); void cb;
    const row = el("label", { style: "display:flex;gap:8px;align-items:center;padding:3px 0;font-size:12.5px" }, [
      (() => { const i = document.createElement("input"); i.type = "checkbox"; i.checked = checked; i.dataset.tool = t.name; i.className = "approval-cb"; return i; })(),
      el("span", { class: "mono", style: "font-size:11.5px", text: t.name }),
    ]);
    wrap.append(row);
  }
  panel.append(wrap, el("div", { style: "margin-top:10px" }, el("button", { class: "btn primary sm", text: "Save policy", onclick: async () => {
    const toolsSel = [...document.querySelectorAll(".approval-cb")].filter((c) => c.checked).map((c) => c.dataset.tool);
    await api("/api/settings", { method: "PATCH", body: { approvalTools: toolsSel } });
    toast("Approval policy saved", "ok");
    await boot(true);
  } })));
  return panel;
}

/* =========================================================
   MEMORY
========================================================= */
async function loadMemory() {
  try {
    const d = await api("/api/memory", { quiet: true });
    state.memory = d.entries;
    state.memoryTotal = d.total;
  } catch { /* */ }
}

function memory(ws) {
  const wsEl = ws ?? $("#workspace");
  wsEl.innerHTML = "";
  wsEl.append(
    el("div", { style: "display:flex;gap:10px;align-items:flex-start" }, [
      el("div", { style: "flex:1" }, el("h1", { text: "Memory" }),
        el("p", { class: "page-sub", text: `Persistent facts Alex carries across sessions (${state.memoryTotal ?? state.memory.length} entries). Runs only search entries with importance ≥ 0.3.` })),
      el("button", { class: "btn primary", text: "+ Add memory", onclick: () => memoryModal() }),
    ])
  );
  const search = el("input", { placeholder: "Search memory…", value: state.filters.memoryQuery ?? "" });
  search.oninput = debounce(() => { state.filters.memoryQuery = search.value; void loadMemory().then(render); }, 350);
  wsEl.append(search, el("div", { class: "panel", style: "margin-top:12px" }));
  const list = [...wsEl.querySelectorAll(".panel")].at(-1);
  if (state.memory.length === 0) {
    list.append(el("div", { class: "empty", text: "Empty (or nothing matches)." }));
  } else {
    for (const m of state.memory) {
      list.append(el("div", { style: "padding:9px 6px;border-bottom:1px solid var(--border);font-size:12.5px" }, [
        el("div", {}, [
          el("span", { class: `badge b-${m.type === "semantic" ? "queued" : "idle"}`, text: m.type }),
          el("span", { class: "faint", style: "font-size:10.5px;margin-left:8px", text: `importance ${m.importance} · ${ago(m.createdAt)} · ${(m.tags ?? []).join(", ")}` }),
          el("button", { class: "btn sm ghost danger", style: "float:right", text: "Forget", onclick: () => api(`/api/memory/${m.id}`, { method: "DELETE" }).then(() => loadMemory().then(render)) }),
        ]),
        el("div", { style: "margin-top:5px", html: esc(m.content) }),
      ]));
    }
  }
}

function memoryModal() {
  openModal("Add memory", (body) => {
    body.innerHTML = `
      <label class="f-label">Content</label><textarea id="mem-content" placeholder="A fact Alex should remember permanently"></textarea>
      <label class="f-label">Type</label><select id="mem-type"><option selected>semantic</option><option procedural>procedural</option><option>episodic</option></select>
      <label class="f-label">Importance (0–1)</label><input id="mem-imp" type="number" min="0" max="1" step="0.1" value="0.8">`;
    $("#modal-root .modal-foot").innerHTML = "";
    $("#modal-root .modal-foot").append(
      el("button", { class: "btn", text: "Cancel", onclick: closeAllModals }),
      el("button", { class: "btn primary", text: "Store", onclick: async () => {
        await api("/api/memory", { method: "POST", body: { content: $("#mem-content").value, type: $("#mem-type").value === "procedural" || $("#mem-type").value === "episodic" || $("#mem-type").value === "semantic" ? $("#mem-type").value : "semantic", importance: Number($("#mem-imp").value) } });
        closeAllModals();
        void loadMemory().then(render);
      } })
    );
  });
}

/* =========================================================
   ACTIVITY
========================================================= */
function activity(ws) {
  const wsEl = ws ?? $("#workspace");
  wsEl.innerHTML = "";
  wsEl.append(el("h1", { text: "Activity" }), el("p", { class: "page-sub", text: "Chronological audit trail. Filter by type or text." }));
  const ctr = el("div", { style: "display:flex;gap:8px;margin-bottom:12px" });
  const sel = el("select", { style: "max-width:230px" });
  for (const t of ["all", ...new Set(state.events.map((e) => e.type))]) {
    sel.append(el("option", { text: t, selected: state.filters.activityType === t ? "" : null }));
  }
  sel.onchange = () => { state.filters.activityType = sel.value; render(); };
  const q = el("input", { placeholder: "Filter by text…", value: state.filters.eventQuery ?? "" });
  q.oninput = debounce(() => { state.filters.eventQuery = q.value; render(); }, 300);
  ctr.append(sel, q);
  wsEl.append(ctr);

  const panel = el("div", { class: "panel" });
  let events = state.events;
  if (state.filters.activityType && state.filters.activityType !== "all") events = events.filter((e) => e.type === state.filters.activityType);
  const qv = (state.filters.eventQuery ?? "").toLowerCase();
  if (qv) events = events.filter((e) => e.message.toLowerCase().includes(qv) || e.type.toLowerCase().includes(qv));
  events = events.slice(-300).reverse();
  if (events.length === 0) panel.append(el("div", { class: "empty", text: "No matching events." }));
  else for (const e of events) panel.append(activityRow(e));
  wsEl.append(panel);
}

/* =========================================================
   APPROVALS
========================================================= */
async function loadApprovals() {
  try {
    const d = await api("/api/approvals", { quiet: true });
    state.approvals = d.approvals;
  } catch { /* */ }
}

function approvals(ws) {
  const wsEl = ws ?? $("#workspace");
  wsEl.innerHTML = "";
  wsEl.append(el("h1", { text: "Approvals" }), el("p", { class: "page-sub", text: "Runs pause here before executing sensitive tools. Approve or reject from this list." }));
  const pending = state.approvals.filter((a) => a.status === "pending");
  const past = state.approvals.filter((a) => a.status !== "pending").slice(0, 30);
  const pend2 = el("div", { class: "panel" }, [el("h2", { text: "Pending" })]);
  if (pending.length === 0) pend2.append(el("div", { class: "empty", text: "No pending approvals." }));
  else for (const a of pending) pend2.append(approvalRow(a, false));
  wsEl.append(pend2);

  const hist = el("div", { class: "panel", style: "margin-top:14px" }, [el("h2", { text: "History" })]);
  for (const a of past) {
    hist.append(el("div", { class: "activity-item" }, [
      el("span", { class: `badge b-${a.status}`, text: a.status }),
      el("div", { class: "activity-msg" }, [el("b", { class: "mono", text: a.tool }), el("div", { class: "faint mono", style: "font-size:11px", text: a.argsPreview.slice(0, 100) })]),
      el("span", { class: "activity-ts", text: ago(a.createdAt) }),
    ]));
  }
  if (past.length === 0) hist.append(el("div", { class: "empty", text: "No past approvals." }));
  wsEl.append(hist);
}

/* =========================================================
   SETTINGS
========================================================= */
function settings(ws) {
  const wsEl = ws ?? $("#workspace");
  wsEl.innerHTML = "";
  wsEl.append(el("h1", { text: "Settings" }), el("p", { class: "page-sub", text: "Appearance, runtime and agent configuration." }));
  const s = state.boot?.settings ?? {};

  const p1 = el("div", { class: "panel" }, [
    el("h2", { text: "Appearance" }),
    el("button", { class: "btn sm", text: "Toggle theme", onclick: () => toggleTheme() }),
  ]);
  const p2 = el("div", { class: "panel" }, [
    el("h2", { text: "Runtime" }),
    el("div", { class: "kv" }, [
      el("div", { class: "k", text: "Default provider" }), el("div", { text: s.provider ?? "–" }),
      el("div", { class: "k", text: "Default model" }), el("div", { text: s.model ?? "–" }),
      el("div", { class: "k", text: "Run timeout" }), el("div", { text: `${Math.round((s.runTimeoutMs ?? 600000) / 1000)}s` }),
      el("div", { class: "k", text: "Approval tools" }), el("div", { text: (s.approvalTools ?? []).join(", ") || "none" }),
    ]),
    el("div", { class: "faint", style: "font-size:11.5px;margin-top:10px", text: "Change these in the Models & Providers view. Secrets (API keys) are read from the server environment and are never exposed to this UI." }),
  ]);
  const p3 = el("div", { class: "panel" }, [
    el("h2", { text: "Security notes" }),
    el("div", { class: "faint", style: "font-size:12px" }, [
      el("div", {}, [document.createTextNode("• Dashboard binds to 127.0.0.1 by default. Non-loopback binding requires a token.")]),
      el("div", {}, [document.createTextNode("• Approval gates are enforced by the backend runner before any sensitive tool executes.")]),
      el("div", {}, [document.createTextNode("• Filesystem paths used by agent tool calls are validated server-side.")]),
    ]),
  ]);
  wsEl.append(p1, p2, p3);
}

/* ---------- modal ---------- */
function openModal(title, buildBody) {
  closeAllModals();
  const overlay = el("div", { class: "modal-overlay" });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeAllModals(); });
  const modal = el("div", { class: "modal", role: "dialog", "aria-label": title }, [
    el("div", { class: "modal-head" }, [el("span", { text: title }), el("button", { class: "icon-btn", text: "✕", onclick: closeAllModals })]),
    el("div", { class: "modal-body" }),
    el("div", { class: "modal-foot" }),
  ]);
  overlay.append(modal);
  $("#modal-root").append(overlay);
  buildBody($(".modal-body", modal), () => {});
  const first = $(".modal-body input, .modal-body textarea, .modal-body select", modal);
  first?.focus();
  const escHandler = (e) => { if (e.key === "Escape") { closeAllModals(); document.removeEventListener("keydown", escHandler); } };
  document.addEventListener("keydown", escHandler);
  return modal;
}
function closeAllModals() { $("#modal-root").innerHTML = ""; }

function promptModal(title, initial, onSave) {
  openModal(title, (body, close) => {
    input2(body, initial, onSave, close);
  });
}
function input2(body, initial, onSave, close) {
  body.innerHTML = `<input type="text" id="pmval" value="${esc(initial ?? "")}">`;
  $("#modal-root .modal-foot").innerHTML = "";
  $("#modal-root .modal-foot").append(
    el("button", { class: "btn", text: "Cancel", onclick: closeAllModals }),
    el("button", { class: "btn primary", text: "Save", onclick: async () => {
      const v = $("#pmval").value;
      closeAllModals();
      await onSave(v);
    } })
  );
}

/* ---------- palette ---------- */
const PALETTE_ITEMS = () => [
  { label: "Go: Overview", hint: "nav", action: () => go("overview") },
  { label: "Go: Chat", hint: "nav", action: () => go("chat") },
  { label: "Go: Missions", hint: "nav", action: () => go("missions") },
  { label: "Go: Tasks", hint: "nav", action: () => go("tasks") },
  { label: "Go: Projects", hint: "nav", action: () => go("projects") },
  { label: "Go: Workflows", hint: "nav", action: () => go("workflows") },
  { label: "Go: Approvals", hint: "nav", action: () => go("approvals") },
  { label: "Go: Tools", hint: "nav", action: () => go("tools") },
  { label: "Go: Models", hint: "nav", action: () => go("models") },
  { label: "Go: Memory", hint: "nav", action: () => go("memory") },
  { label: "Go: Activity", hint: "nav", action: () => go("activity") },
  { label: "New conversation", hint: "action", action: async () => { const c = await api("/api/conversations", { method: "POST", body: { title: "New conversation" } }); state.dirty.conversations = true; go("chat", { conversationId: c.conversation.id }); } },
  { label: "New task", hint: "action", action: () => { go("tasks"); setTimeout(taskModal, 60); } },
  { label: "New mission", hint: "action", action: () => { go("missions"); setTimeout(missionModal, 60); } },
  { label: "Toggle theme", hint: "action", action: () => toggleTheme() },
];

let paletteIndex = 0;
function openPalette() {
  paletteIndex = 0;
  const ov = $("#palette-overlay");
  ov.classList.remove("hidden");
  const input = $("#palette-input");
  input.value = "";
  input.focus();
  drawPalette("");
}
function drawPalette(q) {
  const items = PALETTE_ITEMS().filter((i) => i.label.toLowerCase().includes(q.toLowerCase()));
  const box = $("#palette-results");
  box.innerHTML = "";
  items.forEach((item, i) => {
    box.append(el("div", { class: `pal-item ${i === paletteIndex ? "sel" : ""}`, onclick: () => { closePalette(); item.action(); } }, [
      el("span", { text: item.label }), el("span", { class: "pal-hint", text: item.hint }),
    ]));
  });
  if (items.length === 0) box.append(el("div", { class: "empty", text: "no match" }));
  return items;
}
function closePalette() { $("#palette-overlay").classList.add("hidden"); }

/* ---------- misc helpers ---------- */
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

async function refresh() {
  await loadDynamic();
  if (!(state.view === "chat")) render();
}

async function loadDynamic() {
  const requests = [];
  requests.push(api("/api/missions", { quiet: true }).then((d) => { state.missions = d.missions; }).catch(() => {}));
  requests.push(api("/api/tasks", { quiet: true }).then((d) => { state.tasks = d.tasks; }).catch(() => {}));
  requests.push(api("/api/projects", { quiet: true }).then((d) => { state.projects = d.projects; }).catch(() => {}));
  requests.push(refreshRunsCache());
  await Promise.all(requests);
}

/* theme */
function toggleTheme() {
  const next = document.body.dataset.theme === "light" ? "dark" : "light";
  document.body.dataset.theme = next;
  try { localStorage.setItem("alex-theme", next); } catch { /* */ }
}

/* ---------- TOKEN from URL (dashboard can be protected) ---------- */
const TOKEN = (() => {
  const t = new URLSearchParams(location.search).get("token");
  if (t) {
    location.replace(`${location.pathname}${location.hash}`);
    return t;
  }
  return null;
})();

/* ---------- boot ---------- */
async function boot(force = false) {
  const d = await api("/api/state");
  state.boot = d;
  state.approvals = d.approvals ?? [];
  state.missions = d.missions ?? state.missions;
  state.tasks = d.tasks ?? state.tasks;
  state.projects = d.projects ?? state.projects;
  state.runs = d.runs ?? state.runs;
  state.runsById = new Map(state.runs.map((r) => [r.id, r]));
  state.events = d.events ?? [];
  await probeHealth();
  try {
    const pv = await api("/api/providers", { quiet: true });
    state.providers = pv.providers;
    state.models = pv.gatewayModels;
  } catch { /* */ }
  updateTopbar();
  connectEvents();
  await loadDynamic();
  const hashView = location.hash.replace(/^#\//, "");
  state.view = (force && state.view || hashView || state.view);
  render();
}

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openPalette();
    return;
  }
  if (e.key === "Escape") {
    closePalette();
  }
});

$("#palette-input").addEventListener("input", (e) => { paletteIndex = 0; drawPalette(e.target.value); });
$("#palette-input").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); paletteIndex++; drawPalette(e.target.value); }
  if (e.key === "ArrowUp") { e.preventDefault(); paletteIndex = Math.max(0, paletteIndex - 1); drawPalette(e.target.value); }
  if (e.key === "Enter") {
    const q = e.target.value;
    const items = PALETTE_ITEMS().filter((i) => i.label.toLowerCase().includes(q.toLowerCase()));
    items[paletteIndex]?.action();
    closePalette();
  }
});
$("#btn-palette").addEventListener("click", openPalette);

window.addEventListener("hashchange", () => {
  const v = location.hash.replace(/^#\//, "") || "overview";
  if (v !== state.view) {
    if (NAV.some((n) => n && n[0] === v)) {
      go(v);
    }
  }
});
$("#btn-nav-toggle").addEventListener("click", () => $("#sidebar").classList.toggle("collapsed"));
$("#btn-theme").addEventListener("click", toggleTheme);

try {
  const saved = localStorage.getItem("alex-theme");
  if (saved) document.body.dataset.theme = saved;
} catch { /* */ }

boot().catch((err) => {
  $("#workspace").innerHTML = "";
  $("#workspace").append(el("div", { class: "panel" }, [
    el("h1", { text: "Backend unavailable" }),
    el("p", { class: "muted", text: `Could not reach the dashboard API (${err.message}). The server may be restarting.` }),
    el("button", { class: "btn primary", text: "Retry", onclick: () => location.reload() }),
  ]));
});

})();
