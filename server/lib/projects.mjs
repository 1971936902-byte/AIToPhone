import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const DEFAULT_PROJECT_FILE = path.join(process.cwd(), "projects.json");
const LOCAL_PROJECT_FILE = path.join(process.cwd(), "data", "projects.local.json");

export function loadProjects() {
  const file = fs.existsSync(LOCAL_PROJECT_FILE) ? LOCAL_PROJECT_FILE : DEFAULT_PROJECT_FILE;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const projects = Array.isArray(data.projects) ? data.projects : [];

  return projects.map((project) => ({
    id: String(project.id),
    name: String(project.name),
    cwd: path.resolve(String(project.cwd))
  }));
}

export function refreshProjects(currentProjects = []) {
  const merged = mergeProjects([
    ...currentProjects,
    ...discoverCodexSessionProjects(),
    ...discoverLocalProjectDirs()
  ]);
  saveProjects(merged);
  return merged;
}

export function publicProjects(projects) {
  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    cwd: project.cwd
  }));
}

export function getProject(projects, id) {
  return projects.find((project) => project.id === id);
}

function saveProjects(projects) {
  const payload = {
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      cwd: path.relative(process.cwd(), project.cwd) || "."
    }))
  };
  fs.mkdirSync(path.dirname(LOCAL_PROJECT_FILE), { recursive: true });
  fs.writeFileSync(LOCAL_PROJECT_FILE, JSON.stringify(payload, null, 2), "utf8");
}

function mergeProjects(projects) {
  const byPath = new Map();
  for (const project of projects) {
    const cwd = path.resolve(String(project.cwd || ""));
    if (!cwd || !fs.existsSync(cwd)) continue;
    const key = cwd.toLowerCase();
    if (!byPath.has(key)) {
      byPath.set(key, {
        id: project.id || projectId(cwd),
        name: project.name || path.basename(cwd),
        cwd
      });
    }
  }
  return [...byPath.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

function discoverCodexSessionProjects() {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const roots = [
    path.join(home, ".codex", "sessions"),
    path.join(home, ".codex", "archived_sessions")
  ];
  const projects = [];
  for (const root of roots) {
    for (const file of listFiles(root, ".jsonl", 120)) {
      const lines = readHead(file, 8);
      for (const line of lines) {
        const cwd = parseSessionCwd(line);
        if (cwd && fs.existsSync(cwd)) {
          projects.push({ id: projectId(cwd), name: path.basename(cwd), cwd });
          break;
        }
      }
    }
  }
  return projects;
}

function discoverLocalProjectDirs() {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const roots = [path.join(home, "Documents"), path.join(home, "Desktop")];
  const markers = new Set([
    ".git",
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "Cargo.toml",
    "go.mod",
    "pom.xml",
    "build.gradle",
    "README.md"
  ]);
  const projects = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const cwd = path.join(root, entry.name);
      if (hasAnyMarker(cwd, markers)) {
        projects.push({ id: projectId(cwd), name: entry.name, cwd });
      }
    }
  }
  return projects;
}

function parseSessionCwd(line) {
  try {
    const data = JSON.parse(line);
    return data?.payload?.cwd || data?.payload?.workspace_roots?.[0] || null;
  } catch {
    return null;
  }
}

function listFiles(root, ext, limit) {
  if (!fs.existsSync(root)) return [];
  const stack = [root];
  const files = [];
  while (stack.length && files.length < limit) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile() && entry.name.endsWith(ext)) files.push(fullPath);
    }
  }
  return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs).slice(0, limit);
}

function readHead(file, count) {
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).slice(0, count);
}

function hasAnyMarker(cwd, markers) {
  try {
    return fs.readdirSync(cwd).some((name) => markers.has(name));
  } catch {
    return false;
  }
}

function projectId(cwd) {
  const hash = crypto.createHash("sha1").update(path.resolve(cwd).toLowerCase()).digest("hex").slice(0, 8);
  const slug = path.basename(cwd).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
  return `${slug}-${hash}`;
}
