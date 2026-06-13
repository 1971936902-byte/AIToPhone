import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import WebSocket from "ws";

const DEFAULT_CODEX_PORT = Number(process.env.CODEX_APP_SERVER_PORT || 4500);
const DEFAULT_CODEX_URL = `ws://127.0.0.1:${DEFAULT_CODEX_PORT}`;

export class CodexAppServer extends EventEmitter {
  constructor() {
    super();
    this.url = process.env.CODEX_APP_SERVER_URL || DEFAULT_CODEX_URL;
    this.ws = null;
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
    this.connecting = null;
    this.initialized = false;
    this.status = {
      connected: false,
      initialized: false,
      url: this.url,
      launched: false,
      lastError: null
    };
  }

  async ensureReady() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (!this.initialized) {
        await this.#initialize();
      }
      return;
    }

    if (this.connecting) {
      await this.connecting;
      return;
    }

    this.connecting = this.#connectWithLaunch();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  getStatus() {
    return { ...this.status };
  }

  async request(method, params = {}) {
    await this.ensureReady();
    return this.#rawRequest(method, params);
  }

  #rawRequest(method, params = {}) {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, 120000);

      this.pending.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify(payload), (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  #notify(method, params = {}) {
    this.ws.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  async startThread({ cwd }) {
    return this.request("thread/start", {
      cwd,
      approvalPolicy: process.env.CODEX_APPROVAL_POLICY || "on-request",
      sandbox: process.env.CODEX_SANDBOX || "workspace-write",
      serviceName: "aitophone-ios"
    });
  }

  async sendMessage({ threadId, text }) {
    return this.request("turn/start", {
      threadId,
      input: [{ type: "text", text }]
    });
  }

  async readRateLimits() {
    return this.request("account/rateLimits/read", {});
  }

  async getGoal(threadId) {
    return this.request("thread/goal/get", { threadId });
  }

  async setGoal(threadId, objective, tokenBudget) {
    const params = {
      threadId,
      objective
    };

    const budget = Number(tokenBudget);
    if (Number.isFinite(budget) && budget > 0) {
      params.tokenBudget = budget;
    }

    return this.request("thread/goal/set", params);
  }

  async #connectWithLaunch() {
    try {
      await this.#connect();
      await this.#initialize();
      return;
    } catch (firstError) {
      this.status.lastError = firstError.message;
    }

    if (!process.env.CODEX_APP_SERVER_URL) {
      this.#launchCodex();
      await wait(1200);
      await this.#connect();
      await this.#initialize();
      return;
    }

    throw new Error(`Cannot connect to Codex app-server at ${this.url}: ${this.status.lastError}`);
  }

  #launchCodex() {
    if (this.proc) {
      return;
    }

    const command = process.env.CODEX_COMMAND || "codex";
    const args = ["app-server", "--listen", this.url];
    this.proc = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    this.status.launched = true;

    this.proc.stdout.on("data", (chunk) => {
      this.emit("log", { stream: "stdout", text: chunk.toString() });
    });
    this.proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      this.status.lastError = text.trim() || this.status.lastError;
      this.emit("log", { stream: "stderr", text });
    });
    this.proc.on("exit", (code, signal) => {
      this.status.connected = false;
      this.status.lastError = `codex app-server exited with code ${code ?? "null"} signal ${signal ?? "null"}`;
      this.proc = null;
      this.emit("status", this.getStatus());
    });
    this.proc.on("error", (err) => {
      this.status.lastError = err.message;
      this.emit("status", this.getStatus());
    });
  }

  #connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`Timed out connecting to ${this.url}`));
      }, 3500);

      ws.on("open", () => {
        clearTimeout(timer);
        this.ws = ws;
        this.status.connected = true;
        this.status.initialized = false;
        this.initialized = false;
        this.status.lastError = null;
        this.emit("status", this.getStatus());
        resolve();
      });

      ws.on("message", (data) => this.#handleMessage(data));
      ws.on("close", () => {
        this.status.connected = false;
        this.status.initialized = false;
        this.initialized = false;
        this.emit("status", this.getStatus());
        if (this.ws === ws) {
          this.ws = null;
        }
      });
      ws.on("error", (err) => {
        this.status.connected = false;
        this.status.initialized = false;
        this.initialized = false;
        this.status.lastError = err.message;
        this.emit("status", this.getStatus());
        if (this.ws !== ws) {
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  }

  async #initialize() {
    if (this.initialized) {
      return;
    }

    await this.#rawRequest("initialize", {
      clientInfo: {
        name: "callcodex_ios",
        title: "CallCodeX iOS Remote",
        version: "0.1.0"
      },
      capabilities: {
        experimentalApi: true
      }
    });
    this.#notify("initialized", {});
    this.initialized = true;
    this.status.initialized = true;
    this.emit("status", this.getStatus());
  }

  #handleMessage(data) {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      this.emit("notification", { method: "raw", params: { text: data.toString() } });
      return;
    }

    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || `Codex error from ${pending.method}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      this.emit("notification", {
        method: message.method,
        params: message.params || {}
      });
    }
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
