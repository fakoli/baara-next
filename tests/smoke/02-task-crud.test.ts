// tests/smoke/02-task-crud.test.ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, makeApi, type ServerHandle } from "./helpers.ts";

describe("02-task-crud", () => {
  let handle: ServerHandle;
  let api: ReturnType<typeof makeApi>;

  beforeAll(async () => {
    handle = await startServer();
    api = makeApi(handle.baseUrl);
  });

  afterAll(async () => {
    await handle.cleanup();
  });

  let taskId: string;
  const taskName = `smoke-crud-${Date.now()}`;

  it("POST /api/tasks creates a task", async () => {
    const res = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: taskName,
        prompt: "echo hello from smoke test",
        description: "Smoke test CRUD task",
        sandboxType: "native",
        executionMode: "direct",
      }),
    });
    expect(res.status).toBe(201);
    const task = await res.json() as Record<string, unknown>;
    expect(task["name"]).toBe(taskName);
    expect(task["id"]).toBeTruthy();
    taskId = task["id"] as string;
  });

  it("GET /api/tasks returns the task in the list", async () => {
    const res = await api("/api/tasks");
    expect(res.status).toBe(200);
    const tasks = await res.json() as Array<Record<string, unknown>>;
    expect(tasks.some((t) => t["id"] === taskId)).toBe(true);
  });

  it("GET /api/tasks/:name resolves by name", async () => {
    const res = await api(`/api/tasks/${encodeURIComponent(taskName)}`);
    expect(res.status).toBe(200);
    const task = await res.json() as Record<string, unknown>;
    expect(task["id"]).toBe(taskId);
  });

  it("PUT /api/tasks/:id updates the task", async () => {
    const res = await api(`/api/tasks/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Updated description" }),
    });
    expect(res.status).toBe(200);
    const task = await res.json() as Record<string, unknown>;
    expect(task["description"]).toBe("Updated description");
  });

  it("DELETE /api/tasks/:id removes the task", async () => {
    const res = await api(`/api/tasks/${taskId}`, { method: "DELETE" });
    expect(res.status).toBe(200);
  });

  it("GET /api/tasks/:id returns 404 after deletion", async () => {
    const res = await api(`/api/tasks/${taskId}`);
    expect(res.status).toBe(404);
  });
});
