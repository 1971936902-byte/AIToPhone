const state = {
  token:
    new URLSearchParams(location.search).get("token") ||
    localStorage.getItem("aitophone_token") ||
    localStorage.getItem("callcodex_token") ||
    "",
  gatewayBaseUrl:
    new URLSearchParams(location.search).get("gateway") ||
    localStorage.getItem("aitophone_gateway") ||
    "",
  projects: [],
  conversations: [],
  threadId: localStorage.getItem("aitophone_thread") || localStorage.getItem("callcodex_thread") || "",
  ws: null,
  messageNodes: new Map(),
  attachments: [],
  accountSnapshot: null
};

if (state.token) localStorage.setItem("aitophone_token", state.token);

const els = {
  statusText: document.querySelector("#statusText"),
  chatTitle: document.querySelector("#chatTitle"),
  drawer: document.querySelector("#drawer"),
  scrim: document.querySelector("#scrim"),
  openDrawerBtn: document.querySelector("#openDrawerBtn"),
  closeDrawerBtn: document.querySelector("#closeDrawerBtn"),
  accountName: document.querySelector("#accountName"),
  accountPlan: document.querySelector("#accountPlan"),
  usageCard: document.querySelector("#usageCard"),
  refreshAccountBtn: document.querySelector("#refreshAccountBtn"),
  gatewayInput: document.querySelector("#gatewayInput"),
  saveGatewayBtn: document.querySelector("#saveGatewayBtn"),
  tokenInput: document.querySelector("#tokenInput"),
  saveTokenBtn: document.querySelector("#saveTokenBtn"),
  projectSelect: document.querySelector("#projectSelect"),
  conversationList: document.querySelector("#conversationList"),
  refreshProjectsBtn: document.querySelector("#refreshProjectsBtn"),
  newThreadBtn: document.querySelector("#newThreadBtn"),
  messages: document.querySelector("#messages"),
  composer: document.querySelector("#composer"),
  attachBtn: document.querySelector("#attachBtn"),
  fileInput: document.querySelector("#fileInput"),
  attachmentTray: document.querySelector("#attachmentTray"),
  messageInput: document.querySelector("#messageInput"),
  sendBtn: document.querySelector("#sendBtn"),
  limitsBtn: document.querySelector("#limitsBtn"),
  limitsDialog: document.querySelector("#limitsDialog"),
  limitsOutput: document.querySelector("#limitsOutput"),
  closeLimitsBtn: document.querySelector("#closeLimitsBtn")
};

els.tokenInput.value = state.token;
els.gatewayInput.value = state.gatewayBaseUrl;
renderEmpty("打开侧边栏，选择项目后开始对话");

els.openDrawerBtn.addEventListener("click", openDrawer);
els.closeDrawerBtn.addEventListener("click", closeDrawer);
els.scrim.addEventListener("click", closeDrawer);
els.refreshAccountBtn.addEventListener("click", loadAccount);
els.saveGatewayBtn.addEventListener("click", () => {
  state.gatewayBaseUrl = normalizeGatewayUrl(els.gatewayInput.value);
  els.gatewayInput.value = state.gatewayBaseUrl;
  localStorage.setItem("aitophone_gateway", state.gatewayBaseUrl);
  connectEvents();
  loadConfig();
});

els.saveTokenBtn.addEventListener("click", () => {
  state.token = els.tokenInput.value.trim();
  localStorage.setItem("aitophone_token", state.token);
  connectEvents();
  loadConfig();
});

els.projectSelect.addEventListener("change", renderConversations);

els.refreshProjectsBtn.addEventListener("click", async () => {
  setProjectRefreshBusy(true);
  try {
    const data = await api("/api/projects/refresh", { method: "POST" });
    state.projects = data.projects || [];
    state.conversations = data.conversations || [];
    renderProjects();
    renderConversations();
  } catch (err) {
    addSystemMessage(`刷新项目失败：${err.message}`);
  } finally {
    setProjectRefreshBusy(false);
  }
});

