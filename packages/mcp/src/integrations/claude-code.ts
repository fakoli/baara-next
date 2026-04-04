// @baara-next/mcp — Claude Code plugin/skill/agent discovery
//
// Discovers Claude Code plugins, skills, and agents from ~/.claude/
// Ported from the original BAARA integration with minimal adjustments.

import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";

export interface Plugin {
  name: string;
  description: string;
  version: string;
  author: string;
  marketplace: boolean;
  keywords: string[];
}

export interface Skill {
  name: string;
  fullName: string;
  pluginName: string;
  description: string;
  triggers: string[];
  path: string;
}

export interface Agent {
  name: string;
  fullName: string;
  pluginName: string;
  description: string;
  model?: string;
}

export interface Command {
  name: string;
  fullName: string;
  source: string;
  pluginName?: string;
  description: string;
  argumentHint?: string;
}

export interface ClaudeCodeIntegration {
  plugins: Plugin[];
  commands: string[];
  skills: Skill[];
  agents: Agent[];
  discoveredAt: string;
}

const CLAUDE_DIR = join(homedir(), ".claude");

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(p: string): Promise<T | null> {
  try {
    const raw = await readFile(p, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function extractMarkdownDescription(content: string): string {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("---")) {
      return trimmed.slice(0, 200);
    }
  }
  return "";
}

function extractFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon > 0) {
      fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
  }
  return fm;
}

export async function discoverAll(): Promise<ClaudeCodeIntegration> {
  const pluginsDir = join(CLAUDE_DIR, "plugins");
  const result: ClaudeCodeIntegration = {
    plugins: [],
    commands: [],
    skills: [],
    agents: [],
    discoveredAt: new Date().toISOString(),
  };

  if (!(await pathExists(pluginsDir))) return result;

  let entries: string[] = [];
  try {
    entries = await readdir(pluginsDir);
  } catch {
    return result;
  }

  for (const entry of entries) {
    const pluginDir = join(pluginsDir, entry);
    const manifestPath = join(pluginDir, "package.json");
    const manifest = await readJsonFile<{
      name?: string;
      description?: string;
      version?: string;
      author?: string;
      keywords?: string[];
      claude?: { marketplace?: boolean };
    }>(manifestPath);

    const pluginName = manifest?.name ?? entry;
    result.plugins.push({
      name: pluginName,
      description: manifest?.description ?? "",
      version: manifest?.version ?? "0.0.0",
      author: typeof manifest?.author === "string" ? manifest.author : "",
      marketplace: manifest?.claude?.marketplace ?? false,
      keywords: manifest?.keywords ?? [],
    });

    // Discover skills
    const skillsDir = join(pluginDir, "skills");
    if (await pathExists(skillsDir)) {
      let skillFiles: string[] = [];
      try {
        skillFiles = await readdir(skillsDir);
      } catch {
        skillFiles = [];
      }
      for (const sf of skillFiles.filter((f) => f.endsWith(".md"))) {
        const skillPath = join(skillsDir, sf);
        let content = "";
        try {
          content = await readFile(skillPath, "utf8");
        } catch {
          continue;
        }
        const fm = extractFrontmatter(content);
        const name = fm["name"] ?? basename(sf, ".md");
        const fullName = `${pluginName}:${name}`;
        const triggers = fm["triggers"]
          ? fm["triggers"].split(",").map((s: string) => s.trim()).filter(Boolean)
          : [name];
        result.skills.push({
          name,
          fullName,
          pluginName,
          description: fm["description"] ?? extractMarkdownDescription(content),
          triggers,
          path: skillPath,
        });
        result.commands.push(fullName);
      }
    }

    // Discover agents
    const agentsDir = join(pluginDir, "agents");
    if (await pathExists(agentsDir)) {
      let agentFiles: string[] = [];
      try {
        agentFiles = await readdir(agentsDir);
      } catch {
        agentFiles = [];
      }
      for (const af of agentFiles.filter((f) => f.endsWith(".md"))) {
        const agentPath = join(agentsDir, af);
        let content = "";
        try {
          content = await readFile(agentPath, "utf8");
        } catch {
          continue;
        }
        const fm = extractFrontmatter(content);
        const name = fm["name"] ?? basename(af, ".md");
        result.agents.push({
          name,
          fullName: `${pluginName}:${name}`,
          pluginName,
          description: fm["description"] ?? extractMarkdownDescription(content),
          model: fm["model"],
        });
      }
    }
  }

  return result;
}

export async function discoverSkills(): Promise<Skill[]> {
  const integration = await discoverAll();
  return integration.skills;
}

export async function discoverCommandsDeep(): Promise<Command[]> {
  const integration = await discoverAll();
  return integration.skills.map((s) => ({
    name: s.name,
    fullName: s.fullName,
    source: "plugin",
    pluginName: s.pluginName,
    description: s.description,
  }));
}

export async function discoverAgents(): Promise<Agent[]> {
  const integration = await discoverAll();
  return integration.agents;
}

export async function getSkillContent(skillPath: string): Promise<string> {
  return readFile(skillPath, "utf8");
}
