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
  projectId: localStorage.getItem("aitophone_project") || "",
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
  syncIndicator: document.querySelector("#syncIndicator"),
  connectionSummary: document.querySelector("#connectionSummary"),
  openConnectionBtn: document.querySelector("#openConnectionBtn"),
  openHelpBtn: document.querySelector("#openHelpBtn"),
  gatewayInput: document.querySelector("#gatewayInput"),
  saveGatewayBtn: document.querySelector("#saveGatewayBtn"),
  tokenInput: document.querySelector("#tokenInput"),
  saveTokenBtn: document.querySelector("#saveTokenBtn"),
  clearLoginBtn: document.querySelector("#clearLoginBtn"),
  conversationList: document.querySelector("#conversationList"),
  newThreadBtn: document.querySelector("#newThreadBtn"),
  messages: document.querySelector("#messages"),
  composer: document.querySelector("#composer"),
  attachBtn: document.querySelector("#attachBtn"),
  fileInput: document.querySelector("#fileInput"),
  attachmentTray: document.querySelector("#attachmentTray"),
  messageInput: document.querySelector("#messageInput"),
  sendBtn: document.querySelector("#sendBtn"),
  connectionDialog: document.querySelector("#connectionDialog"),
  closeConnectionBtn: document.querySelector("#closeConnectionBtn"),
  helpDialog: document.querySelector("#helpDialog"),
  closeHelpBtn: document.querySelector("#closeHelpBtn"),
  newDialog: document.querySelector("#newDialog"),
  closeNewDialogBtn: document.querySelector("#closeNewDialogBtn"),
  createThreadBtn: document.querySelector("#createThreadBtn"),
  newProjectName: document.querySelector("#newProjectName"),
  newProjectPath: document.querySelector("#newProjectPath"),
  createProjectBtn: document.querySelector("#createProjectBtn")
};

initViewportSizing();

els.tokenInput.value = state.token;
els.gatewayInput.value = state.gatewayBaseUrl;
renderEmpty("打开侧边栏，选择项目后开始对话");
renderConnectionSummary();

els.openDrawerBtn.addEventListener("click", openDrawer);
els.closeDrawerBtn.addEventListener("click", closeDrawer);
els.scrim.addEventListener("click", closeDrawer);
els.openConnectionBtn.addEventListener("click", openConnectionDialog);
els.closeConnectionBtn.addEventListener("click", () => els.connectionDialog.close());
els.openHelpBtn.addEventListener("click", () => els.helpDialog.showModal());
els.closeHelpBtn.addEventListener("click", () => els.helpDialog.close());
els.closeNewDialogBtn.addEventListener("click", () => els.newDialog.close());
els.saveGatewayBtn.addEventListener("click", () => {
  state.gatewayBaseUrl = normalizeGatewayUrl(els.gatewayInput.value);
  els.gatewayInput.value = state.gatewayBaseUrl;
  localStorage.setItem("aitophone_gateway", state.gatewayBaseUrl);
  renderConnectionSummary();
  connectEvents();
  loadConfig();
});

els.saveTokenBtn.addEventListener("click", () => {
  state.token = els.tokenInput.value.trim();
  localStorage.setItem("aitophone_token", state.token);
  renderConnectionSummary();
  connectEvents();
  loadConfig();
});

els.clearLoginBtn.addEventListener("click", () => {
  state.token = "";
  state.gatewayBaseUrl = "";
  els.tokenInput.value = "";
  els.gatewayInput.value = "";
  localStorage.removeItem("aitophone_token");
  localStorage.removeItem("callcodex_token");
  localStorage.removeItem("aitophone_gateway");
  renderConnectionSummary();
  if (state.ws) state.ws.close();
  els.statusText.textContent = "请重新输入访问口令";
});

els.newThreadBtn.addEventListener("click", () => {
  els.newDialog.showModal();
});

els.createThreadBtn.addEventListener("click", async () => {
  const projectId = selectedProjectId();
  if (!projectId) return;
  try {
    await createThreadForProject(projectId);
    els.newDialog.close();
    closeDrawer();
  } catch (err) {
    addSystemMessage(err.message);
  }
});

