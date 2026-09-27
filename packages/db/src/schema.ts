import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () =>
  uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  "users",
  {
    id: id(),
    githubId: text("github_id"),
    username: text("username").notNull(),
    name: text("name"),
    email: text("email"),
    avatarUrl: text("avatar_url"),
    isAdmin: boolean("is_admin").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("users_github_id_idx").on(t.githubId),
    uniqueIndex("users_username_idx").on(t.username),
  ],
);

export const sandboxStatus = pgEnum("sandbox_status", [
  "creating",
  "running",
  "suspended",
  "waking",
  "terminated",
  "error",
]);

export const projects = pgTable(
  "projects",
  {
    id: id(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    visibility: text("visibility", { enum: ["private", "shared"] })
      .notNull()
      .default("private"),
    thumbnailKey: text("thumbnail_key"),
    /** Tensorlake hosted Git repo holding this project's history. */
    gitRepo: text("git_repo"),
    /** Set on remixes/duplicates. */
    remixedFrom: uuid("remixed_from"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("projects_owner_idx").on(t.ownerId, t.updatedAt)],
);

export const sandboxes = pgTable(
  "sandboxes",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tensorlakeId: text("tensorlake_id").notNull(),
    role: text("role", { enum: ["main", "variant", "eval"] })
      .notNull()
      .default("main"),
    status: sandboxStatus("status").notNull().default("creating"),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index("sandboxes_project_idx").on(t.projectId, t.role),
    uniqueIndex("sandboxes_tl_idx").on(t.tensorlakeId),
  ],
);

export const runStatus = pgEnum("run_status", ["queued", "running", "succeeded", "failed", "cancelled"]);

export const runs = pgTable(
  "runs",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["turn", "variant", "eval"] })
      .notNull()
      .default("turn"),
    status: runStatus("status").notNull().default("queued"),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6, mode: "number" }).notNull().default(0),
    healRounds: integer("heal_rounds").notNull().default(0),
    summary: text("summary"),
    suggestions: jsonb("suggestions").$type<string[]>().notNull().default([]),
    changedFiles: jsonb("changed_files").$type<string[]>().notNull().default([]),
    error: text("error"),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("runs_project_idx").on(t.projectId, t.createdAt)],
);

/**
 * Append-only event log per project: agent steps, streamed text, sandbox
 * status. The global `id` orders events, so the SSE endpoint can resume from
 * "the last id I saw" after a refresh.
 */
export const runEvents = pgTable(
  "run_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("run_events_project_idx").on(t.projectId, t.id),
    index("run_events_run_idx").on(t.runId, t.id),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("messages_project_idx").on(t.projectId, t.createdAt)],
);

export const browserErrors = pgTable(
  "browser_errors",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    stack: text("stack"),
    url: text("url"),
    createdAt: createdAt(),
  },
  (t) => [index("browser_errors_project_idx").on(t.projectId, t.createdAt)],
);

/** One git commit in the sandbox = one version. Numbers are per project. */
export const versions = pgTable(
  "versions",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    commitSha: text("commit_sha").notNull(),
    source: text("source", { enum: ["agent", "manual", "restore", "variant"] }).notNull(),
    title: text("title").notNull(),
    changedFiles: jsonb("changed_files").$type<string[]>().notNull().default([]),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    restoredFrom: integer("restored_from"),
    screenshotKey: text("screenshot_key"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("versions_project_number_idx").on(t.projectId, t.number),
    uniqueIndex("versions_run_idx").on(t.runId),
  ],
);

/** Tensorlake PTY sessions, kept so a terminal can reattach after a refresh. */
export const ptySessions = pgTable("pty_sessions", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  sandboxId: text("sandbox_id").notNull(),
  sessionId: text("session_id").notNull(),
  token: text("token").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A project's static build on S3, served by the gateway on its own origin. */
export const publishedSites = pgTable("published_sites", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  slug: text("slug").notNull().unique(),
  versionId: uuid("version_id").references(() => versions.id, { onDelete: "set null" }),
  s3Prefix: text("s3_prefix").notNull(),
  fileCount: integer("file_count").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Version = typeof versions.$inferSelect;
export type PublishedSite = typeof publishedSites.$inferSelect;
export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Sandbox = typeof sandboxes.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type RunEvent = typeof runEvents.$inferSelect;
export type Message = typeof messages.$inferSelect;
