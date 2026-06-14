import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "conversations.json");

export class ConversationStore {
  constructor(projects) {
    this.projects = projects;
    this.threads = new Map();
    this.messages = new Map();
    this.load();
  }

  setProjects(projects) {
    this.projects = projects;
  }

  load() {
    if (!fs.existsSync(DATA_FILE)) {
      return;
    }

    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    for (const thread of data.threads || []) {
      this.threads.set(thread.threadId, thread);
    }
    for (const message of data.messages || []) {
      this.messages.set(message.id, message);
    }
  }

  save() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const payload = {
      version: 1,
      savedAt: new Date().toISOString(),
      threads: [...this.threads.values()],
      messages: [...this.messages.values()]
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), "utf8");
  }

  createThread(thread) {
    this.threads.set(thread.threadId, {
      title: thread.projectName,
      lastMessageAt: thread.createdAt,
      ...thread
    });
    this.save();
    return this.threads.get(thread.threadId);
  }

  listConversations() {
    return this.projects.map((project) => ({
      ...project,
      threads: [...this.threads.values()]
        .filter((thread) => thread.projectId === project.id)
        .sort((a, b) => String(b.lastMessageAt || b.createdAt).localeCompare(String(a.lastMessageAt || a.createdAt)))
    }));
  }

  getThread(threadId) {
    return this.threads.get(threadId);
  }

  getMessages(threadId) {
    return [...this.messages.values()]
      .filter((message) => message.threadId === threadId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  addMessage({ threadId, role, text, messageId, turnId, attachments = [] }) {
    const id = messageId || `${role}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const message = {
      id,
      threadId,
      turnId: turnId || null,
      role,
      text,
      attachments,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.messages.set(id, message);
    this.touchThread(threadId, text);
    this.save();
    return message;
  }

  upsertAgentMessage({ threadId, messageId, turnId, text, mode }) {
    const id = messageId || `${threadId}_${turnId || "turn"}_agent`;
    const existing = this.messages.get(id);
    if (existing) {
      existing.text = mode === "set" ? text : `${existing.text}${text}`;
      existing.updatedAt = new Date().toISOString();
      this.touchThread(threadId, existing.text);
      this.save();
      return existing;
    }

    return this.addMessage({
      threadId,
      role: "agent",
      text,
      messageId: id,
      turnId
    });
  }

  touchThread(threadId, text) {
    const thread = this.threads.get(threadId);
    if (!thread) {
      return;
    }
    thread.lastMessageAt = new Date().toISOString();
    if (text && (!thread.title || thread.title === thread.projectName)) {
      thread.title = text.slice(0, 42);
    }
  }
}

export function normalizeCodexEvent(event) {
  const params = event?.params || {};
  const item = params.item || params.message || {};
  const itemType = item.type || params.type || "";

  if (event?.method?.includes("turn") && (params.status === "completed" || params.completedAtMs)) {
    return {
      kind: "turn-complete",
      threadId: params.threadId,
      turnId: params.turnId || params.id
    };
  }

  if (itemType && itemType !== "agentMessage") {
    return null;
  }

  const threadId = params.threadId;
  if (!threadId) {
    return null;
  }

  const phase = item.phase || params.phase || "";
  if (phase && phase !== "final_answer") {
    return null;
  }

  const delta = firstString(params.delta, params.textDelta, params.contentDelta);
  if (delta) {
    return {
      kind: "agent-text",
      threadId,
      turnId: params.turnId || params.id,
      messageId: item.id || params.itemId || params.messageId,
      mode: "append",
      text: delta
    };
  }

  const fullText = textFromContent(item.text ?? item.content ?? params.text ?? params.content);
  if (fullText) {
    return {
      kind: "agent-text",
      threadId,
      turnId: params.turnId || params.id,
      messageId: item.id || params.itemId || params.messageId,
      mode: "set",
      text: fullText
    };
  }

  return null;
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
