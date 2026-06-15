import "dotenv/config";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { AccountService } from "./lib/accountService.mjs";
import { CodexAppServer } from "./lib/codexAppServer.mjs";
import { ConversationStore, normalizeCodexEvent } from "./lib/conversationStore.mjs";
import { readJson, sendEmpty, sendJson, serveStatic } from "./lib/httpUtils.mjs";
import { createProject, getProject, loadProjects, publicProjects, refreshProjects, removeProject } from "./lib/projects.mjs";
import { ScheduledMessageStore } from "./lib/scheduledMessages.mjs";
import { buildMessageText, UploadService } from "./lib/uploads.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");
const uploadDir = path.resolve(process.cwd(), "uploads");
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 8787);
const authToken = process.env.AUTH_TOKEN || "change-this-long-random-token";
const syncIntervalMs = Number(process.env.SYNC_INTERVAL_MS || 3000);
const schedulerIntervalMs = Math.min(Number(process.env.SCHEDULER_INTERVAL_MS || 1000), 4000);
const accountSyncIntervalMs = Number(process.env.ACCOUNT_SYNC_INTERVAL_MS || 30000);
let projects = loadProjects();
const codex = new CodexAppServer();
const clients = new Set();
const store = new ConversationStore(projects);
const schedules = new ScheduledMessageStore();
const uploads = new UploadService(uploadDir);
const accounts = new AccountService({ codex });
let syncSeq = 0;
let syncTimer = null;
let schedulerTimer = null;
let schedulerRunning = false;
let syncRunning = false;
let accountSyncRunning = false;
let lastAccountSyncAt = 0;

if (authToken === "change-this-long-random-token") {
  console.warn("Warning: AUTH_TOKEN is still using the example value. Change it before remote use.");
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "OPTIONS") {
      return sendEmpty(res, 204);
    }

    if (url.pathname.startsWith("/api/")) {
      if (!isAuthorized(req, url)) {
        return sendJson(res, 401, { error: "Unauthorized" });
      }
      return await handleApi(req, res, url);
    }

    return serveStatic(res, url.pathname, publicDir);
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { error: err.message || "Server error" });
  }
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname !== "/events" || !isAuthorized(req, url)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    clients.add(ws);
    sendFrame(ws, "sync", "client-connected", buildSyncPayload());
    ws.on("close", () => clients.delete(ws));
  });
});

codex.on("notification", (event) => {
  const update = normalizeCodexEvent(event);
  if (!update) {
    return;
  }

  if (update.kind === "turn-complete") {
    broadcastFrame("turn-complete", "codex-turn-complete", { threadId: update.threadId, turnId: update.turnId });
    broadcastSync("turn-complete");
    return;
  }

  const message = store.upsertAgentMessage(update);
  broadcastFrame("message", "codex-message", { threadId: update.threadId, message });
  broadcastSync("message");
});

codex.on("status", (status) => {
  broadcastSync("codex-status", { codex: status });
});

codex.on("log", (entry) => {
  broadcastFrame("log", "codex-log", { entry });
});