els.newThreadBtn.addEventListener("click", async () => {
  const projectId = els.projectSelect.value;
  if (!projectId) return;
  setBusy(true);
  try {
    const data = await api("/api/threads", { method: "POST", body: { projectId } });
    await loadConversations();
    await selectThread(data.thread.threadId);
    closeDrawer();
  } catch (err) {
    addSystemMessage(err.message);
  } finally {
    setBusy(false);
  }
});

els.attachBtn.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", async () => {
  const files = [...els.fileInput.files];
  els.fileInput.value = "";
  for (const file of files) {
    await uploadFile(file);
  }
});

els.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = els.messageInput.value.trim();
  if (!text && state.attachments.length === 0) return;
  if (!state.threadId) {
    addSystemMessage("请先在侧边栏选择项目并新建对话。");
    openDrawer();
    return;
  }

  els.messageInput.value = "";
  const attachments = [...state.attachments];
  clearAttachments();
  autosizeInput();
  setBusy(true);
  try {
    await api(`/api/threads/${encodeURIComponent(state.threadId)}/messages`, {
      method: "POST",
      body: { text, attachments }
    });
  } catch (err) {
    addSystemMessage(err.message);
    setBusy(false);
  }
});

els.messageInput.addEventListener("input", autosizeInput);

els.limitsBtn.addEventListener("click", async () => {
  els.limitsDialog.showModal();
  els.limitsOutput.textContent = state.accountSnapshot ? formatAccountSnapshot(state.accountSnapshot) : "读取中...";
  try {
    const account = await api("/api/account");
    state.accountSnapshot = account;
    els.limitsOutput.textContent = formatAccountSnapshot(account);
  } catch (err) {
    els.limitsOutput.textContent = err.message;
  }
});

els.closeLimitsBtn.addEventListener("click", () => els.limitsDialog.close());

loadConfig();
connectEvents();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

async function loadConfig() {
  if (!state.token) {
    els.statusText.textContent = "请输入访问口令";
    openDrawer();
    return;
  }

  try {
    const data = await api("/api/config");
    state.projects = data.projects;
    state.conversations = data.conversations || [];
    renderProjects();
    renderConversations();
    renderStatus(data.codex);
    await loadAccount();

    if (state.threadId) await selectThread(state.threadId, { silent: true });
    else {
      const first = firstThread();
      if (first) await selectThread(first.threadId, { silent: true });
    }
  } catch (err) {
    els.statusText.textContent = err.message;
  }
}

async function loadAccount() {
  if (!state.token) return;
  try {
    const data = await api("/api/account");
    state.accountSnapshot = data;
    renderAccount(data);
  } catch (err) {
    els.accountName.textContent = "账户读取失败";
    els.accountPlan.textContent = err.message;
  }
}

function formatAccountSnapshot(data) {
  const lines = [];
  const account = data.account?.account;
  const limits = data.limits?.rateLimits;
  const primary = limits?.primary;
  const secondary = limits?.secondary;
  const usage = data.usage?.summary;

  lines.push(`账户：${account?.email || account?.type || "未读取到账户邮箱"}`);
  if (limits?.planType) lines.push(`计划：${limits.planType}`);
  if (typeof primary?.usedPercent === "number") {
    lines.push(`5 小时窗口：已用 ${primary.usedPercent}% / 剩余 ${100 - primary.usedPercent}%`);
  }
  if (typeof secondary?.usedPercent === "number") {
    lines.push(`7 天窗口：已用 ${secondary.usedPercent}% / 剩余 ${100 - secondary.usedPercent}%`);
  }
  if (usage?.lifetimeTokens) lines.push(`累计 tokens：${compactNumber(usage.lifetimeTokens)}`);
  if (data.updatedAt) lines.push(`更新时间：${formatTime(data.updatedAt)}`);
  if (data.stale) lines.push("提示：部分数据来自上次成功读取，CodeX 账户接口本次响应较慢。");

  const errors = Object.values(data.errors || {});
  if (errors.length) {
    lines.push("");
    lines.push("未完成项目：");
    for (const error of errors) lines.push(`- ${error}`);
  }

  return lines.join("\n");
}

