import type { Tool } from "./tools/index.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getCheckpointsDir } from "./config.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = "pending" | "in_progress" | "done" | "blocked" | "failed";

export interface TodoItem {
  id: string;
  description: string;
  status: TaskStatus;
  dependencies?: string[];
  notes?: string;
}

export interface CheckpointSnapshot {
  planGoal: string;
  tasks: TodoItem[];
  checkpointNotes: string[];
}

// ---------------------------------------------------------------------------
// TaskPlanner
// ---------------------------------------------------------------------------

/**
 * Manages a task plan with checkpoints for long-running agent tasks.
 * Supports serialization/deserialization for session resume (B4).
 */
export class TaskPlanner {
  private planGoal = "";
  private tasks: TodoItem[] = [];
  private checkpointNotes: string[] = [];
  private dirty = false;

  /** Create a new task plan with a goal and task list. Clears any existing plan. */
  createPlan(goal: string, items: TodoItem[]): { result: string } {
    this.planGoal = goal;
    this.tasks = items.map((t) => ({ ...t }));
    this.checkpointNotes = [];
    this.dirty = true;
    return {
      result: `Plan created: "${goal}" with ${items.length} tasks.\n${this.formatPlan()}`,
    };
  }

  /** Get the full plan (goal + all tasks). */
  getPlan(): { goal: string; tasks: TodoItem[] } {
    return { goal: this.planGoal, tasks: [...this.tasks] };
  }

  /** Get a Markdown summary for prompt injection. Returns empty string if no plan. */
  getSummary(): string {
    if (!this.planGoal) return "";
    const lines: string[] = [
      `## Current Task Plan\nGoal: ${this.planGoal}\n`,
    ];
    for (const t of this.tasks) {
      const depInfo =
        t.dependencies && t.dependencies.length > 0
          ? ` (depends on: ${t.dependencies.join(", ")})`
          : "";
      const noteInfo = t.notes ? ` — ${t.notes}` : "";
      const check = t.status === "done" ? "[✓]" : "[ ]";
      lines.push(
        `- ${check} **${t.id}**: ${t.description} (${t.status})${depInfo}${noteInfo}`,
      );
    }
    if (this.checkpointNotes.length > 0) {
      lines.push("\n### Checkpoints / Notes");
      for (const n of this.checkpointNotes) {
        lines.push(`- ${n}`);
      }
    }
    return lines.join("\n");
  }

  /** Update an existing task's status and/or notes. */
  updateTask(
    id: string,
    updates: { status?: TaskStatus; notes?: string },
  ): { result: string; isError?: boolean } {
    const idx = this.tasks.findIndex((t) => t.id === id);
    if (idx === -1) {
      return { result: `Error: task "${id}" not found.`, isError: true };
    }
    const task = this.tasks[idx];
    if (updates.status) task.status = updates.status;
    if (updates.notes !== undefined) task.notes = updates.notes;
    this.dirty = true;
    return {
      result: `Task "${id}" updated: status=${task.status}${updates.notes ? `, notes="${updates.notes}"` : ""}`,
    };
  }

  /** Convenience: mark a task as done. */
  markDone(id: string, notes?: string): { result: string; isError?: boolean } {
    return this.updateTask(id, { status: "done", notes });
  }

  /** Add a checkpoint note for later reference / resume. */
  addCheckpoint(note: string): { result: string } {
    this.checkpointNotes.push(note);
    this.dirty = true;
    return { result: `Checkpoint added: ${note}` };
  }

  // -----------------------------------------------------------------------
  // Persistence — supports session resume (B4)
  // -----------------------------------------------------------------------

  /** Serialize the current plan state to a JSON snapshot. */
  toJSON(): CheckpointSnapshot {
    return {
      planGoal: this.planGoal,
      tasks: this.tasks.map((t) => ({ ...t })),
      checkpointNotes: [...this.checkpointNotes],
    };
  }

  /** Restore plan state from a JSON snapshot. */
  fromJSON(snapshot: CheckpointSnapshot): void {
    this.planGoal = snapshot.planGoal;
    this.tasks = snapshot.tasks.map((t) => ({ ...t }));
    this.checkpointNotes = [...snapshot.checkpointNotes];
    this.dirty = false;
  }