server.listen(port, host, () => {
  console.log(`AIToPhone listening on http://${host}:${port}`);
  console.log("Open this from iPhone through Tailscale: http://WINDOWS_TAILSCALE_IP:" + port + "/?token=AUTH_TOKEN");
  startSyncLoop();
  startSchedulerLoop();
});

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/config") {
    return sendJson(res, 200, {
      codex: codex.getStatus(),
      projects: publicProjects(projects),
      conversations: store.listConversations(),
      account: accounts.fromCache(),
      scheduledMessages: schedules.list()
    });
  }

  if (req.method === "GET" && url.pathname === "/api/projects") {
    return sendJson(res, 200, { projects: publicProjects(projects) });
  }

  if (req.method === "POST" && url.pathname === "/api/projects") {
    const body = await readJson(req);
    const created = createProject({
      name: body.name,
      cwd: body.cwd,
      currentProjects: projects
    });
    projects = created.projects;
    store.setProjects(projects);

    let thread = null;
    let result = null;
    if (body.createThread !== false) {
      ({ thread, result } = await startProjectThread(created.project));
    }

    broadcastSync("project-created", { project: publicProjects([created.project])[0], thread });
    return sendJson(res, 200, {
      project: publicProjects([created.project])[0],
      thread,
      result,
      projects: publicProjects(projects),
      conversations: store.listConversations()
    });
  }

  if (req.method === "POST" && url.pathname === "/api/projects/refresh") {
    projects = refreshProjects(projects);
    store.setProjects(projects);
    const payload = {
      projects: publicProjects(projects),
      conversations: store.listConversations()
    };
    broadcastSync("projects-refresh", payload);
    return sendJson(res, 200, payload);
  }

  if (req.method === "GET" && url.pathname === "/api/conversations") {
    return sendJson(res, 200, { conversations: store.listConversations() });
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    return sendJson(res, 200, { codex: codex.getStatus() });
  }

  if (req.method === "GET" && url.pathname === "/api/account") {
    return sendJson(res, 200, await accounts.readSnapshot());
  }

  if (req.method === "POST" && url.pathname === "/api/uploads") {
    const body = await readJson(req, 25 * 1024 * 1024);
    const upload = uploads.save(body);
    return sendJson(res, 200, { upload });
  }

  if (req.method === "GET" && url.pathname === "/api/files") {
    return uploads.serveDownload(res, url.searchParams.get("path"), projects.map((project) => project.cwd));
  }

  if (req.method === "GET" && url.pathname === "/api/scheduled-messages") {
    return sendJson(res, 200, { scheduledMessages: schedules.list() });
  }

  if (req.method === "POST" && url.pathname === "/api/scheduled-messages") {
    const body = await readJson(req);
    const threadId = String(body.threadId || "");
    const thread = store.getThread(threadId);
    if (!thread) {
      return sendJson(res, 404, { error: "Thread not found" });
    }

    const text = String(body.text || "").trim();
    const attachments = uploads.resolveMany(body.attachments);
    if (!text && attachments.length === 0) {
      return sendJson(res, 400, { error: "Message text is required" });
    }

    const sendAt = parseScheduleTime(body);
    if (!sendAt) {
      return sendJson(res, 400, { error: "Schedule time must be in the future" });
    }

    const job = schedules.create({
      threadId,
      projectId: thread.projectId,
      text,
      attachments,
      sendAt
    });
    broadcastSync("schedule-created", { scheduledMessages: schedules.list() });
    return sendJson(res, 200, { scheduledMessage: job, scheduledMessages: schedules.list() });
  }

  const scheduleMatch = url.pathname.match(/^\/api\/scheduled-messages\/([^/]+)$/);
  if (req.method === "DELETE" && scheduleMatch) {
    const jobId = decodeURIComponent(scheduleMatch[1]);
    const job = schedules.cancel(jobId);
    if (!job) {
      return sendJson(res, 404, { error: "Scheduled message not found" });
    }
    broadcastSync("schedule-cancelled", { scheduledMessages: schedules.list() });
    return sendJson(res, 200, { ok: true, scheduledMessage: job, scheduledMessages: schedules.list() });
  }

  if (req.method === "POST" && url.pathname === "/api/threads") {
    const body = await readJson(req);
    const project = getProject(projects, body.projectId);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found" });
    }

    const { thread, result } = await startProjectThread(project);
    broadcastSync("thread-created", { thread });
    return sendJson(res, 200, { thread, result });
  }

  const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (req.method === "DELETE" && projectMatch) {
    const projectId = decodeURIComponent(projectMatch[1]);
    const removedThreadIds = store.deleteProjectThreads(projectId);
    const cancelledSchedules = schedules.deleteForProject(projectId);
    const codexUnsubscribe = await unsubscribeThreads(removedThreadIds);
    const removed = removeProject(projectId, projects);
    if (!removed.removed) {
      return sendJson(res, 404, { error: "Project not found" });
    }
    projects = removed.projects;
    store.setProjects(projects);
    broadcastSync("project-deleted", { projectId, removedThreadIds, cancelledSchedules, codexUnsubscribe });
    return sendJson(res, 200, {
      ok: true,
      projectId,
      removedThreadIds,
      cancelledSchedules,
      codexUnsubscribe,
      projects: publicProjects(projects),
      conversations: store.listConversations()
    });
  }

  const threadMatch = url.pathname.match(/^\/api\/threads\/([^/]+)$/);
  if (req.method === "DELETE" && threadMatch) {
    const threadId = decodeURIComponent(threadMatch[1]);
    const codexUnsubscribe = await unsubscribeThreads([threadId]);
    const deleted = store.deleteThread(threadId);
    if (!deleted) {
      return sendJson(res, 404, { error: "Thread not found" });
    }
    const cancelledSchedules = schedules.deleteForThread(threadId);
    broadcastSync("thread-deleted", { threadId, cancelledSchedules, codexUnsubscribe });
    return sendJson(res, 200, { ok: true, threadId, cancelledSchedules, codexUnsubscribe });
  }

  if (req.method === "GET" && threadMatch) {
    const threadId = decodeURIComponent(threadMatch[1]);
    const thread = store.getThread(threadId);
    if (!thread) {
      return sendJson(res, 404, { error: "Thread not found" });
    }
    return sendJson(res, 200, { thread, messages: store.getMessages(threadId) });
  }

  const messageMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/messages$/);
  if (req.method === "POST" && messageMatch) {
    const threadId = decodeURIComponent(messageMatch[1]);
    const body = await readJson(req);
    const text = String(body.text || "").trim();
    const attachments = uploads.resolveMany(body.attachments);
    if (!text && attachments.length === 0) {
      return sendJson(res, 400, { error: "Message text is required" });
    }
    if (!store.getThread(threadId)) {
      return sendJson(res, 404, { error: "Thread not found" });
    }

    const { message, result } = await sendThreadMessage({ threadId, text, attachments, event: "user-message" });
    return sendJson(res, 200, { message, result });
  }

  const goalMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/goal$/);
  if (goalMatch) {
    const threadId = decodeURIComponent(goalMatch[1]);
    if (req.method === "GET") {
      const result = await codex.getGoal(threadId);
      return sendJson(res, 200, { result });
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      const result = await codex.setGoal(threadId, body.objective || "Remote Codex session", body.tokenBudget);
      return sendJson(res, 200, { result });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/rate-limits") {
    const result = await codex.readRateLimits();
    return sendJson(res, 200, { result });
  }

  return sendJson(res, 404, { error: "Not found" });
}

