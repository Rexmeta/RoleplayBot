import { sql } from "drizzle-orm";
import { pgTable, varchar, integer, text, jsonb, boolean, timestamp, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";
import { personaRuns } from "./conversations";
import type { LedgerCommand, LedgerAck } from "../conversationLedger";

/** Presence fixes the protocol version for this run; existing runs remain legacy. */
export const conversationLedgerRuns = pgTable("conversation_ledger_runs", {
  personaRunId: varchar("persona_run_id").primaryKey().references(() => personaRuns.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  cursor: integer("cursor").notNull().default(0),
  generation: integer("generation").notNull().default(0),
  status: text("status").notNull().default("active"),
  recognitionRequired: boolean("recognition_required").notNull(),
  personaId: text("persona_id").notNull(),
  captureGeneration: integer("capture_generation"),
  captureSequence: integer("capture_sequence"),
  captureGaps: integer("capture_gaps").notNull().default(0),
  boundContext: jsonb("bound_context").notNull().$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const conversationLedgerUtterances = pgTable("conversation_ledger_utterances", {
  personaRunId: varchar("persona_run_id").notNull().references(() => conversationLedgerRuns.personaRunId, { onDelete: "cascade" }),
  id: varchar("id").notNull(),
  sequence: integer("sequence").notNull(),
  updatedSequence: integer("updated_sequence").notNull(),
  revision: integer("revision").notNull().default(1),
  generation: integer("generation").notNull(),
  speaker: text("speaker").notNull(),
  mode: text("mode").notNull(),
  personaId: text("persona_id").notNull(),
  responseTo: varchar("response_to"),
  provider: text("provider").notNull(),
  providerResponseId: varchar("provider_response_id"),
  providerEventId: varchar("provider_event_id"),
  captureGeneration: integer("capture_generation"),
  captureSequence: integer("capture_sequence"),
  captureState: text("capture_state").notNull(),
  captureReason: text("capture_reason"),
  providerState: text("provider_state").notNull(),
  recognitionState: text("recognition_state").notNull(),
  recognitionSource: text("recognition_source"),
  playbackState: text("playback_state").notNull(),
  providerText: text("provider_text").notNull().default(""),
  candidateText: text("candidate_text"),
  canonicalText: text("canonical_text"),
  reason: text("reason"),
  metadata: jsonb("metadata").notNull().default({}).$type<{
    emotion?: string; emotionReason?: string; userAffect?: Record<string, unknown>;
  }>(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  primaryKey({ columns: [table.personaRunId, table.id] }),
  uniqueIndex("ledger_utterance_sequence").on(table.personaRunId, table.sequence),
  uniqueIndex("ledger_provider_event").on(table.personaRunId, table.provider, table.providerEventId),
  uniqueIndex("ledger_provider_response").on(table.personaRunId, table.provider, table.providerResponseId),
]);

export const conversationLedgerEvents = pgTable("conversation_ledger_events", {
  personaRunId: varchar("persona_run_id").notNull().references(() => conversationLedgerRuns.personaRunId, { onDelete: "cascade" }),
  eventId: varchar("event_id").notNull(),
  sequence: integer("sequence").notNull(),
  payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
  command: jsonb("command").notNull().$type<LedgerCommand>(),
  ack: jsonb("ack").notNull().$type<LedgerAck>(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  primaryKey({ columns: [table.personaRunId, table.eventId] }),
  uniqueIndex("ledger_event_sequence").on(table.personaRunId, table.sequence),
]);

export const conversationLedgerSnapshots = pgTable("conversation_ledger_snapshots", {
  id: varchar("id").primaryKey(),
  personaRunId: varchar("persona_run_id").notNull().references(() => conversationLedgerRuns.personaRunId, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  hash: varchar("hash", { length: 64 }).notNull(),
  content: jsonb("content").notNull().$type<Record<string, unknown>>(),
  blockedReasons: jsonb("blocked_reasons").notNull().$type<string[]>(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [uniqueIndex("ledger_snapshot_revision").on(table.personaRunId, table.revision)]);

export type LedgerRun = typeof conversationLedgerRuns.$inferSelect;
export const conversationLedgerReports = pgTable("conversation_ledger_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  personaRunId: varchar("persona_run_id").notNull().references(() => personaRuns.id, { onDelete: "cascade" }),
  snapshotId: varchar("snapshot_id").notNull().references(() => conversationLedgerSnapshots.id, { onDelete: "cascade" }),
  payload: jsonb("payload").notNull().$type<Record<string, any>>(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [uniqueIndex("ledger_report_snapshot").on(table.personaRunId, table.snapshotId)]);
export type LedgerUtterance = typeof conversationLedgerUtterances.$inferSelect;
