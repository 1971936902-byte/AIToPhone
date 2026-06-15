import fs from "node:fs";
import path from "node:path";

export class AccountService {
  constructor({ codex, homeDir = process.env.USERPROFILE || process.env.HOME || "" }) {
    this.codex = codex;
    this.homeDir = homeDir;
    this.cache = {
      account: null,
      limits: null,
      usage: null,
      updatedAt: null
    };
  }

  async readSnapshot() {
    const [account, limits, usage] = await Promise.allSettled([
      withTimeout(this.codex.readAccount(), 6000, "account/read timed out"),
      withTimeout(this.codex.readRateLimits(), 6000, "account/rateLimits/read timed out"),
      withTimeout(this.codex.readUsage(), 6000, "account/usage/read timed out")
    ]);

    this.updateCache("account", account);
    this.updateCache("limits", limits);
    this.updateCache("usage", usage);

    const errors = settledErrors({ account, limits, usage });
    const accountValue = settledValue(account);
    return {
      account: hasAccountDetails(accountValue) ? accountValue : this.cache.account || this.readLocalHint() || accountValue,
      limits: settledValue(limits) || this.cache.limits,
      usage: settledValue(usage) || this.cache.usage,
      errors,
      stale: Object.keys(errors).length > 0,
      updatedAt: this.cache.updatedAt || new Date().toISOString()
    };
  }

  fromCache() {
    return {
      account: this.cache.account || this.readLocalHint(),
      limits: this.cache.limits,
      usage: this.cache.usage,
      errors: {},
      stale: false,
      updatedAt: this.cache.updatedAt
    };
  }

  updateCache(key, result) {
    if (result.status === "fulfilled" && result.value) {
      if (key === "account" && !hasAccountDetails(result.value)) {
        return;
      }
      this.cache[key] = result.value;
      this.cache.updatedAt = new Date().toISOString();
    }
  }

  readLocalHint() {
    try {
      const authPath = path.join(this.homeDir, ".codex", "auth.json");
      if (!fs.existsSync(authPath)) {
        return null;
      }
      const data = JSON.parse(fs.readFileSync(authPath, "utf8"));
      const accountId = data?.tokens?.account_id || data?.account_id || data?.chatgpt_account_id;
      if (!accountId) {
        return null;
      }
      return {
        account: {
          type: "local",
          accountId
        },
        requiresOpenaiAuth: false,
        source: "local-auth-hint"
      };
    } catch {
      return null;
    }
  }
}

function settledValue(result) {
  return result.status === "fulfilled" ? result.value : null;
}

function hasAccountDetails(value) {
  return Boolean(value?.account);
}

function settledErrors(results) {
  const errors = {};
  for (const [key, result] of Object.entries(results)) {
    if (result.status === "rejected") {
      errors[key] = result.reason?.message || String(result.reason);
    }
  }
  return errors;
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  ]);
}