function renderAccount(data) {
  const account = data.account?.account;
  const limits = data.limits?.rateLimits;
  if (!account) {
    els.accountName.textContent = data.account?.requiresOpenaiAuth ? "需要登录 Codex" : "Codex 已连接";
    els.accountPlan.textContent = limits?.planType ? `计划：${limits.planType}` : "账户邮箱未暴露";
  } else if (account.type === "chatgpt") {
    els.accountName.textContent = account.email || "ChatGPT account";
    els.accountPlan.textContent = `计划：${account.planType || "unknown"}`;
  } else {
    els.accountName.textContent = account.type || "Codex account";
    els.accountPlan.textContent = "已连接";
  }

  const primary = limits?.primary;
  const individual = limits?.individualLimit;
  const usage = data.usage?.summary;
  const reset = primary?.resetsAt || individual?.resetsAt;
  const remaining = individual?.remainingPercent ?? (typeof primary?.usedPercent === "number" ? 100 - primary.usedPercent : null);
  els.usageCard.innerHTML = `
    <div><strong>${remaining == null ? "--" : `${remaining}%`}</strong><span>剩余额度</span></div>
    <div><strong>${primary?.usedPercent ?? "--"}%</strong><span>已用窗口</span></div>
    <div><strong>${usage?.lifetimeTokens ? compactNumber(usage.lifetimeTokens) : "--"}</strong><span>累计 tokens</span></div>
    <p>更新：${formatTime(data.updatedAt)}${reset ? ` · 重置：${formatTime(reset * 1000)}` : ""}</p>
  `;
}

async function loadConversations() {
  const data = await api("/api/conversations");
  state.conversations = data.conversations || [];
  renderConversations();
}

function connectEvents() {
  if (!state.token) return;
  if (state.ws) state.ws.close();

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  state.ws = new WebSocket(`${eventBaseUrl(protocol)}/events?token=${encodeURIComponent(state.token)}`);
  state.ws.addEventListener("open", () => (els.statusText.textContent = "网关已连接"));
  state.ws.addEventListener("message", async (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "status") return renderStatus(payload.status);
    if (payload.type === "thread") return loadConversations();
    if (payload.type === "projects") {
      state.projects = payload.projects || [];
      state.conversations = payload.conversations || [];
      renderProjects();
      renderConversations();
      return;
    }
    if (payload.type === "message") {
      await loadConversations();
      if (payload.threadId === state.threadId) upsertMessage(payload.message);
      return;
    }
    if (payload.type === "turn-complete" && payload.threadId === state.threadId) setBusy(false);
    if (payload.type === "account") renderAccount(payload.account);
  });
  state.ws.addEventListener("close", () => (els.statusText.textContent = "事件连接已断开"));
}

function renderProjects() {
  const selected = els.projectSelect.value;
  els.projectSelect.innerHTML = "";
  for (const project of state.projects) {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = `${project.name} · ${baseName(project.cwd)}`;
    els.projectSelect.append(option);
  }
  if (selected && state.projects.some((project) => project.id === selected)) {
    els.projectSelect.value = selected;
  }
}

function renderConversations() {
  els.conversationList.innerHTML = "";
  for (const group of state.conversations) {
    const section = document.createElement("details");
    section.className = "project-group";
    section.open = group.id === (els.projectSelect.value || state.projects[0]?.id);
    section.innerHTML = `
      <summary>
        <span>
          <strong>${escapeHtml(group.name)}</strong>
          <em>${escapeHtml(group.cwd || "")}</em>
        </span>
        <small>${group.threads?.length || 0}</small>
      </summary>
    `;
    const actions = document.createElement("div");
    actions.className = "project-actions";
    const create = document.createElement("button");
    create.className = "ghost-btn";
    create.type = "button";
    create.textContent = "新建对话";
    create.addEventListener("click", async () => {
      els.projectSelect.value = group.id;
      els.newThreadBtn.click();
    });
    actions.append(create);
    section.append(actions);

    const threads = group.threads || [];
    if (threads.length === 0) {
      const empty = document.createElement("p");
      empty.className = "drawer-empty";
      empty.textContent = "暂无对话";
      section.append(empty);
    } else {
      for (const thread of threads) section.append(renderThreadButton(thread));
    }
    els.conversationList.append(section);
  }
}

