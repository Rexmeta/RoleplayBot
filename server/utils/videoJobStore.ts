/**
 * Store for long-running video generation jobs.
 * Primary storage: in-memory (fast); secondary: PostgreSQL (survives server restarts).
 * Entries auto-expire from memory after 30 minutes.
 */

import { pool } from '../storage/db';

export type VideoJobStatus = 'pending' | 'running' | 'done' | 'error';

export interface VideoJobRecord {
  jobId: string;
  personaId: string;
  clipState: string;
  gender: string;
  status: VideoJobStatus;
  result?: { videoUrl: string; state: string; gender: string; storageKey?: string; model?: string };
  error?: string;
  createdAt: number;
}

const JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes

export class VideoJobStore {
  private jobs = new Map<string, VideoJobRecord>();

  /** Register a new job in memory and fire-and-forget persist to DB. */
  create(jobId: string, personaId: string, clipState: string, gender: string): VideoJobRecord {
    const record: VideoJobRecord = {
      jobId,
      personaId,
      clipState,
      gender,
      status: 'pending',
      createdAt: Date.now(),
    };
    this.jobs.set(jobId, record);
    this.evictExpired();

    pool.query(
      `INSERT INTO video_generation_jobs
         (job_id, persona_id, clip_state, gender, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'pending', NOW(), NOW())
       ON CONFLICT (job_id) DO NOTHING`,
      [jobId, personaId, clipState, gender],
    ).catch(e => console.warn('[videoJobStore] DB create failed:', e.message));

    return record;
  }

  /**
   * Retrieve a job record.
   * Checks memory first; on miss falls back to DB.
   * Jobs that were still running when the server restarted are returned as 'error'.
   */
  async get(jobId: string): Promise<VideoJobRecord | undefined> {
    const mem = this.jobs.get(jobId);
    if (mem) return mem;

    try {
      const { rows } = await pool.query<{
        job_id: string; persona_id: string; clip_state: string; gender: string;
        status: string; result_data: any; error_message: string | null; created_at: Date;
      }>(
        'SELECT * FROM video_generation_jobs WHERE job_id = $1',
        [jobId],
      );
      if (!rows.length) return undefined;

      const row = rows[0];

      // Job was in-flight when server restarted → the Gemini operation is gone
      if (row.status === 'pending' || row.status === 'running') {
        return {
          jobId: row.job_id,
          personaId: row.persona_id,
          clipState: row.clip_state,
          gender: row.gender,
          status: 'error',
          error: '서버가 재시작되었습니다. 생성 버튼을 다시 눌러주세요.',
          createdAt: row.created_at.getTime(),
        };
      }

      return {
        jobId: row.job_id,
        personaId: row.persona_id,
        clipState: row.clip_state,
        gender: row.gender,
        status: row.status as VideoJobStatus,
        result: row.result_data ?? undefined,
        error: row.error_message ?? undefined,
        createdAt: row.created_at.getTime(),
      };
    } catch (e: any) {
      console.warn('[videoJobStore] DB get failed:', e.message);
      return undefined;
    }
  }

  setRunning(jobId: string): void {
    const record = this.jobs.get(jobId);
    if (record) record.status = 'running';

    pool.query(
      `UPDATE video_generation_jobs SET status = 'running', updated_at = NOW() WHERE job_id = $1`,
      [jobId],
    ).catch(e => console.warn('[videoJobStore] DB setRunning failed:', e.message));
  }

  setDone(jobId: string, videoUrl: string, state: string, gender: string, model?: string): void {
    const record = this.jobs.get(jobId);
    if (record) {
      record.status = 'done';
      record.result = { videoUrl, state, gender, ...(model ? { model } : {}) };
    }

    pool.query(
      `UPDATE video_generation_jobs
         SET status = 'done', result_data = $2::jsonb, updated_at = NOW()
       WHERE job_id = $1`,
      [jobId, JSON.stringify({ videoUrl, state, gender, ...(model ? { model } : {}) })],
    ).catch(e => console.warn('[videoJobStore] DB setDone failed:', e.message));
  }

  setError(jobId: string, error: string): void {
    const record = this.jobs.get(jobId);
    if (record) {
      record.status = 'error';
      record.error = error;
    }

    pool.query(
      `UPDATE video_generation_jobs
         SET status = 'error', error_message = $2, updated_at = NOW()
       WHERE job_id = $1`,
      [jobId, error],
    ).catch(e => console.warn('[videoJobStore] DB setError failed:', e.message));
  }

  private evictExpired(): void {
    const now = Date.now();
    this.jobs.forEach((record, id) => {
      if (now - record.createdAt > JOB_TTL_MS) this.jobs.delete(id);
    });
  }
}

export const videoJobStore = new VideoJobStore();
