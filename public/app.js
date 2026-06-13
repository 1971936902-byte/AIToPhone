const state = {
  token:
    new URLSearchParams(location.search).get("token") ||
    localStorage.getItem("aitophone_token") ||
    localStorage.getItem("callcodex_token") ||
    "",
  projects: [],
  conversations: [],
  threadId: localStorage.getItem("aitophone_thread") || localStorage.getItem("callcodex_thread") || "",
  ws: null,
  messageNodes: new Map()
};

if (state.token) {
  localStorage.setItem("aitophone_token", state.token);
}

const els = {
  statusText: document.querySelector("#statusText"),
  chatTitle: document.querySelector("#chatTitle"),
  drawer: document.querySelector("#drawer"),
  scrim: document.querySelector("#scrim"),
  openDrawerBtn: document.querySelector("#openDrawerBtn"),
  closeDrawerBtn: document.querySelector("#closeDrawerBtn"),
  tokenInput: document.querySelector("#tokenInput"),
  saveTokenBtn: document.querySelector("#saveTokenBtn"),
  projectSelect: document.querySelector("#projectSelect"),
  conversationList: document.querySelector("#conversationList"),
  newThreadBtn: document.querySelector("#newThreadBtn"),
  messages: document.querySelector("#messages"),
  composer: document.querySelector("#composer"),
  messageInput: document.querySelector("#messageInput"),
  sendBtn: document.querySelector("#sendBtn"),
  limitsBtn: document.querySelector("#limitsBtn"),
  limitsDialog: document.querySelector("#limitsDialog"),
  limitsOutput: document.querySelector("#limitsOutput"),
  closeLimitsBtn: document.querySelector("#closeLimitsBtn")
};

els.tokenInput.value = state.token;
renderEmpty("打开侧边栏，选择项目后开始对话");

els.openDrawerBtn.addEventListener("click", openDrawer);
els.closeDrawerBtn.addEventListener("click", closeDrawer);
els.scrim.addEventListener("click", closeDrawer);

els.saveTokenBtn.addEventListener("click", () => {
  state.token = els.tokenInput.value.trim();
  localStorage.setItem("aitophone_token", state.token);
  connectEvents();
  loadConfig();
});

els.projectSelect.addEventListener("change", () => {
  renderConversations();
});

els.newThreadBtn.addEventListener("click", async () => {
  const projectId = els.projectSelect.value;
  if (!projectId) return;
  setBusy(true);
  try {
    const data = await api("/api/threads", {
      method: "POST",
      body: { projectId }
    });
    await loadConversations();
    await selectThread(data.thread.threadId);
    closeDrawer();
  } catch (err) {
    addSystemMessage(err.message);
  } finally {
    setBusy(false);
  }
});

els.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = els.messageInput.value.trim();
  if (!text) return;
  if (!state.threadId) {
    addSystemMessage("请先在侧边栏选择项目并新建对话。");
    openDrawer();
    return;
  }

  els.messageInput.value = "";
  autosizeInput();
  setBusy(true);
  try {
    await api(`/api/threads/${encodeURIComponent(state.threadId)}/messages`, {
      method: "POST",
      body: { text }
    });
  } catch (err) {
    addSystemMessage(err.message);
    setBusy(false);
  }
});

els.messageInput.addEventListener("input", autosizeInput);

els.limitsBtn.addEventListener("click", async () => {
  els.limitsDialog.showModal();
  els.limitsOutput.textContent = "读取中...";
  try {
    const [limits, goal] = await Promise.all([
      api("/api/rate-limits"),
      state.threadId ? api(`/api/threads/${encodeURIComponent(state.threadId)}/goal`) : Promise.resolve(null)
    ]);
    els.limitsOutput.textContent = JSON.stringify({ limits: limits.result, goal: goal?.result || null }, null, 2);
  } catch (err) {
    els.limitsOutput.textContent = err.message;
  }
});

els.closeLimitsBtn.addEventListener("click", () => {
  els.limitsDialog.close();
});

loadConfig();
connectEvents();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

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

    if (state.threadId) {
      await selectThread(state.threadId, { silent: true });
    } else {
      const first = firstThread();
      if (first) await selectThread(first.threadId, { silent: true });
    }
  } catch (err) {
    els.statusText.textContent = err.message;
  }
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
  state.ws = new WebSocket(`${protocol}//${location.host}/events?token=${encodeURIComponent(state.token)}`);

  state.ws.addEventListener("open", () => {
    els.statusText.textContent = "网关已连接";
  });

  state.ws.addEventListener("message", async (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "status") {
      renderStatus(payload.status);
      return;
    }
    if (payload.type === "thread") {
      await loadConversations();
      return;
    }
    if (payload.type === "message") {
      await loadConversations();
      if (payload.threadId === state.threadId) {
        upsertMessage(payload.message);
      }
      return;
    }
    if (payload.type === "turn-complete" && payload.threadId === state.threadId) {
      setBusy(false);
    }
  });

  state.ws.addEventListener("close", () => {
    els.statusText.textContent = "事件连接已断开";
  });
}

