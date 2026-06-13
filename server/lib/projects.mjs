import fs from "node:fs";
import path from "node:path";

export function loadProjects() {
  const file = path.join(process.cwd(), "projects.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const projects = Array.isArray(data.projects) ? data.projects : [];

  return projects.map((project) => ({
    id: String(project.id),
    name: String(project.name),
    cwd: path.resolve(String(project.cwd))
  }));
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
