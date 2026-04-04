import { describe, it, expect, mock } from "bun:test";
import { createBaaraMcpServer } from "../server.ts";
import type { IStore, IOrchestratorService } from "@baara-next/core";

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

describe("createBaaraMcpServer", () => {
  it("returns an object (MCP server)", () => {
    const server = createBaaraMcpServer({
      store: makeMockStore(),
      orchestrator: makeMockOrchestrator(),
    });
    expect(server).toBeDefined();
    expect(typeof server).toBe("object");
  });

  it("server has a name property equal to baara-next", () => {
    const server = createBaaraMcpServer({
      store: makeMockStore(),
      orchestrator: makeMockOrchestrator(),
    });
    // createSdkMcpServer returns a server with a name property
    expect((server as { name?: string }).name).toBe("baara-next");
  });

  it("aggregates all 27 tools across all tool files", () => {
    // Verify that the tool count matches by inspecting the tools array
    // The server is created with 27 tools total
    const { createTaskTools } = require("../tools/tasks.ts");
    const { createExecutionTools } = require("../tools/executions.ts");
    const { createQueueTools } = require("../tools/queues.ts");
    const { createHitlTools } = require("../tools/hitl.ts");
    const { createTemplateTools } = require("../tools/templates.ts");
    const { createProjectTools } = require("../tools/projects.ts");
    const { createClaudeCodeTools } = require("../tools/claude-code.ts");
    const store = makeMockStore();
    const orchestrator = makeMockOrchestrator();
    const deps = { store, orchestrator };
    const total =
      createTaskTools(deps).length +
      createExecutionTools(deps).length +
      createQueueTools(deps).length +
      createHitlTools(deps).length +
      createTemplateTools(deps).length +
      createProjectTools(deps).length +
      createClaudeCodeTools(deps).length;
    expect(total).toBe(27);
  });
});
