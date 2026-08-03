/**
 * In-memory store for long-running video generation jobs.
 * Entries auto-expire after 30 minutes to prevent memory leaks.
 */

export type VideoJobStatus = 'pending' | 'running' | 'done' | 'error';

export interface VideoJobRecord {
  jobId: string;
  status: VideoJobStatus;
  result?: { videoUrl: string; state: string; gender: string };
  error?: string;
  createdAt: number;
}

const JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes

export class VideoJobStore {
  private jobs = new Map<string, VideoJobRecord>();

  create(jobId: string): VideoJobRecord {
    const record: VideoJobRecord = {
      jobId,
      status: 'pending',
      createdAt: Date.now(),
    };
    this.jobs.set(jobId, record);
    this.evictExpired();
    return record;
  }

  get(jobId: string): VideoJobRecord | undefined {
    return this.jobs.get(jobId);
  }

  setRunning(jobId: string): void {
    const record = this.jobs.get(jobId);
    if (record) record.status = 'running';
  }

  setDone(jobId: string, videoUrl: string, state: string, gender: string): void {
    const record = this.jobs.get(jobId);
    if (record) {
      record.status = 'done';
      record.result = { videoUrl, state, gender };
    }
  }

  setError(jobId: string, error: string): void {
    const record = this.jobs.get(jobId);
    if (record) {
      record.status = 'error';
      record.error = error;
    }
  }

  private evictExpired(): void {
    const now = Date.now();
    this.jobs.forEach((record, id) => {
      if (now - record.createdAt > JOB_TTL_MS) {
        this.jobs.delete(id);
      }
    });
  }
}

export const videoJobStore = new VideoJobStore();
