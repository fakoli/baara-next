// @baara-next/mcp — Project tools (2 tools)
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { IStore, IOrchestratorService } from "@baara-next/core";
import { ok, err } from "../helpers.ts";

export function createProjectTools(deps: {
  store: IStore;
  orchestrator: IOrchestratorService;
}) {
  const { store } = deps;

  // 1. list_projects
  const listProjects = tool(
    "list_projects",
    "List all projects with their task counts and descriptions",
    {},
    async () => {
      const projects = store.listProjects();
      if (projects.length === 0) {
        return ok({ message: "No projects yet.", projects: [] });
      }
      // Pre-fetch all tasks once and count per project to avoid N+1 queries.
      const allTasks = store.listTasks();
      const tasksByProject = new Map<string, number>();
      for (const t of allTasks) {
        if (t.projectId) {
          tasksByProject.set(t.projectId, (tasksByProject.get(t.projectId) ?? 0) + 1);
        }
      }
      return ok(
        projects.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          workingDirectory: p.workingDirectory,
          taskCount: tasksByProject.get(p.id) ?? 0,
          createdAt: p.createdAt,
        }))
      );
    }
  );

  // 2. set_active_project
  const setActiveProject = tool(
    "set_active_project",
    "Set the active project to scope task operations. Pass an empty string to clear the active project.",
    { nameOrId: z.string().describe("Project name or UUID; pass empty string to clear active project") },
    async ({ nameOrId }) => {
      if (!nameOrId) {
        return ok({ cleared: true, message: "Active project cleared. Operations are now unscoped." });
      }
      const projects = store.listProjects();
      const project = projects.find((p) => p.name === nameOrId) ?? store.getProject(nameOrId);
      if (!project) return err(`Project not found: ${nameOrId}`);
      store.setSetting("active_project_id", project.id);
      return ok({
        message: `Active project set to "${project.name}"`,
        project: { id: project.id, name: project.name, description: project.description },
      });
    }
  );

  return [listProjects, setActiveProject];
}