els.createProjectBtn.addEventListener("click", async () => {
  const name = els.newProjectName.value.trim();
  const cwd = els.newProjectPath.value.trim();
  if (!name && !cwd) {
    addSystemMessage("请输入项目名称或目录。");
    return;
  }

  setBusy(true);
  try {
    const data = await api("/api/projects", {
      method: "POST",
      body: { name, cwd, createThread: true }
    });
    els.newProjectName.value = "";
    els.newProjectPath.value = "";
    await loadSync();
    if (data.project?.id) setSelectedProject(data.project.id, { render: false });
    if (data.thread?.threadId) await selectThread(data.thread.threadId);
    els.newDialog.close();
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

loadConfig();
connectEvents();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

async function loadConfig() {
  if (!state.token) {
    els.statusText.textContent = "请输入访问口令";
    openDrawer();
    openConnectionDialog();
    return;
  }

  try {
    const data = await api("/api/config");
    applySyncPayload(data, "config");
    if (!data.account) await loadAccount();

    if (state.threadId) await selectThread(state.threadId, { silent: true });
    else {
      const first = firstThread();
      if (first) await selectThread(first.threadId, { silent: true });
    }
  } catch (err) {
    els.statusText.textContent = err.message;
    openConnectionDialog();
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
  const secondary = limits?.secondary;
  const individual = limits?.individualLimit;
  const usage = data.usage?.summary;
  const reset = primary?.resetsAt || individual?.resetsAt;
  const remaining = individual?.remainingPercent ?? (typeof primary?.usedPercent === "number" ? 100 - primary.usedPercent : null);
  const primaryRemaining = remainingPercent(primary);
  const secondaryRemaining = remainingPercent(secondary);
  els.usageCard.innerHTML = `
    <div><strong>${remaining == null ? "--" : `${remaining}%`}</strong><span>剩余额度</span></div>
    <div><strong>${primaryRemaining == null ? "--" : `${primaryRemaining}%`}</strong><span>5h 剩余</span></div>
    <div><strong>${secondaryRemaining == null ? "--" : `${secondaryRemaining}%`}</strong><span>7天剩余</span></div>
    <div><strong>${usage?.lifetimeTokens ? compactNumber(usage.lifetimeTokens) : "--"}</strong><span>累计 tokens</span></div>
    <p>更新：${formatTime(data.updatedAt)}${reset ? ` · 重置：${formatTime(reset * 1000)}` : ""}</p>
  `;
}

function remainingPercent(limit) {
  if (typeof limit?.remainingPercent === "number") return limit.remainingPercent;
  if (typeof limit?.usedPercent === "number") return Math.max(0, 100 - limit.usedPercent);
  return null;
}

async function loadSync() {
  const data = await api("/api/config");
  applySyncPayload(data, "config");
  return data;
}

function connectEvents() {
  if (!state.token) return;
  if (state.ws) state.ws.close();

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  state.ws = new WebSocket(`${eventBaseUrl(protocol)}/events?token=${encodeURIComponent(state.token)}`);
  state.ws.addEventListener("open", () => (els.statusText.textContent = "\u7f51\u5173\u5df2\u8fde\u63a5"));
  state.ws.addEventListener("message", async (event) => {
    const frame = JSON.parse(event.data);
    const payload = frame.payload || frame;
    if (frame.type === "sync") {
      applySyncPayload(payload, frame.event, frame);
      return;
    }
    if (payload.type === "status") return renderStatus(payload.status);
    if (payload.type === "thread") return loadSync();
    if (payload.type === "projects") return applySyncPayload(payload, "projects");
    if (payload.type === "message") {
      await loadSync();
      if (payload.threadId === state.threadId) upsertMessage(payload.message);
      return;
    }
    if (payload.type === "turn-complete" && payload.threadId === state.threadId) setBusy(false);
    if (payload.type === "account") {
      state.accountSnapshot = payload.account;
      renderAccount(payload.account);
    }
  });
  state.ws.addEventListener("close", () => (els.statusText.textContent = "\u4e8b\u4ef6\u8fde\u63a5\u5df2\u65ad\u5f00"));
}

function applySyncPayload(payload, reason = "", frame = {}) {
  if (!payload) return;
  if (frame.seq && frame.seq <= (state.lastSyncSeq || 0)) return;
  if (frame.seq) state.lastSyncSeq = frame.seq;

  if (payload.codex) renderStatus(payload.codex);
  if (Array.isArray(payload.projects)) {
    state.projects = payload.projects;
    renderProjects();
  }
  if (Array.isArray(payload.conversations)) {
    state.conversations = payload.conversations;
    renderConversations();
    if (state.threadId && !threadExists(state.threadId)) {
      state.threadId = "";
      localStorage.removeItem("aitophone_thread");
      els.chatTitle.textContent = "AIToPhone";
      renderEmpty("\u8bf7\u9009\u62e9\u9879\u76ee\u540e\u65b0\u5efa\u6216\u6253\u5f00\u5bf9\u8bdd");
    }
  }
  if (payload.account) {
    state.accountSnapshot = payload.account;
    renderAccount(payload.account);
  }
  renderSyncIndicator(frame.createdAt || new Date().toISOString(), reason);
}

function renderProjects() {
  if (state.projectId && state.projects.some((project) => project.id === state.projectId)) {
    return;
  }
  setSelectedProject(state.projects[0]?.id || "", { render: false });
}

function renderConversations() {
  els.conversationList.innerHTML = "";
  for (const group of state.conversations) {
    const section = document.createElement("details");
    const selected = group.id === selectedProjectId();
    section.className = `project-group${selected ? " selected" : ""}`;
    section.open = selected;
    section.innerHTML = `
      <summary>
        <span>
          <strong>${escapeHtml(group.name)}</strong>
        </span>
        <b class="project-arrow" aria-hidden="true"></b>
        <small>${group.threads?.length || 0}</small>
      </summary>
    `;
    section.querySelector("summary").addEventListener("click", (event) => {
      event.preventDefault();
      setSelectedProject(group.id);
    });
    const actions = document.createElement("div");
    actions.className = "project-actions";
    const create = document.createElement("button");
    create.className = "ghost-btn";
    create.type = "button";
    create.textContent = "新建对话";
    create.addEventListener("click", async () => {
      await createThreadForProject(group.id);
      closeDrawer();
    });
    actions.append(create);
    const removeProject = document.createElement("button");
    removeProject.className = "danger-inline-btn";
    removeProject.type = "button";
    removeProject.textContent = "\u5220\u9664\u9879\u76ee";
    removeProject.addEventListener("click", async () => {
      if (!confirm(`\u4ece AIToPhone \u548c CodeX \u9879\u76ee\u5217\u8868\u79fb\u9664\u300c${group.name}\u300d\uff1f\u4e0d\u4f1a\u5220\u9664\u78c1\u76d8\u6587\u4ef6\u3002`)) return;
      await deleteProject(group.id);
    });
    actions.append(removeProject);
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

async function createThreadForProject(projectId) {
  setBusy(true);
  try {
    const data = await api("/api/threads", { method: "POST", body: { projectId } });
    await loadSync();
    if (projectId) setSelectedProject(projectId, { render: false });
    await selectThread(data.thread.threadId);
    return data;
  } finally {
    setBusy(false);
  }
}

async function deleteProject(projectId) {
  try {
    await api(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
    if (state.projects.some((project) => project.id === projectId)) {
      state.threadId = "";
      if (state.projectId === projectId) {
        const nextProject = state.projects.find((project) => project.id !== projectId);
        setSelectedProject(nextProject?.id || "", { render: false });
      }
      localStorage.removeItem("aitophone_thread");
      els.chatTitle.textContent = "AIToPhone";
      renderEmpty("\u8bf7\u9009\u62e9\u9879\u76ee\u540e\u65b0\u5efa\u6216\u6253\u5f00\u5bf9\u8bdd");
    }
    await loadSync();
  } catch (err) {
    addSystemMessage(err.message);
  }
}

function renderThreadButton(thread) {
  const item = document.createElement("div");
  item.className = `conversation-item${thread.threadId === state.threadId ? " active" : ""}`;

  const open = document.createElement("button");
  open.className = "conversation-open";
  open.type = "button";
  open.innerHTML = `<span>${escapeHtml(thread.title || thread.projectName || "New chat")}</span><small>${formatTime(thread.lastMessageAt || thread.createdAt)}</small>`;
  open.addEventListener("click", async () => {
    await selectThread(thread.threadId);
    closeDrawer();
  });

  const remove = document.createElement("button");
  remove.className = "thread-delete";
  remove.type = "button";
  remove.title = "\u5220\u9664\u5bf9\u8bdd";
  remove.textContent = "\u00d7";
  remove.addEventListener("click", async () => {
    if (!confirm("\u5220\u9664\u8fd9\u6bb5\u5bf9\u8bdd\uff1f")) return;
    await deleteThread(thread.threadId);
  });

  item.append(open, remove);
  return item;
}

async function deleteThread(threadId) {
  try {
    await api(`/api/threads/${encodeURIComponent(threadId)}`, { method: "DELETE" });
    if (state.threadId === threadId) {
      state.threadId = "";
      localStorage.removeItem("aitophone_thread");
      els.chatTitle.textContent = "AIToPhone";
      renderEmpty("\u8bf7\u9009\u62e9\u9879\u76ee\u540e\u65b0\u5efa\u6216\u6253\u5f00\u5bf9\u8bdd");
    }
    await loadSync();
  } catch (err) {
    addSystemMessage(err.message);
  }
}

async function selectThread(threadId, options = {}) {
  try {
    const data = await api(`/api/threads/${encodeURIComponent(threadId)}`);
    state.threadId = threadId;
    if (data.thread.projectId) setSelectedProject(data.thread.projectId, { render: false });
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

function openConnectionDialog() {
  els.gatewayInput.value = state.gatewayBaseUrl;
  els.tokenInput.value = state.token;
  if (!els.connectionDialog.open) {
    els.connectionDialog.showModal();
  }
}

function renderConnectionSummary() {
  const hasGateway = Boolean(state.gatewayBaseUrl);
  const hasToken = Boolean(state.token);
  if (!hasToken) {
    els.connectionSummary.textContent = "需要输入访问口令";
    return;
  }
  els.connectionSummary.textContent = hasGateway ? "使用自定义网关地址" : "使用当前网页链接";
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
  if (!res.ok) {
    if (res.status === 401) openConnectionDialog();
    throw new Error(data.error || `HTTP ${res.status}`);
  }
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

function selectedProjectId() {
  return state.projectId || state.projects[0]?.id || "";
}

function setSelectedProject(projectId, options = {}) {
  state.projectId = projectId || "";
  if (state.projectId) localStorage.setItem("aitophone_project", state.projectId);
  else localStorage.removeItem("aitophone_project");
  if (options.render !== false) renderConversations();
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

function initViewportSizing() {
  const viewport = window.visualViewport;
  let frame = 0;

  const sync = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const height = viewport?.height || window.innerHeight;
      document.documentElement.style.setProperty("--app-height", `${Math.round(height)}px`);
      window.scrollTo(0, 0);

      if (document.activeElement === els.messageInput) {
        els.messages.scrollTop = els.messages.scrollHeight;
        els.composer.scrollIntoView({ block: "end" });
      }
    });
  };

  sync();
  window.addEventListener("resize", sync);
  window.addEventListener("orientationchange", () => setTimeout(sync, 250));
  viewport?.addEventListener("resize", sync);
  viewport?.addEventListener("scroll", sync);
  els.messageInput.addEventListener("focus", () => setTimeout(sync, 80));
  els.messageInput.addEventListener("blur", () => setTimeout(sync, 120));
}

function autosizeInput() {
  els.messageInput.style.height = "auto";
  els.messageInput.style.height = `${Math.min(140, els.messageInput.scrollHeight)}px`;
}

function setBusy(busy) {
  els.sendBtn.disabled = busy;
  els.newThreadBtn.disabled = busy;
  if (els.createThreadBtn) els.createThreadBtn.disabled = busy;
  if (els.createProjectBtn) els.createProjectBtn.disabled = busy;
}

function renderSyncIndicator(value, reason = "") {
  if (!els.syncIndicator) return;
  els.syncIndicator.textContent = `\u540c\u6b65 ${formatTime(value)}`;
  els.syncIndicator.title = reason ? `\u81ea\u52a8\u540c\u6b65\uff1a${reason}` : "\u81ea\u52a8\u540c\u6b65";
}

function threadExists(threadId) {
  return state.conversations.some((group) => (group.threads || []).some((thread) => thread.threadId === threadId));
}

function baseName(filePath) {
  return String(filePath || "").split(/[\\/]/).filter(Boolean).pop() || "";
}