  /** Save the plan state to disk: `~/.spark/checkpoints/<sessionId>.json`. */
  save(sessionId: string): void {
    if (!this.dirty && !this.planGoal) return;
    try {
      const dir = getCheckpointsDir();
      const file = join(dir, `${sessionId}.json`);
      writeFileSync(file, JSON.stringify(this.toJSON(), null, 2), "utf-8");
      this.dirty = false;
    } catch (err) {
      logger.warn(
        `Failed to save checkpoint: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Load the plan state from disk. Returns true if a checkpoint was found. */
  load(sessionId: string): boolean {
    try {
      const dir = getCheckpointsDir();
      const file = join(dir, `${sessionId}.json`);
      if (!existsSync(file)) return false;
      const raw = readFileSync(file, "utf-8");
      const snapshot = JSON.parse(raw) as CheckpointSnapshot;
      this.fromJSON(snapshot);
      return true;
    } catch (err) {
      logger.warn(
        `Failed to load checkpoint: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private formatPlan(): string {
    const lines: string[] = [];
    for (const t of this.tasks) {
      const depInfo =
        t.dependencies && t.dependencies.length > 0
          ? ` [depends: ${t.dependencies.join(", ")}]`
          : "";
      lines.push(`  [${t.status}] ${t.id}: ${t.description}${depInfo}`);
    }
    return lines.join("\n");
  }
}

// ---------------------------------------------------------------------------
// TODO tools — registered as LLM-callable tools
// ---------------------------------------------------------------------------

export function createTodoTools(planner: TaskPlanner): Tool[] {
  return [
    {
      name: "todo_create_plan",
      description:
        "Create a task plan with a goal and subtasks. Use this at the start of a complex task to break it down into manageable steps.",
      parameters: {
        goal: {
          type: "string",
          description: "The overall goal of the plan",
        },
        tasks: {
          type: "array",
          description: "List of tasks to accomplish the goal",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "Unique task identifier (e.g., T1, T2)",
              },
              description: {
                type: "string",
                description: "What this task entails",
              },
              dependencies: {
                type: "array",
                items: { type: "string" },
                description:
                  "Task IDs this depends on (optional; leave out for no deps)",
              },
            },
          },
        },
      },
      required: ["goal", "tasks"],
      execute: async (args) => {
        const { goal, tasks } = args as {
          goal: string;
          tasks: Array<{
            id: string;
            description: string;
            dependencies?: string[];
          }>;
        };
        const items: TodoItem[] = tasks.map((t) => ({
          id: t.id,
          description: t.description,
          status: "pending" as TaskStatus,
          dependencies: t.dependencies,
        }));
        return planner.createPlan(goal, items).result;
      },
    },
    {
      name: "todo_get_list",
      description:
        "Get the current task plan with all tasks and their status. Use this to review progress at any point.",
      parameters: {},
      execute: async () => planner.getSummary(),
    },
    {
      name: "todo_update",
      description:
        "Update a task's status and/or notes. Use this to mark progress, add notes, or change task state.",
      parameters: {
        id: {
          type: "string",
          description: "Task ID to update (e.g., T1, T2)",
        },
        status: {
          type: "string",
          description: "New status",
          enum: ["pending", "in_progress", "done", "blocked", "failed"],
        },
        notes: {
          type: "string",
          description: "Optional notes about progress",
        },
      },
      required: ["id"],
      execute: async (args) => {
        const { id, status, notes } = args as {
          id: string;
          status?: TaskStatus;
          notes?: string;
        };
        const r = planner.updateTask(id, { status, notes });
        return r.result;
      },
    },
    {
      name: "todo_mark_done",
      description:
        "Mark a task as completed, optionally with completion notes.",
      parameters: {
        id: { type: "string", description: "Task ID to mark done" },
        notes: {
          type: "string",
          description: "Optional completion notes",
        },
      },
      required: ["id"],
      execute: async (args) => {
        const { id, notes } = args as { id: string; notes?: string };
        return planner.markDone(id, notes).result;
      },
    },
    {
      name: "todo_add_checkpoint",
      description:
        "Record a checkpoint or important note during task execution. Useful for resuming later or tracking key decisions.",
      parameters: {
        note: {
          type: "string",
          description: "The checkpoint note",
        },
      },
      required: ["note"],
      execute: async (args) => {
        const { note } = args as { note: string };
        return planner.addCheckpoint(note).result;
      },
    },
  ];
}
