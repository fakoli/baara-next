import { describe, it, expect, spyOn } from "bun:test";
import { createClaudeCodeTools } from "../../tools/claude-code.ts";
import type { IStore, IOrchestratorService } from "@baara-next/core";

// We test with a mock of the integrations module
const mockSkills = [
  {
    name: "gws-drive",
    fullName: "gws:gws-drive",
    pluginName: "gws",
    description: "Manage Google Drive files",
    triggers: ["drive", "gdrive"],
    path: "/home/user/.claude/plugins/gws/skills/gws-drive.md",
  },
  {
    name: "deploy",
    fullName: "superpowers:deploy",
    pluginName: "superpowers",
    description: "Deploy application",
    triggers: ["deploy", "ship"],
    path: "/home/user/.claude/plugins/superpowers/skills/deploy.md",
  },
];

const mockDiscovery = {
  plugins: [
    { name: "gws", description: "Google Workspace", version: "1.0.0", author: "test", marketplace: false, keywords: ["google"] },
  ],
  commands: ["gws:gws-drive", "superpowers:deploy"],
  skills: mockSkills,
  agents: [],
  discoveredAt: "2026-04-04T00:00:00Z",
};

function makeMockStore(): IStore {
  return {} as unknown as IStore;
}

function makeMockOrchestrator(): IOrchestratorService {
  return {} as unknown as IOrchestratorService;
}

describe("claude-code tools", () => {
  it("createClaudeCodeTools returns 2 tools", () => {
    const tools = createClaudeCodeTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    expect(tools).toHaveLength(2);
    const names = tools.map(t => (t as { name: string }).name);
    expect(names).toContain("discover_plugins");
    expect(names).toContain("run_skill");
  });

  it("discover_plugins returns plugin discovery summary", async () => {
    const tools = createClaudeCodeTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    const discoverTool = tools.find(t => (t as { name: string }).name === "discover_plugins")!;

    // Mock the integration module at test runtime
    const integrations = await import("../../integrations/claude-code.ts");
    const spy = spyOn(integrations, "discoverAll").mockResolvedValue(mockDiscovery);

    const result = await (discoverTool as { handler: (p: Record<string, never>, extra: unknown) => Promise<unknown> }).handler({}, null);
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.pluginCount).toBe(1);
    expect(parsed.skillCount).toBe(2);
    spy.mockRestore();
  });

  it("run_skill returns error when skill not found", async () => {
    const tools = createClaudeCodeTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    const runTool = tools.find(t => (t as { name: string }).name === "run_skill")!;

    const integrations = await import("../../integrations/claude-code.ts");
    const spy = spyOn(integrations, "discoverSkills").mockResolvedValue([]);

    const result = await (runTool as { handler: (p: { name: string }, extra: unknown) => Promise<unknown> }).handler({ name: "nonexistent" }, null);
    expect((result as { isError: boolean }).isError).toBe(true);
    expect((result as { content: Array<{ text: string }> }).content[0].text).toContain("nonexistent");
    spy.mockRestore();
  });
});
