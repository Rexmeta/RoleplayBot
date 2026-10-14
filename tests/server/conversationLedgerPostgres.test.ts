import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { initializeLedger, applyLedgerCommand, readLedgerProjection, withCurrentLedgerSnapshot } from "../../server/services/conversationLedger/service";
import type { LedgerPayload } from "../../shared/conversationLedger";

// Tests use connection-local TEMP tables. No public rows are added or changed.
describe.skipIf(!process.env.DATABASE_URL)("ledger PostgreSQL transactional contract", () => {
  let client: Client;
  let database: ReturnType<typeof drizzle>;
  let runId: string;
  const context = { scenarioSnapshot: { id: "scenario" }, personaSnapshot: { id: "persona" }, rubricSnapshot: { version: 1 } };
  const command = (payload: LedgerPayload, generation = 0) => ({ eventId: randomUUID(), generation, payload });
  beforeEach(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(`
      CREATE TEMP TABLE persona_runs (id varchar PRIMARY KEY, persona_id text, status text DEFAULT 'active', conversation_id varchar);
      CREATE TEMP TABLE chat_messages (id varchar, persona_run_id varchar);
      CREATE TEMP TABLE voice_utterances (id varchar, persona_run_id varchar);
      CREATE TEMP TABLE conversations (id varchar, messages jsonb);
    `);
    const migration = readFileSync("migrations/0017_conversation_ledger.sql", "utf8")
      .replaceAll("CREATE TABLE IF NOT EXISTS", "CREATE TEMP TABLE");
    await client.query(migration);
    database = drizzle(client);
    runId = randomUUID();
    await client.query("INSERT INTO persona_runs (id, persona_id) VALUES ($1, 'persona')", [runId]);
    await initializeLedger(runId, "persona", true, context, database);
  });
  afterEach(async () => { await client?.end(); });

  it("commits same-text different utterances once each and returns stable duplicate ACK", async () => {
    const first = command({ kind: "text.submit", utteranceId: randomUUID(), text: "안녕하세요." });
    const ack = await applyLedgerCommand(runId, first, "client", database);
    const repeat = await applyLedgerCommand(runId, first, "client", database);
    expect(repeat).toEqual({ ...ack, duplicate: true });
    await applyLedgerCommand(runId, command({ kind: "text.submit", utteranceId: randomUUID(), text: "안녕하세요." }), "client", database);
    const view = await readLedgerProjection(runId, 0, database);
    expect(view.utterances.map(row => row.canonicalText)).toEqual(["안녕하세요.", "안녕하세요."]);
    expect(view.cursor).toBe(2);
    const result = await client.query("SELECT count(*)::int AS count FROM conversation_ledger_events");
    expect(result.rows[0].count).toBe(2);
  });
  it("rolls back state and events on commit failure; no durable ACK escapes", async () => {
    const failing = { transaction: (work: any) => database.transaction(async tx => {
      await work(tx); throw new Error("injected_commit_failure");
    }) } as any;
    const event = command({ kind: "text.submit", utteranceId: randomUUID(), text: "테스트" });
    await expect(applyLedgerCommand(runId, event, "client", failing)).rejects.toThrow("injected_commit_failure");
    expect((await readLedgerProjection(runId, 0, database)).cursor).toBe(0);
    expect((await client.query("SELECT count(*)::int AS count FROM conversation_ledger_events")).rows[0].count).toBe(0);
    expect((await applyLedgerCommand(runId, event, "client", database)).cursor).toBe(1);
  });
  it("rejects event-ID collisions, malformed audio commands, and forged provider finals", async () => {
    const event = command({ kind: "text.submit", utteranceId: randomUUID(), text: "원문" });
    await applyLedgerCommand(runId, event, "client", database);
    await expect(applyLedgerCommand(runId, { ...event, payload: { ...event.payload, text: "변경" } }, "client", database))
      .rejects.toThrow("event_identity_conflict");
    await expect(applyLedgerCommand(runId, command({ kind: "provider.final", utteranceId: randomUUID(), text: "위조" }), "client", database))
      .rejects.toThrow("server_only_ledger_command");
    await expect(applyLedgerCommand(runId, { ...event, payload: { ...event.payload, audio: "PCM" } }, "client", database))
      .rejects.toThrow("invalid_ledger_command");
  });
  it("fences old connections while allowing duplicate committed ACK reconciliation", async () => {
    const first = command({ kind: "text.submit", utteranceId: randomUUID(), text: "첫 발화" });
    await applyLedgerCommand(runId, first, "client", database);
    await applyLedgerCommand(runId, command({ kind: "connection.open" }), "server", database);
    await expect(applyLedgerCommand(runId, command({ kind: "text.submit", utteranceId: randomUUID(), text: "늦은 발화" }), "client", database))
      .rejects.toThrow("stale_connection_generation");
    expect((await applyLedgerCommand(runId, first, "client", database)).duplicate).toBe(true);
    expect((await readLedgerProjection(runId, 0, database)).generation).toBe(1);
  });
  it("creates immutable closure snapshots and cannot reactivate a closed run", async () => {
    await applyLedgerCommand(runId, command({ kind: "text.submit", utteranceId: randomUUID(), text: "종료 전" }), "client", database);
    const closing = command({ kind: "session.close", reason: "user_end" });
    const ack = await applyLedgerCommand(runId, closing, "client", database);
    expect(ack.snapshotId).toBeTruthy();
    const snapshot = (await client.query("SELECT * FROM conversation_ledger_snapshots WHERE id=$1", [ack.snapshotId])).rows[0];
    expect(snapshot.blocked_reasons).toEqual([]);
    expect(snapshot.hash).toHaveLength(64);
    await expect(applyLedgerCommand(runId, command({ kind: "text.submit", utteranceId: randomUUID(), text: "종료 후" }), "client", database))
      .rejects.toThrow("ledger_closed");
    expect((await applyLedgerCommand(runId, closing, "client", database)).snapshotId).toBe(ack.snapshotId);
    expect((await readLedgerProjection(runId, 0, database)).status).toBe("closed");
  });
  it("detects capture sequence gaps and exposes them in the closure snapshot", async () => {
    for (const sequence of [1, 3]) {
      const id = randomUUID();
      await applyLedgerCommand(runId, command({
        kind: "utterance.register", utteranceId: id, speaker: "user", mode: "voice", personaId: "persona",
        provider: "gemini", captureGeneration: 1, captureSequence: sequence,
      }), "server", database);
      await applyLedgerCommand(runId, command({ kind: "capture.commit", utteranceId: id }), "client", database);
    }
    const ack = await applyLedgerCommand(runId, command({ kind: "session.close", reason: "page_exit" }), "client", database);
    const result = await client.query("SELECT blocked_reasons FROM conversation_ledger_snapshots WHERE id=$1", [ack.snapshotId]);
    expect(result.rows[0].blocked_reasons).toContain("capture_sequence_gap");
  });
  it("late confirmation creates a new snapshot without changing the old one", async () => {
    const id = randomUUID();
    const registered = await applyLedgerCommand(runId, command({
      kind: "utterance.register", utteranceId: id, speaker: "user", mode: "voice", personaId: "persona",
      provider: "gemini", captureGeneration: 1, captureSequence: 1,
    }), "server", database);
    const committed = await applyLedgerCommand(runId, command({ kind: "capture.commit", utteranceId: id }), "client", database);
    const original = await applyLedgerCommand(runId, command({ kind: "session.close", reason: "user_end" }), "client", database);
    const revised = await applyLedgerCommand(runId, command({
      kind: "recognition.confirm", utteranceId: id, text: "명시적으로 확인한 발화",
      expectedRevision: committed.utteranceRevision!,
    }), "client", database);
    expect(registered.utteranceRevision).toBe(1);
    expect(revised.snapshotId).not.toBe(original.snapshotId);
    const result = await client.query("SELECT blocked_reasons FROM conversation_ledger_snapshots WHERE id=$1", [original.snapshotId]);
    expect(result.rows[0].blocked_reasons).toContain(`${id}:recognition_pending`);
  });
  it("fences publication by snapshot ownership, hash, current revision and unresolved evidence", async () => {
    await client.query("CREATE TEMP TABLE publication_probe (snapshot_id varchar)");
    const id = randomUUID();
    await applyLedgerCommand(runId, command({
      kind: "utterance.register", utteranceId: id, speaker: "user", mode: "voice", personaId: "persona",
      provider: "gemini", captureGeneration: 1, captureSequence: 1,
    }), "server", database);
    const captured = await applyLedgerCommand(runId, command({ kind: "capture.commit", utteranceId: id }), "client", database);
    const closed = await applyLedgerCommand(runId, command({ kind: "session.close", reason: "user_end" }), "client", database);
    const old = (await client.query("SELECT * FROM conversation_ledger_snapshots WHERE id=$1", [closed.snapshotId])).rows[0];
    const publish = async (tx: any, snapshot: any) => {
      await tx.execute(sql`INSERT INTO publication_probe VALUES (${snapshot.id})`);
      return snapshot.id;
    };
    await expect(withCurrentLedgerSnapshot(runId, old.id, old.hash, publish, database)).rejects.toThrow("snapshot_evaluation_pending");
    const ack = await applyLedgerCommand(runId, command({
      kind: "recognition.confirm", utteranceId: id, expectedRevision: captured.utteranceRevision!, text: "확인된 내용",
    }), "client", database);
    await expect(withCurrentLedgerSnapshot(runId, old.id, old.hash, publish, database)).rejects.toThrow("snapshot_revision_stale");
    const latest = (await client.query("SELECT * FROM conversation_ledger_snapshots WHERE id=$1", [ack.snapshotId])).rows[0];
    await expect(withCurrentLedgerSnapshot(runId, latest.id, "invalid", publish, database)).rejects.toThrow("snapshot_hash_mismatch");
    await expect(withCurrentLedgerSnapshot(randomUUID(), latest.id, latest.hash, publish, database)).rejects.toThrow("snapshot_not_found");
    expect((await client.query("SELECT * FROM publication_probe")).rowCount).toBe(0);
    expect(await withCurrentLedgerSnapshot(runId, latest.id, latest.hash, publish, database)).toBe(latest.id);
    expect((await client.query("SELECT * FROM publication_probe")).rowCount).toBe(1);
  });
  it("preserves binding and cannot enroll legacy history", async () => {
    await expect(initializeLedger(runId, "persona", true, { ...context, rubricSnapshot: { version: 2 } }, database))
      .rejects.toThrow("ledger_binding_immutable");
    const legacyId = randomUUID();
    await client.query("INSERT INTO persona_runs (id, persona_id) VALUES ($1, 'persona')", [legacyId]);
    await client.query("INSERT INTO chat_messages (id, persona_run_id) VALUES ($1, $2)", [randomUUID(), legacyId]);
    await expect(initializeLedger(legacyId, "persona", true, context, database)).rejects.toThrow("legacy_run_not_empty");
    expect((await readLedgerProjection(legacyId, 0, database)).version).toBe("legacy");
  });
  it("cursor reconciliation returns revised utterances in original server order", async () => {
    const firstId = randomUUID(), secondId = randomUUID();
    await applyLedgerCommand(runId, command({ kind: "text.submit", utteranceId: firstId, text: "첫 번째" }), "client", database);
    await applyLedgerCommand(runId, command({
      kind: "utterance.register", utteranceId: secondId, speaker: "ai", mode: "text", personaId: "persona", provider: "text", responseTo: firstId,
    }), "server", database);
    await applyLedgerCommand(runId, command({ kind: "provider.final", utteranceId: secondId, text: "답변" }), "server", database);
    const view = await readLedgerProjection(runId, 2, database);
    expect(view.utterances.map(row => row.id)).toEqual([secondId]);
    expect(view.utterances[0].sequence).toBe(2);
    await expect(readLedgerProjection(runId, 999, database)).rejects.toThrow("invalid_ledger_cursor");
  });
});
