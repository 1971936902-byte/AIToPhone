const state = {
  token: new URLSearchParams(location.search).get("token") || localStorage.getItem("callcodex_token") || "",
  projects: [],
  threadId: localStorage.getItem("callcodex_thread") || "",
  ws: null,
  agentMessages: new Map()
};

if (state.token) {
  localStorage.setItem("callcodex_token", state.token);
}

const els = {
  statusText: document.querySelector("#statusText"),
  tokenInput: document.querySelector("#tokenInput"),
  saveTokenBtn: document.querySelector("#saveTokenBtn"),
  projectSelect: document.querySelector("#projectSelect"),
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
renderEmpty();

els.saveTokenBtn.addEventListener("click", () => {
  state.token = els.tokenInput.value.trim();
  localStorage.setItem("callcodex_token", state.token);
  connectEvents();
  loadConfig();
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
    state.threadId = data.thread.threadId;
    state.agentMessages.clear();
    localStorage.setItem("callcodex_thread", state.threadId);
    addMessage("system", `Started project: ${data.thread.projectName}\n${data.thread.cwd}`);
  } catch (err) {
    addMessage("system", err.message);
  } finally {
    setBusy(false);
  }
});

els.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = els.messageInput.value.trim();
  if (!text) return;
  if (!state.threadId) {
    addMessage("system", "Select a project and start a thread first.");
    return;
  }

  els.messageInput.value = "";
  addMessage("user", text);
  setBusy(true);
  try {
    await api(`/api/threads/${encodeURIComponent(state.threadId)}/messages`, {
      method: "POST",
      body: { text }
    });
  } catch (err) {
    addMessage("system", err.message);
  } finally {
    setBusy(false);
  }
});

els.limitsBtn.addEventListener("click", async () => {
  els.limitsDialog.showModal();
  els.limitsOutput.textContent = "Loading...";
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
    els.statusText.textContent = "Enter access token";
    return;
  }

  try {
    const data = await api("/api/config");
    state.projects = data.projects;
    renderProjects();
    renderStatus(data.codex);
  } catch (err) {
    els.statusText.textContent = err.message;
  }
}

function connectEvents() {
  if (!state.token) return;
  if (state.ws) state.ws.close();

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  state.ws = new WebSocket(`${protocol}//${location.host}/events?token=${encodeURIComponent(state.token)}`);

  state.ws.addEventListener("open", () => {
    els.statusText.textContent = "Gateway connected";
  });

  state.ws.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "status") {
      renderStatus(payload.status);
      return;
    }
    if (payload.type === "thread") {
      state.threadId = payload.thread.threadId;
      localStorage.setItem("callcodex_thread", state.threadId);
      return;
    }
    if (payload.type === "codex") {
      renderCodexEvent(payload.event);
    }
  });

  state.ws.addEventListener("close", () => {
    els.statusText.textContent = "Event connection closed";
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

function renderStatus(status) {
  if (status?.connected && status?.initialized) {
    els.statusText.textContent = "Codex connected";
  } else if (status?.connected) {
    els.statusText.textContent = "Codex connected, initializing";
  } else if (status?.lastError) {
    els.statusText.textContent = `Codex disconnected: ${status.lastError}`;
  } else {
    els.statusText.textContent = "Codex disconnected";
  }
}

function renderCodexEvent(event) {
  const update = normalizeCodexEvent(event);
  if (!update) return;

  if (update.kind === "turn-complete") {
    setBusy(false);
    return;
  }

  if (update.kind !== "agent-text" || !update.text) {
    return;
  }

  upsertAgentMessage(update);
}

function normalizeCodexEvent(event) {
  const params = event?.params || {};
  const item = params.item || params.message || {};
  const itemType = item.type || params.type || "";

  if (event?.method?.includes("turn") && (params.status === "completed" || params.completedAtMs)) {
    return { kind: "turn-complete" };
  }

  if (itemType && itemType !== "agentMessage") {
    return null;
  }

  const id = item.id || params.itemId || params.messageId || params.id || params.turnId || "active-agent-message";
  const phase = item.phase || params.phase || "";
  if (phase && phase !== "final_answer") {
    return null;
  }

  const delta = firstString(params.delta, params.textDelta, params.contentDelta);
  if (delta) {
    return { kind: "agent-text", id, mode: "append", text: delta };
  }

  const fullText = textFromContent(item.text ?? item.content ?? params.text ?? params.content);
  if (fullText) {
    return { kind: "agent-text", id, mode: "set", text: fullText };
  }

  return null;
}

function upsertAgentMessage(update) {
  let entry = state.agentMessages.get(update.id);
  if (!entry) {
    entry = {
      text: "",
      node: addMessage("agent", "")
    };
    state.agentMessages.set(update.id, entry);
  }

  if (update.mode === "set") {
    entry.text = update.text;
  } else {
    entry.text += update.text;
  }

  entry.node.textContent = entry.text;
  els.messages.scrollTop = els.messages.scrollHeight;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return "";
}

function textFromContent(value) {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        return part?.text || part?.content || "";
      })
      .join("");
  }

  return "";
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

function addMessage(role, text) {
  const empty = els.messages.querySelector(".empty");
  if (empty) empty.remove();
  const node = document.createElement("article");
  node.className = `msg ${role}`;
  node.textContent = text;
  els.messages.append(node);
  els.messages.scrollTop = els.messages.scrollHeight;
  return node;
}

function renderEmpty() {
  els.messages.innerHTML = '<div class="empty">Select a project to start</div>';
}

function setBusy(busy) {
  els.sendBtn.disabled = busy;
  els.newThreadBtn.disabled = busy;
}
