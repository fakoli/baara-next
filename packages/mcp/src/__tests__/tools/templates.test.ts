import { describe, it, expect, mock } from "bun:test";
import { createTemplateTools } from "../../tools/templates.ts";
import type { IStore, IOrchestratorService, Template } from "@baara-next/core";

const baseTemplate: Template = {
  id: "tmpl-1",
  name: "web-researcher",
  description: "Researches a topic on the web",
  agentConfig: { allowedTools: ["WebSearch"], maxTurns: 10 },
  createdAt: "2026-04-04T00:00:00Z",
  updatedAt: "2026-04-04T00:00:00Z",
};

const baseTask = {
  id: "task-new-1",
  name: "research-ai",
  description: "from template",
  prompt: "Research AI",
  timeoutMs: 30000,
  executionType: "cloud_code" as const,
  agentConfig: { allowedTools: ["WebSearch"], maxTurns: 10 },
  priority: 2 as const,
  targetQueue: "default",
  maxRetries: 3,
  executionMode: "queued" as const,
  enabled: true,
  projectId: null,
  createdAt: "2026-04-04T00:00:00Z",
  updatedAt: "2026-04-04T00:00:00Z",
};

function makeMockStore(): IStore {
  return {
    listTasks: mock(() => []),
    getTask: mock(() => null),
    getTaskByName: mock(() => null),
    createTask: mock((_id: string, input: { name: string }) => ({ ...baseTask, name: input.name })),
    updateTask: mock(() => baseTask),
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
    listTemplates: mock(() => [baseTemplate]),
    getTemplate: mock((id: string) => (id === "tmpl-1" ? baseTemplate : null)),
    createTemplate: mock((_id: string, input: { name: string }) => ({ ...baseTemplate, id: _id, name: input.name })),
    deleteTemplate: mock(() => undefined),
    listProjects: mock(() => []),
    getProject: mock(() => null),
    createProject: mock((_id: string, input: { name: string }) => ({ id: _id, name: input.name, description: "", instructions: "", workingDirectory: "", createdAt: "", updatedAt: "" })),
    updateProject: mock(() => ({ id: "p1", name: "proj", description: "", instructions: "", workingDirectory: "", createdAt: "", updatedAt: "" })),
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

describe("template tools", () => {
  it("createTemplateTools returns 2 tools", () => {
    const tools = createTemplateTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    expect(tools).toHaveLength(2);
  });

  it("list_templates returns all templates", async () => {
    const tools = createTemplateTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    const listTool = tools.find(t => (t as { name: string }).name === "list_templates")!;
    const result = await (listTool as { handler: (p: Record<string, never>, extra: unknown) => Promise<unknown> }).handler({}, null);
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].name).toBe("web-researcher");
  });

  it("create_task_from_template creates task with template agentConfig", async () => {
    const store = makeMockStore();
    const tools = createTemplateTools({ store, orchestrator: makeMockOrchestrator() });
    const fromTemplate = tools.find(t => (t as { name: string }).name === "create_task_from_template")!;
    const result = await (fromTemplate as { handler: (p: { templateId: string; name: string; prompt: string }, extra: unknown) => Promise<unknown> }).handler({
      templateId: "tmpl-1",
      name: "research-ai",
      prompt: "Research AI trends",
    }, null);
    expect(store.createTask).toHaveBeenCalled();
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.name).toBe("research-ai");
  });

  it("create_task_from_template returns error for unknown template", async () => {
    const tools = createTemplateTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    const fromTemplate = tools.find(t => (t as { name: string }).name === "create_task_from_template")!;
    const result = await (fromTemplate as { handler: (p: { templateId: string; name: string; prompt: string }, extra: unknown) => Promise<unknown> }).handler({
      templateId: "nonexistent",
      name: "test",
      prompt: "test",
    }, null);
    expect((result as { isError: boolean }).isError).toBe(true);
  });
});
