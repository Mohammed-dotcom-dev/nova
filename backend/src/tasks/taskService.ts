import { NovaDb } from "../db/supabaseClient.js";

export type TaskStatus =
  | "queued"
  | "planning"
  | "running"
  | "waiting"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  queued: ["planning", "cancelled"],
  planning: ["running", "failed", "cancelled"],
  running: ["waiting", "completed", "failed", "cancelled", "paused"],
  waiting: ["running", "cancelled"],
  paused: ["running", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export class TaskService {
  async create(db: NovaDb, userId: string, goal: string) {
    const { data, error } = await db
      .from("tasks")
      .insert({ user_id: userId, goal, status: "queued" })
      .select("*")
      .single();
    if (error) throw new Error(`Failed to create task: ${error.message}`);
    return data;
  }

  async transition(db: NovaDb, taskId: string, to: TaskStatus, patch: Record<string, unknown> = {}) {
    const { data: current, error: fetchError } = await db
      .from("tasks")
      .select("status")
      .eq("id", taskId)
      .single();
    if (fetchError || !current) throw new Error("Task not found");

    const from = current.status as TaskStatus;
    if (!VALID_TRANSITIONS[from].includes(to)) {
      throw new Error(`Invalid task transition: ${from} -> ${to}`);
    }

    const { error } = await db
      .from("tasks")
      .update({ status: to, updated_at: new Date().toISOString(), ...patch })
      .eq("id", taskId);
    if (error) throw new Error(`Failed to transition task: ${error.message}`);
  }

  async addStep(
    db: NovaDb,
    taskId: string,
    stepIndex: number,
    description: string,
    toolName?: string
  ) {
    const { error } = await db.from("task_steps").insert({
      task_id: taskId,
      step_index: stepIndex,
      description,
      tool_name: toolName ?? null,
      status: "pending",
    });
    if (error) throw new Error(`Failed to add task step: ${error.message}`);
  }

  async updateStep(
    db: NovaDb,
    taskId: string,
    stepIndex: number,
    patch: { status: string; toolInput?: unknown; toolResult?: unknown }
  ) {
    const { error } = await db
      .from("task_steps")
      .update({
        status: patch.status,
        tool_input: patch.toolInput ?? null,
        tool_result: patch.toolResult ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("task_id", taskId)
      .eq("step_index", stepIndex);
    if (error) throw new Error(`Failed to update task step: ${error.message}`);
  }
}