function renderProjects() {
  els.projectSelect.innerHTML = "";
  for (const project of state.projects) {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    els.projectSelect.append(option);
  }
}

function renderConversations() {
  const projectId = els.projectSelect.value || state.projects[0]?.id;
  const group = state.conversations.find((item) => item.id === projectId);
  const threads = group?.threads || [];

  els.conversationList.innerHTML = "";
  if (threads.length === 0) {
    const empty = document.createElement("p");
    empty.className = "drawer-empty";
    empty.textContent = "这个项目还没有对话。";
    els.conversationList.append(empty);
    return;
  }

  for (const thread of threads) {
    const button = document.createElement("button");
    button.className = `conversation-item${thread.threadId === state.threadId ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `<span>${escapeHtml(thread.title || thread.projectName || "New chat")}</span><small>${formatTime(thread.lastMessageAt || thread.createdAt)}</small>`;
    button.addEventListener("click", async () => {
      await selectThread(thread.threadId);
      closeDrawer();
    });
    els.conversationList.append(button);
  }
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
  if (messages.length === 0) {
    renderEmpty("这段对话还没有消息。");
    return;
  }
  for (const message of messages) {
    upsertMessage(message);
  }
}

function upsertMessage(message) {
  const existing = state.messageNodes.get(message.id);
  if (existing) {
    fillMessage(existing, message);
    return;
  }

  const node = document.createElement("article");
  node.className = `bubble-row ${message.role}`;
  node.dataset.messageId = message.id;
  node.innerHTML = `<div class="bubble"></div>`;
  fillMessage(node, message);

  const empty = els.messages.querySelector(".empty");
  if (empty) empty.remove();
  els.messages.append(node);
  state.messageNodes.set(message.id, node);
  els.messages.scrollTop = els.messages.scrollHeight;
}

function fillMessage(node, message) {
  const bubble = node.querySelector(".bubble");
  if (message.role === "agent") {
    bubble.innerHTML = renderMarkdown(message.text || "");
  } else {
    bubble.textContent = message.text || "";
  }
  els.messages.scrollTop = els.messages.scrollHeight;
}

function addSystemMessage(text) {
  upsertMessage({
    id: `system_${Date.now()}`,
    role: "system",
    text
  });
}

function renderEmpty(text) {
  els.messages.innerHTML = `<div class="empty">${escapeHtml(text)}</div>`;
}

function renderStatus(status) {
  if (status?.connected && status?.initialized) {
    els.statusText.textContent = "Codex 已连接";
  } else if (status?.connected) {
    els.statusText.textContent = "Codex 正在初始化";
  } else if (status?.lastError) {
    els.statusText.textContent = `Codex 未连接：${status.lastError}`;
  } else {
    els.statusText.textContent = "Codex 未连接";
  }
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
  const headers = {
    authorization: `Bearer ${state.token}`
  };
  let body;
  if (options.body) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const res = await fetch(path, {
    method: options.method || "GET",
    headers,
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
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
      return part
        .split(/\n{2,}/)
        .map((block) => formatMarkdownBlock(block))
        .join("");
    })
    .join("");
}

function formatMarkdownBlock(block) {
  const trimmed = block.trim();
  if (!trimmed) return "";
  if (/^([-*]\s.+\n?)+$/m.test(trimmed)) {
    const items = trimmed
      .split("\n")
      .map((line) => line.replace(/^[-*]\s+/, "").trim())
      .filter(Boolean)
      .map((line) => `<li>${formatInline(line)}</li>`)
      .join("");
    return `<ul>${items}</ul>`;
  }
  return `<p>${formatInline(trimmed).replace(/\n/g, "<br>")}</p>`;
}

function formatInline(text) {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function firstThread() {
  for (const group of state.conversations) {
    if (group.threads?.length) return group.threads[0];
  }
  return null;
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function autosizeInput() {
  els.messageInput.style.height = "auto";
  els.messageInput.style.height = `${Math.min(140, els.messageInput.scrollHeight)}px`;
}

function setBusy(busy) {
  els.sendBtn.disabled = busy;
  els.newThreadBtn.disabled = busy;
}
