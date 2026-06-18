import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(repoRoot);

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error });
  }
}

function read(file) {
  return fs.readFileSync(path.join(repoRoot, file), "utf8");
}

test("HTML loads current cache-busted assets", () => {
  const html = read("public/index.html");
  const sw = read("public/sw.js");
  assert.match(html, /styles\.css\?v=\d+/);
  assert.match(html, /app\.js\?v=\d+/);
  const styleVersion = html.match(/styles\.css\?v=(\d+)/)?.[1];
  const appVersion = html.match(/app\.js\?v=(\d+)/)?.[1];
  assert.ok(sw.includes(`/styles.css?v=${styleVersion}`));
  assert.ok(sw.includes(`/app.js?v=${appVersion}`));
});

test("Mobile viewport and keyboard safeguards are present", () => {
  const html = read("public/index.html");
  const css = read("public/styles.css");
  const app = read("public/app.js");
  assert.match(html, /maximum-scale=1/);
  assert.doesNotMatch(html, /interactive-widget=resizes-content/);
  assert.match(css, /--keyboard-inset/);
  assert.match(css, /#messageInput[\s\S]*font-size:\s*16px/);
  assert.match(app, /setProperty\("--keyboard-inset"/);
  assert.doesNotMatch(app, /scrollIntoView/);
});

test("Send flow immediately renders user text and pending assistant state", () => {
  const app = read("public/app.js");
  assert.match(app, /upsertMessage\(\{ id: optimisticId, threadId, role: "user"/);
  assert.match(app, /addPendingThinking\(threadId\)/);
  assert.match(app, /if \(data\.message\) \{/);
  assert.match(app, /pendingUserMessages\.set\(threadId, optimisticId\)/);
  assert.match(app, /confirmUserMessage\(threadId, data\.message\)/);
  assert.match(app, /function replaceMessageNode\(oldId, message\)/);
  assert.match(app, /removePendingThinking\(payload\.threadId\)/);
});

test("Send and upload failures preserve recoverable user state", () => {
  const app = read("public/app.js");
  assert.match(app, /restoreComposerDraft\(text, attachments\)/);
  assert.match(app, /function restoreComposerDraft\(text, attachments\)/);
  assert.match(app, /els\.messageInput\.value = text/);
  assert.match(app, /state\.attachments = \[\.{3}restored, \.{3}state\.attachments\]/);
  assert.match(app, /附件上传失败/);
});

test("Sidebar supports selected project collapse state", () => {
  const app = read("public/app.js");
  assert.match(app, /collapsedProjects: loadCollapsedProjects\(\)/);
  assert.match(app, /section\.open = selected && !state\.collapsedProjects\.has\(group\.id\)/);
  assert.match(app, /setProjectCollapsed\(group\.id, section\.open\)/);
});

test("Client sync loop is below 5 seconds and websocket reconnects", () => {
  const app = read("public/app.js");
  const server = read("server/index.mjs");
  assert.match(server, /SYNC_INTERVAL_MS \|\| 3000/);
  assert.match(app, /setTimeout\(connectEvents, 2500\)/);
  assert.match(app, /setInterval\(async \(\) =>[\s\S]*}, 4000\)/);
});

test("Scheduled message UI posts delay and renders pending jobs", () => {
  const html = read("public/index.html");
  const app = read("public/app.js");
  assert.match(html, /id="scheduleBtn"/);
  assert.match(html, /id="scheduleDialog"/);
  assert.match(html, /id="scheduleHours"/);
  assert.match(html, /id="scheduleMinutes"/);
  assert.match(app, /api\("\/api\/scheduled-messages"/);
  assert.match(app, /delayHours/);
  assert.match(app, /delayMinutes/);
  assert.match(app, /renderScheduledMessages\(\)/);
});

test("Scheduled message API is server-side and runs under 5 seconds", () => {
  const server = read("server/index.mjs");
  assert.match(server, /new ScheduledMessageStore\(\)/);
  assert.match(server, /SCHEDULER_INTERVAL_MS \|\| 1000/);
  assert.match(server, /Math\.min\(Number\(process\.env\.SCHEDULER_INTERVAL_MS \|\| 1000\), 4000\)/);
  assert.match(server, /\/api\/scheduled-messages/);
  assert.match(server, /runScheduledMessage/);
  assert.match(server, /sendThreadMessage\(\{[\s\S]*event: "scheduled-message"/);
});

test("Remote Codex sessions default to writable git-friendly permissions", () => {
  const codex = read("server/lib/codexAppServer.mjs");
  const env = read(".env.example");
  const readme = read("README.md");
  assert.match(codex, /DEFAULT_APPROVAL_POLICY = "never"/);
  assert.match(codex, /DEFAULT_SANDBOX = "danger-full-access"/);
  assert.match(codex, /getThreadPermissions\(\)/);
  assert.match(env, /CODEX_APPROVAL_POLICY=never/);
  assert.match(env, /CODEX_SANDBOX=danger-full-access/);
  assert.match(readme, /CODEX_APPROVAL_POLICY=never/);
  assert.match(readme, /CODEX_SANDBOX=danger-full-access/);
});

test("Codex app-server launcher supports Windows command shims", () => {
  const codex = read("server/lib/codexAppServer.mjs");
  assert.match(codex, /spawnOptionsForCommand\(command\)/);
  assert.match(codex, /process\.platform === "win32"/);
  assert.match(codex, /\\\.\(cmd\|bat\)\$/);
  assert.match(codex, /shell: true/);
});

test("Server entry delegates infrastructure concerns to modules", () => {
  const server = read("server/index.mjs");
  const check = read("server/check.mjs");
  assert.match(server, /from "\.\/lib\/httpUtils\.mjs"/);
  assert.match(server, /from "\.\/lib\/uploads\.mjs"/);
  assert.match(server, /from "\.\/lib\/accountService\.mjs"/);
  assert.doesNotMatch(server, /function saveUpload/);
  assert.doesNotMatch(server, /function readJson/);
  assert.doesNotMatch(server, /function serveStatic/);
  assert.match(check, /server\/lib\/httpUtils\.mjs/);
  assert.match(check, /server\/lib\/uploads\.mjs/);
  assert.match(check, /server\/lib\/accountService\.mjs/);
});

test("Deployment docs and Windows control panel are present", () => {
  const readme = read("README.md");
  const deployment = read("DEPLOYMENT.md");
  const launcher = read("AIToPhone-Control-Panel.cmd");
  const panel = read("scripts/aitophone-control-panel.ps1");
  assert.match(readme, /AIToPhone-Control-Panel\.cmd/);
  assert.match(readme, /DEPLOYMENT\.md/);
  assert.match(deployment, /CodeX WebSocket/);
  assert.match(deployment, /一键连接/);
  assert.match(launcher, /aitophone-control-panel\.ps1/);
  assert.match(panel, /System\.Windows\.Forms/);
  assert.match(panel, /Restart-AIToPhoneGateway/);
  assert.match(panel, /Trigger-CodexConnection/);
});

await testConversationStoreContract();
await testCodexEventNormalization();
await testScheduledMessageStoreContract();
await testUploadServiceContract();
await testAccountServiceContract();

for (const result of results) {
  if (result.ok) {
    console.log(`ok - ${result.name}`);
  } else {
    console.error(`not ok - ${result.name}`);
    console.error(result.error?.stack || result.error);
  }
}

const failed = results.filter((result) => !result.ok);
if (failed.length) {
  process.exitCode = 1;
} else {
  console.log(`\n${results.length} web contract tests passed.`);
}

async function testConversationStoreContract() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aitophone-web-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  try {
    const { ConversationStore } = await import(`file:///${path.join(repoRoot, "server/lib/conversationStore.mjs").replace(/\\/g, "/")}?t=${Date.now()}`);
    const projects = [
      { id: "mobile-project", name: "手机端假项目", cwd: path.join(tmp, "mobile-project") },
      { id: "desktop-project", name: "电脑端假项目", cwd: path.join(tmp, "desktop-project") }
    ];
    const store = new ConversationStore(projects);
    store.createThread({
      threadId: "thread-mobile-1",
      projectId: "mobile-project",
      projectName: "手机端假项目",
      cwd: projects[0].cwd,
      createdAt: "2026-06-15T01:00:00.000Z"
    });
    const user = store.addMessage({
      threadId: "thread-mobile-1",
      role: "user",
      text: "手机端输入问题",
      attachments: [{ kind: "image", name: "fake.png", path: path.join(tmp, "fake.png") }]
    });
    const agent1 = store.upsertAgentMessage({
      threadId: "thread-mobile-1",
      messageId: "agent-1",
      turnId: "turn-1",
      mode: "append",
      text: "第一段"
    });
    const agent2 = store.upsertAgentMessage({
      threadId: "thread-mobile-1",
      messageId: "agent-1",
      turnId: "turn-1",
      mode: "append",
      text: "第二段"
    });

    test("Fake mobile send persists user and assistant messages", () => {
      assert.equal(user.role, "user");
      assert.equal(agent1.id, "agent-1");
      assert.equal(agent2.text, "第一段第二段");
      assert.equal(store.getMessages("thread-mobile-1").length, 2);
    });

    test("Fake desktop reload sees mobile-created conversation", () => {
      const desktopView = new ConversationStore(projects);
      const group = desktopView.listConversations().find((item) => item.id === "mobile-project");
      assert.equal(group.threads.length, 1);
      assert.equal(group.threads[0].threadId, "thread-mobile-1");
      assert.equal(desktopView.getMessages("thread-mobile-1").length, 2);
    });

    test("Thread deletion removes messages from fake sync store", () => {
      assert.equal(store.deleteThread("thread-mobile-1"), true);
      assert.equal(store.getMessages("thread-mobile-1").length, 0);
    });
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function testCodexEventNormalization() {
  const { normalizeCodexEvent } = await import(`file:///${path.join(repoRoot, "server/lib/conversationStore.mjs").replace(/\\/g, "/")}?norm=${Date.now()}`);

  test("Codex delta event normalizes to append agent text", () => {
    const update = normalizeCodexEvent({
      method: "thread/item/update",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        delta: "hello",
        item: { id: "msg-1", type: "agentMessage", phase: "final_answer" }
      }
    });
    assert.deepEqual(update, {
      kind: "agent-text",
      threadId: "thread-1",
      turnId: "turn-1",
      messageId: "msg-1",
      mode: "append",
      text: "hello"
    });
  });

  test("Codex turn complete event normalizes for send-button recovery", () => {
    const update = normalizeCodexEvent({
      method: "thread/turn",
      params: { threadId: "thread-1", turnId: "turn-1", status: "completed" }
    });
    assert.deepEqual(update, {
      kind: "turn-complete",
      threadId: "thread-1",
      turnId: "turn-1"
    });
  });

  test("Non-final or non-agent Codex events are ignored", () => {
    assert.equal(
      normalizeCodexEvent({
        method: "thread/item/update",
        params: { threadId: "thread-1", delta: "ignore", item: { type: "toolCall", phase: "final_answer" } }
      }),
      null
    );
    assert.equal(
      normalizeCodexEvent({
        method: "thread/item/update",
        params: { threadId: "thread-1", delta: "ignore", item: { type: "agentMessage", phase: "analysis" } }
      }),
      null
    );
  });
}

async function testScheduledMessageStoreContract() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aitophone-schedule-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  try {
    const { ScheduledMessageStore } = await import(`file:///${path.join(repoRoot, "server/lib/scheduledMessages.mjs").replace(/\\/g, "/")}?t=${Date.now()}`);
    const store = new ScheduledMessageStore();
    const pending = store.create({
      threadId: "thread-1",
      projectId: "project-1",
      text: "scheduled hello",
      attachments: [],
      sendAt: new Date(Date.now() + 60_000).toISOString()
    });
    const due = store.create({
      threadId: "thread-1",
      projectId: "project-1",
      text: "due hello",
      attachments: [],
      sendAt: new Date(Date.now() - 1000).toISOString()
    });

    test("Scheduled store persists pending jobs and finds due jobs", () => {
      assert.equal(store.list().length, 2);
      assert.equal(store.getDue().map((job) => job.id).includes(due.id), true);
      assert.equal(store.getDue().map((job) => job.id).includes(pending.id), false);
    });

    test("Scheduled store cancels and removes thread jobs from active list", () => {
      assert.equal(store.cancel(pending.id)?.status, "cancelled");
      assert.deepEqual(store.deleteForThread("thread-1"), [due.id]);
      assert.equal(store.list().length, 0);
      const reloaded = new ScheduledMessageStore();
      assert.equal(reloaded.get(pending.id).status, "cancelled");
      assert.equal(reloaded.get(due.id).status, "cancelled");
    });
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function testUploadServiceContract() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aitophone-upload-test-"));
  try {
    const { UploadService, buildMessageText } = await import(`file:///${path.join(repoRoot, "server/lib/uploads.mjs").replace(/\\/g, "/")}?u=${Date.now()}`);
    const service = new UploadService(path.join(tmp, "uploads"));
    const upload = service.save({
      name: "smoke?.txt",
      type: "text/plain",
      dataUrl: `data:text/plain;base64,${Buffer.from("hello upload").toString("base64")}`
    });

    test("Upload service sanitizes and resolves stored attachments", () => {
      assert.equal(upload.kind, "file");
      assert.equal(fs.readFileSync(upload.path, "utf8"), "hello upload");
      assert.equal(service.resolve(upload).path, upload.path);
      assert.equal(service.resolve({ path: path.join(tmp, "outside.txt") }), null);
    });

    test("Upload message text includes attachment names and paths", () => {
      const text = buildMessageText("see file", [upload]);
      assert.match(text, /see file/);
      assert.match(text, /附件/);
      assert.match(text, new RegExp(upload.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function testAccountServiceContract() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aitophone-account-test-"));
  try {
    const { AccountService } = await import(`file:///${path.join(repoRoot, "server/lib/accountService.mjs").replace(/\\/g, "/")}?a=${Date.now()}`);
    const authDir = path.join(tmp, ".codex");
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(path.join(authDir, "auth.json"), JSON.stringify({ account_id: "acct_local" }), "utf8");
    const service = new AccountService({
      homeDir: tmp,
      codex: {
        readAccount: async () => ({ account: { type: "chatgpt", email: "test@example.com" } }),
        readRateLimits: async () => ({ rateLimits: { primary: { usedPercent: 10 } } }),
        readUsage: async () => ({ summary: { lifetimeTokens: 42 } })
      }
    });

    const snapshot = await service.readSnapshot();
    test("Account service reads snapshots and exposes cached values", () => {
      assert.equal(snapshot.account.account.email, "test@example.com");
      assert.equal(snapshot.limits.rateLimits.primary.usedPercent, 10);
      assert.equal(service.fromCache().usage.summary.lifetimeTokens, 42);
    });

    test("Account service falls back to local account hint", () => {
      const fallback = new AccountService({ homeDir: tmp, codex: {} });
      assert.equal(fallback.fromCache().account.account.accountId, "acct_local");
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