function isAuthorized(req, url) {
  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return bearer === authToken || url.searchParams.get("token") === authToken;
}

async function startProjectThread(project) {
  const result = await codex.startThread({ cwd: project.cwd });
  const threadId = result?.threadId || result?.thread_id || result?.id || result?.thread?.id;
  if (!threadId) {
    const err = new Error("Codex did not return a thread id");
    err.result = result;
    throw err;
  }

  const thread = {
    threadId,
    projectId: project.id,
    projectName: project.name,
    cwd: project.cwd,
    createdAt: new Date().toISOString()
  };
  store.createThread(thread);
  return { thread, result };
}

async function unsubscribeThreads(threadIds) {
  const results = [];
  for (const threadId of threadIds) {
    try {
      const result = await codex.unsubscribeThread(threadId);
      results.push({ threadId, ok: true, result });
    } catch (err) {
      results.push({ threadId, ok: false, error: err.message || String(err) });
    }
  }
  return results;
}

function parseScheduleTime(body) {
  const now = Date.now();
  if (body.sendAt) {
    const sendAtMs = new Date(body.sendAt).getTime();
    if (Number.isFinite(sendAtMs) && sendAtMs > now + 1000) {
      return new Date(sendAtMs).toISOString();
    }
    return null;
  }

  const delayHours = Math.max(0, Number(body.delayHours || 0));
  const delayMinutes = Math.max(0, Number(body.delayMinutes || 0));
  const delayMs = Math.round((delayHours * 60 + delayMinutes) * 60 * 1000);
  if (!Number.isFinite(delayMs) || delayMs < 60 * 1000) {
    return null;
  }
  return new Date(now + delayMs).toISOString();
}