function renderThreadButton(thread) {
  const button = document.createElement("button");
  button.className = `conversation-item${thread.threadId === state.threadId ? " active" : ""}`;
  button.type = "button";
  button.innerHTML = `<span>${escapeHtml(thread.title || thread.projectName || "New chat")}</span><small>${formatTime(thread.lastMessageAt || thread.createdAt)}</small>`;
  button.addEventListener("click", async () => {
    await selectThread(thread.threadId);
    closeDrawer();
  });
  return button;
}

async function selectThread(threadId, options = {}) {
  try {
    const data = await api(`/api/threads/${encodeURIComponent(threadId)}`);
    state.threadId = threadId;
    state.messageNodes.clear();
    localStorage.setItem("aitophone_thread", threadId);
    els.chatTitle.textContent = data.thread.title || data.thread.projectName || "AIToPhone";
    renderMessages(data.messages || []);
    renderConversations();
  } catch (err) {
    if (!options.silent) addSystemMessage(err.message);
  }
}

function renderMessages(messages) {
  els.messages.innerHTML = "";
  state.messageNodes.clear();
  if (messages.length === 0) return renderEmpty("这段对话还没有消息。");
  for (const message of messages) upsertMessage(message);
}

function upsertMessage(message) {
  const existing = state.messageNodes.get(message.id);
  if (existing) return fillMessage(existing, message);
  const node = document.createElement("article");
  node.className = `bubble-row ${message.role}`;
  node.dataset.messageId = message.id;
  const avatar = message.role === "user" ? "我" : message.role === "agent" ? "AI" : "!";
  node.innerHTML = `<div class="avatar">${avatar}</div><div class="bubble"></div>`;
  fillMessage(node, message);
  const empty = els.messages.querySelector(".empty");
  if (empty) empty.remove();
  els.messages.append(node);
  state.messageNodes.set(message.id, node);
  els.messages.scrollTop = els.messages.scrollHeight;
}

function fillMessage(node, message) {
  const bubble = node.querySelector(".bubble");
  if (message.role === "agent") bubble.innerHTML = renderMarkdown(linkifyFiles(message.text || ""));
  else bubble.innerHTML = `${escapeHtml(message.text || "").replace(/\n/g, "<br>")}${renderAttachments(message.attachments || [])}`;
  els.messages.scrollTop = els.messages.scrollHeight;
}

function renderAttachments(attachments) {
  if (!attachments.length) return "";
  return `<div class="message-attachments">${attachments
    .map((item) => {
      const href = fileUrl(item.path);
      if (item.kind === "image") return `<a class="attachment image" href="${href}" target="_blank"><img src="${href}" alt="${escapeHtml(item.name)}"><span>${escapeHtml(item.name)}</span></a>`;
      return `<a class="attachment file" href="${href}" target="_blank">文件 · ${escapeHtml(item.name)}</a>`;
    })
    .join("")}</div>`;
}

async function uploadFile(file) {
  const dataUrl = await readFileAsDataUrl(file);
  const { upload } = await api("/api/uploads", {
    method: "POST",
    body: { name: file.name, type: file.type, dataUrl }
  });
  state.attachments.push(upload);
  renderAttachmentTray();
}

function renderAttachmentTray() {
  els.attachmentTray.innerHTML = state.attachments
    .map((item, index) => `<button type="button" class="chip" data-index="${index}">${item.kind === "image" ? "图片" : "文件"} · ${escapeHtml(item.name)} ×</button>`)
    .join("");
  els.attachmentTray.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.attachments.splice(Number(chip.dataset.index), 1);
      renderAttachmentTray();
    });
  });
}

