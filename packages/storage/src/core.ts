import type { Readable } from "node:stream";

/**
 * Buckets are separated by purpose:
 *  - quarantine:  untouched source material (restricted; never served to learners)
 *  - derivatives: approved examination derivatives (served only via authorized media routes)
 *  - recordings:  learner audio retained with explicit consent
 *  - exports:     learner data exports (short-lived)
 * A driver may map them to directories, key prefixes or separate buckets. None is public.
 */
export type Bucket = "quarantine" | "derivatives" | "recordings" | "exports";
export const BUCKETS: readonly Bucket[] = ["quarantine", "derivatives", "recordings", "exports"];

/** What a driver verified about itself at startup (see S3Storage.selfCheck). */
export type StorageSelfCheck = {
  driver: string;
  /** Each anonymous probe that was sent, its final HTTP status, and whether it exposed data. */
  anonymousProbes: { probe: string; status: number; exposed: boolean }[];
  encryption: "confirmed" | "requested_not_confirmed" | "provider_managed";
};

export interface ObjectStorage {
  readonly driver: string;
  put(bucket: Bucket, key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(bucket: Bucket, key: string): Promise<Uint8Array>;
  stream(bucket: Bucket, key: string): Promise<{ stream: Readable; size: number }>;
  exists(bucket: Bucket, key: string): Promise<boolean>;
  delete(bucket: Bucket, key: string): Promise<void>;
  /** Startup check for drivers that can be misconfigured remotely. Throws when unsafe. */
  selfCheck?(): Promise<StorageSelfCheck>;
}

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,511}$/;

export function assertSafeKey(key: string): void {
  if (!KEY_RE.test(key) || key.includes("..") || key.includes("//")) throw new Error("invalid storage key");
}

export class StorageNotFound extends Error {
  constructor(bucket: string, key: string) {
    super(`object not found: ${bucket}/${key}`);
    this.name = "StorageNotFound";
  }
}

/** The storage is reachable without credentials. The services refuse to start on it. */
export class StoragePublicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoragePublicError";
  }
}