async function sendThreadMessage({ threadId, text, attachments, event }) {
  const messageText = buildMessageText(text, attachments);
  const message = store.addMessage({ threadId, role: "user", text: messageText, attachments });
  broadcastFrame("message", event, { threadId, message });
  broadcastSync(event);
  const result = await codex.sendMessage({ threadId, text: messageText, attachments });
  return { message, result };
}

function startSyncLoop() {
  if (syncTimer) {
    return;
  }
  runSyncTick("startup");
  syncTimer = setInterval(() => runSyncTick("interval"), syncIntervalMs);
}

function startSchedulerLoop() {
  if (schedulerTimer) {
    return;
  }
  runSchedulerTick("startup");
  schedulerTimer = setInterval(() => runSchedulerTick("interval"), schedulerIntervalMs);
}

async function runSchedulerTick(reason) {
  if (schedulerRunning) {
    return;
  }
  const due = schedules.getDue();
  if (due.length === 0) {
    return;
  }

  schedulerRunning = true;
  try {
    for (const job of due) {
      await runScheduledMessage(job);
    }
    broadcastSync(`schedule-${reason}`, { scheduledMessages: schedules.list() });
  } finally {
    schedulerRunning = false;
  }
}

async function runScheduledMessage(job) {
  if (!schedules.markSending(job.id)) {
    return;
  }

  try {
    if (!store.getThread(job.threadId)) {
      schedules.markFailed(job.id, "Thread not found");
      return;
    }

    const { message } = await sendThreadMessage({
      threadId: job.threadId,
      text: job.text,
      attachments: job.attachments || [],
      event: "scheduled-message"
    });
    schedules.markSent(job.id, message.id);
  } catch (err) {
    schedules.markFailed(job.id, err.message || String(err));
  }
}

async function runSyncTick(reason) {
  if (syncRunning) {
    return;
  }
  syncRunning = true;
  try {
    projects = refreshProjects(projects);
    store.setProjects(projects);
    broadcastSync(reason);
    maybeRefreshAccount()
      .then((updated) => {
        if (updated) broadcastSync("account-refresh");
      })
      .catch(() => {});
  } catch (err) {
    broadcastSync("sync-error", { error: err.message || String(err) });
  } finally {
    syncRunning = false;
  }
}

async function maybeRefreshAccount() {
  const now = Date.now();
  if (accountSyncRunning || now - lastAccountSyncAt < accountSyncIntervalMs) {
    return;
  }
  accountSyncRunning = true;
  try {
    await accounts.readSnapshot();
    lastAccountSyncAt = Date.now();
    return true;
  } catch {
    lastAccountSyncAt = Date.now();
    return false;
  } finally {
    accountSyncRunning = false;
  }
}

function buildSyncPayload(extra = {}) {
  return {
    codex: codex.getStatus(),
    projects: publicProjects(projects),
    conversations: store.listConversations(),
    account: accounts.fromCache(),
    scheduledMessages: schedules.list(),
    ...extra
  };
}

function makeFrame(type, event, payload = {}) {
  return {
    v: 1,
    type,
    event,
    seq: ++syncSeq,
    createdAt: new Date().toISOString(),
    payload
  };
}

function broadcastSync(event, extra = {}) {
  broadcast(makeFrame("sync", event, buildSyncPayload(extra)));
}

function broadcastFrame(type, event, payload = {}) {
  broadcast(makeFrame(type, event, payload));
}

function sendFrame(ws, type, event, payload = {}) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(makeFrame(type, event, payload)));
  }
}

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(data);
    }
  }
}
