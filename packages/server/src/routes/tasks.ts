// @baara-next/server — Task routes
//
// GET  /api/tasks            list (optional ?projectId)
// GET  /api/tasks/:id        get by id or name
// POST /api/tasks            create
// PUT  /api/tasks/:id        update
// DELETE /api/tasks/:id      delete
// POST /api/tasks/:id/toggle toggle enabled
// POST /api/tasks/:id/run    run direct (bypasses queue)
// POST /api/tasks/:id/submit submit to queue

import { Hono } from "hono";
import type { IOrchestratorService, IStore, CreateTaskInput, UpdateTaskInput } from "@baara-next/core";
import { TaskNotFoundError } from "@baara-next/core";
import { TaskManager } from "@baara-next/orchestrator";

export function taskRoutes(
  orchestrator: IOrchestratorService,
  store: IStore
): Hono {
  const taskManager = new TaskManager(store);
  const router = new Hono();

  // GET /api/tasks
  router.get("/", (c) => {
    const projectId = c.req.query("projectId");
    const tasks = store.listTasks(projectId);
    return c.json(tasks);
  });

  // GET /api/tasks/:id  (supports lookup by id or name)
  router.get("/:id", (c) => {
    const id = c.req.param("id");
    let task = store.getTask(id);
    if (!task) task = store.getTaskByName(id);
    if (!task) return c.json({ error: `Task not found: "${id}"` }, 404);
    return c.json(task);
  });

  // POST /api/tasks — create
  router.post("/", async (c) => {
    let body: CreateTaskInput;
    try {
      body = (await c.req.json()) as CreateTaskInput;
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.name || typeof body.name !== "string") {
      return c.json({ error: "name is required" }, 400);
    }
    if (!body.prompt || typeof body.prompt !== "string") {
      return c.json({ error: "prompt is required" }, 400);
    }

    try {
      const task = taskManager.createTask(body);
      return c.json(task, 201);
    } catch (err) {
      if (err instanceof Error && err.message.includes("already exists")) {
        return c.json({ error: err.message }, 409);
      }
      throw err;
    }
  });

  // PUT /api/tasks/:id — update
  router.put("/:id", async (c) => {
    const id = c.req.param("id");
    let body: UpdateTaskInput;
    try {
      body = (await c.req.json()) as UpdateTaskInput;
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    try {
      const task = taskManager.updateTask(id, body);
      return c.json(task);
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        return c.json({ error: err.message }, 404);
      }
      throw err;
    }
  });

  // DELETE /api/tasks/:id
  router.delete("/:id", (c) => {
    const id = c.req.param("id");
    try {
      store.deleteTask(id);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        return c.json({ error: err.message }, 404);
      }
      throw err;
    }
  });

  // POST /api/tasks/:id/toggle — toggle enabled/disabled
  router.post("/:id/toggle", (c) => {
    const id = c.req.param("id");
    const task = store.getTask(id);
    if (!task) return c.json({ error: `Task not found: "${id}"` }, 404);

    const updated = store.updateTask(id, { enabled: !task.enabled });
    return c.json(updated);
  });

  // POST /api/tasks/:id/run — run direct (bypasses queue)
  router.post("/:id/run", async (c) => {
    const id = c.req.param("id");
    try {
      const execution = await orchestrator.runDirect(id);
      return c.json(execution);
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        return c.json({ error: err.message }, 404);
      }
      throw err;
    }
  });

  // POST /api/tasks/:id/submit — submit to queue
  router.post("/:id/submit", async (c) => {
    const id = c.req.param("id");
    try {
      const execution = await orchestrator.submitTask(id);
      return c.json(execution, 201);
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        return c.json({ error: err.message }, 404);
      }
      throw err;
    }
  });

  return router;
}
