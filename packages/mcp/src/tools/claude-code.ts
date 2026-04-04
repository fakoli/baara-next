// @baara-next/mcp — Claude Code integration tools (2 tools)
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { IStore, IOrchestratorService } from "@baara-next/core";
import { ok, err } from "../helpers.ts";
import { discoverAll, discoverSkills, getSkillContent } from "../integrations/claude-code.ts";

export function createClaudeCodeTools(_deps: {
  store: IStore;
  orchestrator: IOrchestratorService;
}) {
  // 1. discover_plugins — discover Claude Code plugins/skills/agents from ~/.claude/
  const discoverPlugins = tool(
    "discover_plugins",
    "Discover installed Claude Code plugins, skills, and agents from ~/.claude/plugins/",
    {},
    async () => {
      try {
        const integration = await discoverAll();
        return ok({
          pluginCount: integration.plugins.length,
          skillCount: integration.skills.length,
          agentCount: integration.agents.length,
          commandCount: integration.commands.length,
          plugins: integration.plugins,
          skills: integration.skills.map((s) => ({
            name: s.name,
            fullName: s.fullName,
            pluginName: s.pluginName,
            description: s.description,
            triggers: s.triggers,
          })),
          agents: integration.agents,
          discoveredAt: integration.discoveredAt,
        });
      } catch (e) {
        return err(`Plugin discovery failed: ${String(e)}`);
      }
    }
  );

  // 2. run_skill — load a skill's markdown content as context for execution
  const runSkill = tool(
    "run_skill",
    "Load a Claude Code skill by name and return its markdown content as execution context",
    {
      name: z.string().describe("Skill name or fullName (e.g. 'gws:gws-drive' or 'gws-drive')"),
      arguments: z.string().optional().describe("Optional arguments to pass to the skill"),
    },
    async ({ name, arguments: args }) => {
      try {
        const skills = await discoverSkills();
        const skill = skills.find((s) => s.fullName === name || s.name === name);
        if (!skill) {
          const available = skills.map((s) => s.fullName).join(", ");
          return err(
            `Skill not found: ${name}\n\nAvailable skills: ${available || "(none installed)"}`
          );
        }
        const content = await getSkillContent(skill.path);
        const header = [
          `# Skill: ${skill.fullName}`,
          skill.description ? `> ${skill.description}` : "",
          args ? `\n**Arguments:** ${args}` : "",
          "",
          "---",
          "",
        ]
          .filter(Boolean)
          .join("\n");
        return ok({
          skill: {
            name: skill.name,
            fullName: skill.fullName,
            pluginName: skill.pluginName,
            description: skill.description,
          },
          arguments: args ?? null,
          content: header + content,
        });
      } catch (e) {
        return err(`Failed to load skill: ${String(e)}`);
      }
    }
  );

  return [discoverPlugins, runSkill];
}
