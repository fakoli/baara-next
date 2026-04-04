import { describe, it, expect, mock } from "bun:test";
import { createProjectTools } from "../../tools/projects.ts";
import type { IStore, IOrchestratorService, Project } from "@baara-next/core";

const baseProject: Project = {
  id: "proj-1",
  name: "baara-core",
  description: "Core engine project",
  instructions: "Always use TypeScript strict mode",
  workingDirectory: "/home/user/baara",
  createdAt: "2026-04-04T00:00:00Z",
  updatedAt: "2026-04-04T00:00:00Z",
};

function makeMockStore(): IStore {
  return {
    listTasks: mock(() => []),
    getTask: mock(() => null),
    getTaskByName: mock(() => null),
    createTask: mock(() => { throw new Error("unused"); }),
    updateTask: mock(() => { throw new Error("unused"); }),
    deleteTask: mock(() => undefined),
    createExecution: mock(() => { throw new Error("unused"); }),
    getExecution: mock(() => null),
    listExecutions: mock(() => []),
    updateExecutionStatus: mock(() => undefined),
    updateExecutionFields: mock(() => undefined),
    dequeueExecution: mock(() => null),
    getDeadLetteredExecutions: mock(() => []),
    getPendingInputExecutions: mock(() => []),
    listAllExecutions: mock(() => []),
    countExecutionsByStatus: mock(() => 0),
    appendEvent: mock(() => undefined),
    listEvents: mock(() => []),
    getMaxEventSeq: mock(() => 0),
    createInputRequest: mock((r: { executionId: string; prompt: string; timeoutMs: number; status: "pending" }) => ({ id: "ir1", createdAt: "", ...r })),
    getInputRequest: mock(() => null),
    respondToInput: mock(() => undefined),
    listQueues: mock(() => []),
    getQueueInfo: mock(() => null),
    listTemplates: mock(() => []),
    getTemplate: mock(() => null),
    createTemplate: mock((_id: string, input: { name: string }) => ({ id: _id, name: input.name, description: "", agentConfig: {}, createdAt: "", updatedAt: "" })),
    deleteTemplate: mock(() => undefined),
    listProjects: mock(() => [baseProject]),
    getProject: mock((id: string) => (id === "proj-1" ? baseProject : null)),
    createProject: mock((_id: string, input: { name: string }) => ({ ...baseProject, id: _id, name: input.name })),
    updateProject: mock(() => baseProject),
    deleteProject: mock(() => undefined),
    getSetting: mock(() => null),
    setSetting: mock(() => undefined),
    close: mock(() => undefined),
  } as unknown as IStore;
}

function makeMockOrchestrator(): IOrchestratorService {
  return {
    submitTask: mock(async () => { throw new Error("unused"); }),
    runDirect: mock(async () => { throw new Error("unused"); }),
    cancelExecution: mock(async () => undefined),
    retryExecution: mock(async () => { throw new Error("unused"); }),
    matchTask: mock(async () => null),
    handleExecutionComplete: mock(async () => undefined),
    startExecution: mock(async () => undefined),
    provideInput: mock(async () => undefined),
  } as unknown as IOrchestratorService;
}

describe("project tools", () => {
  it("createProjectTools returns 2 tools", () => {
    const tools = createProjectTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    expect(tools).toHaveLength(2);
  });

  it("list_projects returns all projects with task count", async () => {
    const tools = createProjectTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    const listTool = tools.find(t => (t as { name: string }).name === "list_projects")!;
    const result = await (listTool as { handler: (p: Record<string, never>, extra: unknown) => Promise<unknown> }).handler({}, null);
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].name).toBe("baara-core");
    expect(parsed[0]).toHaveProperty("taskCount");
  });

  it("set_active_project returns project info for known project", async () => {
    const tools = createProjectTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    const setTool = tools.find(t => (t as { name: string }).name === "set_active_project")!;
    const result = await (setTool as { handler: (p: { nameOrId: string }, extra: unknown) => Promise<unknown> }).handler({ nameOrId: "proj-1" }, null);
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.project.id).toBe("proj-1");
  });

  it("set_active_project resolves by name", async () => {
    const tools = createProjectTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    const setTool = tools.find(t => (t as { name: string }).name === "set_active_project")!;
    const result = await (setTool as { handler: (p: { nameOrId: string }, extra: unknown) => Promise<unknown> }).handler({ nameOrId: "baara-core" }, null);
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.project.name).toBe("baara-core");
  });

  it("set_active_project with empty string clears scope", async () => {
    const tools = createProjectTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    const setTool = tools.find(t => (t as { name: string }).name === "set_active_project")!;
    const result = await (setTool as { handler: (p: { nameOrId: string }, extra: unknown) => Promise<unknown> }).handler({ nameOrId: "" }, null);
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.cleared).toBe(true);
  });

  it("set_active_project returns error for unknown project", async () => {
    const tools = createProjectTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    const setTool = tools.find(t => (t as { name: string }).name === "set_active_project")!;
    const result = await (setTool as { handler: (p: { nameOrId: string }, extra: unknown) => Promise<unknown> }).handler({ nameOrId: "nonexistent" }, null);
    expect((result as { isError: boolean }).isError).toBe(true);
  });
});