function clearAttachments() {
  state.attachments = [];
  renderAttachmentTray();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function addSystemMessage(text) {
  upsertMessage({ id: `system_${Date.now()}`, role: "system", text });
}

function renderEmpty(text) {
  els.messages.innerHTML = `<div class="empty">${escapeHtml(text)}</div>`;
}

function renderStatus(status) {
  if (status?.connected && status?.initialized) els.statusText.textContent = "Codex 已连接";
  else if (status?.connected) els.statusText.textContent = "Codex 正在初始化";
  else if (status?.lastError) els.statusText.textContent = `Codex 未连接：${status.lastError}`;
  else els.statusText.textContent = "Codex 未连接";
}

function openDrawer() {
  els.drawer.classList.add("open");
  els.scrim.classList.add("show");
  els.drawer.setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  els.drawer.classList.remove("open");
  els.scrim.classList.remove("show");
  els.drawer.setAttribute("aria-hidden", "true");
}

async function api(path, options = {}) {
  const headers = { authorization: `Bearer ${state.token}` };
  let body;
  if (options.body) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const res = await fetch(apiUrl(path), { method: options.method || "GET", headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function renderMarkdown(text) {
  const escaped = escapeHtml(text);
  const parts = escaped.split(/```([\s\S]*?)```/g);
  return parts
    .map((part, index) => {
      if (index % 2 === 1) {
        const lines = part.replace(/^\w+\n/, "").replace(/\n$/, "");
        return `<pre><code>${lines}</code></pre>`;
      }
      return part.split(/\n{2,}/).map(formatMarkdownBlock).join("");
    })
    .join("");
}

function formatMarkdownBlock(block) {
  const trimmed = block.trim();
  if (!trimmed) return "";
  if (/^([-*]\s.+\n?)+$/m.test(trimmed)) {
    const items = trimmed.split("\n").map((line) => line.replace(/^[-*]\s+/, "").trim()).filter(Boolean).map((line) => `<li>${formatInline(line)}</li>`).join("");
    return `<ul>${items}</ul>`;
  }
  return `<p>${formatInline(trimmed).replace(/\n/g, "<br>")}</p>`;
}

function formatInline(text) {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function linkifyFiles(text) {
  return text.replace(/([A-Za-z]:\\[^\n`'"<>]+?\.[A-Za-z0-9]{1,8})/g, (match) => {
    const href = fileUrl(match.trim());
    return `[${match}](${href})`;
  });
}

function apiUrl(path) {
  if (!state.gatewayBaseUrl) return path;
  return `${state.gatewayBaseUrl}${path}`;
}

function fileUrl(path) {
  return `${apiUrl("/api/files")}?path=${encodeURIComponent(path)}&token=${encodeURIComponent(state.token)}`;
}

function eventBaseUrl(protocol) {
  if (!state.gatewayBaseUrl) return `${protocol}//${location.host}`;
  return state.gatewayBaseUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
}

function normalizeGatewayUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function firstThread() {
  for (const group of state.conversations) if (group.threads?.length) return group.threads[0];
  return null;
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function compactNumber(value) {
  return Intl.NumberFormat(undefined, { notation: "compact" }).format(value);
}

function autosizeInput() {
  els.messageInput.style.height = "auto";
  els.messageInput.style.height = `${Math.min(140, els.messageInput.scrollHeight)}px`;
}

function setBusy(busy) {
  els.sendBtn.disabled = busy;
  els.newThreadBtn.disabled = busy;
}

function setProjectRefreshBusy(busy) {
  els.refreshProjectsBtn.disabled = busy;
  els.refreshProjectsBtn.textContent = busy ? "刷新中" : "刷新";
}

function baseName(filePath) {
  return String(filePath || "").split(/[\\/]/).filter(Boolean).pop() || "";
}
