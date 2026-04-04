// @baara-next/mcp — Template tools (2 tools)
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { IStore, IOrchestratorService } from "@baara-next/core";
import { ok, err } from "../helpers.ts";

export function createTemplateTools(deps: {
  store: IStore;
  orchestrator: IOrchestratorService;
}) {
  const { store } = deps;

  // 1. list_templates
  const listTemplates = tool(
    "list_templates",
    "List all available task templates with their description and agent config",
    {},
    async () => {
      const templates = store.listTemplates();
      if (templates.length === 0) {
        return ok({ message: "No templates available.", templates: [] });
      }
      return ok(
        templates.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          agentConfig: t.agentConfig,
          createdAt: t.createdAt,
        }))
      );
    }
  );

  // 2. create_task_from_template
  const createTaskFromTemplate = tool(
    "create_task_from_template",
    "Create a new task using a template's agent configuration as the base",
    {
      templateId: z.string().describe("Template UUID"),
      name: z.string().describe("Unique name for the new task"),
      prompt: z.string().describe("Prompt for the task to execute"),
      description: z.string().optional().describe("Task description (defaults to template description)"),
      cronExpression: z.string().optional().describe("Cron schedule, e.g. '0 9 * * *'"),
      executionMode: z.enum(["queued", "direct"]).optional().describe("Execution mode (default: queued)"),
      priority: z.number().int().min(0).max(3).optional().describe("Priority 0-3 (default: 2)"),
      projectId: z.string().optional().describe("Project UUID to associate the task with"),
    },
    async (args) => {
      const template = store.getTemplate(args.templateId);
      if (!template) return err(`Template not found: ${args.templateId}`);
      try {
        const id = crypto.randomUUID();
        const task = store.createTask(id, {
          name: args.name,
          prompt: args.prompt,
          description: args.description ?? template.description,
          cronExpression: args.cronExpression ?? null,
          executionMode: args.executionMode,
          priority: args.priority as 0 | 1 | 2 | 3 | undefined,
          projectId: args.projectId ?? null,
          agentConfig: template.agentConfig,
        });
        return ok({ ...task, fromTemplate: template.name });
      } catch (e) {
        return err(`Failed to create task from template: ${String(e)}`);
      }
    }
  );

  return [listTemplates, createTaskFromTemplate];
}
