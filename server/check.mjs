import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const required = [
  "server/index.mjs",
  "server/lib/accountService.mjs",
  "server/lib/codexAppServer.mjs",
  "server/lib/httpUtils.mjs",
  "server/lib/projects.mjs",
  "server/lib/scheduledMessages.mjs",
  "server/lib/uploads.mjs",
  "public/index.html",
  "public/app.js",
  "public/sw.js",
  "public/manifest.webmanifest",
  "projects.json"
];

let ok = true;
for (const file of required) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) {
    console.error(`missing ${file}`);
    ok = false;
  }
}

if (!ok) {
  process.exit(1);
}

const projects = JSON.parse(fs.readFileSync(path.join(root, "projects.json"), "utf8"));
if (!Array.isArray(projects.projects) || projects.projects.length === 0) {
  console.error("projects.json must contain at least one project");
  process.exit(1);
}

console.log("AIToPhone project files look good.");
