import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "scheduled-messages.json");

export class ScheduledMessageStore {
  constructor() {
    this.jobs = new Map();
    this.load();
  }

  load() {
    if (!fs.existsSync(DATA_FILE)) {
      return;
    }

    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    for (const job of data.jobs || []) {
      this.jobs.set(job.id, job);
    }
  }

  save() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        {
          version: 1,
          savedAt: new Date().toISOString(),
          jobs: [...this.jobs.values()]
        },
        null,
        2
      ),
      "utf8"
    );
  }

  list({ includeDone = false } = {}) {
    return [...this.jobs.values()]
      .filter((job) => includeDone || ["pending", "sending"].includes(job.status))
      .sort((a, b) => String(a.sendAt).localeCompare(String(b.sendAt)));
  }

  create({ threadId, projectId, text, attachments = [], sendAt }) {
    const now = new Date().toISOString();
    const job = {
      id: `schedule_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      threadId,
      projectId: projectId || "",
      text,
      attachments,
      sendAt,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      error: "",
      sentMessageId: ""
    };
    this.jobs.set(job.id, job);
    this.save();
    return job;
  }

  get(jobId) {
    return this.jobs.get(jobId);
  }

  getDue(now = Date.now()) {
    return this.list()
      .filter((job) => job.status === "pending" && new Date(job.sendAt).getTime() <= now);
  }

  cancel(jobId) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "pending") {
      return null;
    }
    job.status = "cancelled";
    job.updatedAt = new Date().toISOString();
    this.save();
    return job;
  }

  markSending(jobId) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "pending") {
      return null;
    }
    job.status = "sending";
    job.updatedAt = new Date().toISOString();
    this.save();
    return job;
  }

  markSent(jobId, messageId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }
    job.status = "sent";
    job.sentMessageId = messageId || "";
    job.error = "";
    job.updatedAt = new Date().toISOString();
    this.save();
    return job;
  }

  markFailed(jobId, error) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }
    job.status = "failed";
    job.error = error || "Scheduled send failed";
    job.updatedAt = new Date().toISOString();
    this.save();
    return job;
  }

  deleteForThread(threadId) {
    const cancelled = [];
    for (const job of this.jobs.values()) {
      if (job.threadId === threadId && ["pending", "sending"].includes(job.status)) {
        job.status = "cancelled";
        job.updatedAt = new Date().toISOString();
        cancelled.push(job.id);
      }
    }
    if (cancelled.length) {
      this.save();
    }
    return cancelled;
  }

  deleteForProject(projectId) {
    const cancelled = [];
    for (const job of this.jobs.values()) {
      if (job.projectId === projectId && ["pending", "sending"].includes(job.status)) {
        job.status = "cancelled";
        job.updatedAt = new Date().toISOString();
        cancelled.push(job.id);
      }
    }
    if (cancelled.length) {
      this.save();
    }
    return cancelled;
  }
}
