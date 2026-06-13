import "dotenv/config";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { CodexAppServer } from "./lib/codexAppServer.mjs";
import { ConversationStore, normalizeCodexEvent } from "./lib/conversationStore.mjs";
import { getProject, loadProjects, publicProjects } from "./lib/projects.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 8787);
const authToken = process.env.AUTH_TOKEN || "change-this-long-random-token";
const projects = loadProjects();
const codex = new CodexAppServer();
const clients = new Set();
const store = new ConversationStore(projects);

if (authToken === "change-this-long-random-token") {
  console.warn("Warning: AUTH_TOKEN is still using the example value. Change it before remote use.");
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      if (!isAuthorized(req, url)) {
        return sendJson(res, 401, { error: "Unauthorized" });
      }
      return await handleApi(req, res, url);
    }

    return serveStatic(res, url.pathname);
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
    ws.send(JSON.stringify({ type: "status", status: codex.getStatus() }));
    ws.on("close", () => clients.delete(ws));
  });
});

codex.on("notification", (event) => {
  const update = normalizeCodexEvent(event);
  if (!update) {
    return;
  }

  if (update.kind === "turn-complete") {
    broadcast({ type: "turn-complete", threadId: update.threadId, turnId: update.turnId });
    return;
  }

  const message = store.upsertAgentMessage(update);
  broadcast({ type: "message", threadId: update.threadId, message });
});

codex.on("status", (status) => {
  broadcast({ type: "status", status });
});

codex.on("log", (entry) => {
  broadcast({ type: "log", entry });
});

server.listen(port, host, () => {
  console.log(`AIToPhone listening on http://${host}:${port}`);
  console.log("Open this from iPhone through Tailscale: http://WINDOWS_TAILSCALE_IP:" + port + "/?token=AUTH_TOKEN");
});

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/config") {
    return sendJson(res, 200, {
      codex: codex.getStatus(),
      projects: publicProjects(projects),
      conversations: store.listConversations()
    });
  }

  if (req.method === "GET" && url.pathname === "/api/projects") {
    return sendJson(res, 200, { projects: publicProjects(projects) });
  }

  if (req.method === "GET" && url.pathname === "/api/conversations") {
    return sendJson(res, 200, { conversations: store.listConversations() });
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    return sendJson(res, 200, { codex: codex.getStatus() });
  }

  if (req.method === "POST" && url.pathname === "/api/threads") {
    const body = await readJson(req);
    const project = getProject(projects, body.projectId);
    if (!project) {
      return sendJson(res, 404, { error: "Project not found" });
    }

    const result = await codex.startThread({ cwd: project.cwd });
    const threadId = result?.threadId || result?.thread_id || result?.id || result?.thread?.id;
    if (!threadId) {
      return sendJson(res, 502, { error: "Codex did not return a thread id", result });
    }

    const thread = {
      threadId,
      projectId: project.id,
      projectName: project.name,
      cwd: project.cwd,
      createdAt: new Date().toISOString()
    };
    store.createThread(thread);
    broadcast({ type: "thread", thread });
    return sendJson(res, 200, { thread, result });
  }

  const threadMatch = url.pathname.match(/^\/api\/threads\/([^/]+)$/);
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
    if (!text) {
      return sendJson(res, 400, { error: "Message text is required" });
    }
    if (!store.getThread(threadId)) {
      return sendJson(res, 404, { error: "Thread not found" });
    }

    const message = store.addMessage({ threadId, role: "user", text });
    broadcast({ type: "message", threadId, message });
    const result = await codex.sendMessage({ threadId, text });
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

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function serveStatic(res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const fullPath = path.normalize(path.join(publicDir, safePath));
  if (!fullPath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "content-type": contentType(fullPath),
      "cache-control": "no-store"
    });
    res.end(data);
  });
}

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(data);
    }
  }
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".json") || file.endsWith(".webmanifest")) return "application/json; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}
