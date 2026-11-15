import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { assertSafeKey, StorageNotFound, type Bucket, type ObjectStorage } from "./core";

export class LocalFsStorage implements ObjectStorage {
  readonly driver = "local-fs";
  constructor(private readonly root: string, private readonly readOnlyFallbacks: Partial<Record<Bucket, string>> = {}) {}

  private file(bucket: Bucket, key: string, base = this.root): string {
    assertSafeKey(key);
    const dir = path.resolve(base, bucket);
    const p = path.resolve(dir, key);
    if (!p.startsWith(dir + path.sep)) throw new Error("invalid storage key");
    return p;
  }

  /** Resolve a key, falling back to a read-only directory (used for committed dev fixtures). */
  private async resolveExisting(bucket: Bucket, key: string): Promise<string | null> {
    const primary = this.file(bucket, key);
    if (await exists(primary)) return primary;
    const fb = this.readOnlyFallbacks[bucket];
    if (fb) {
      assertSafeKey(key);
      const p = path.resolve(fb, key);
      if (p.startsWith(path.resolve(fb) + path.sep) && (await exists(p))) return p;
    }
    return null;
  }

  async put(bucket: Bucket, key: string, data: Uint8Array): Promise<void> {
    const p = this.file(bucket, key);
    await mkdir(path.dirname(p), { recursive: true, mode: 0o700 });
    await writeFile(p, data, { mode: 0o600 });
  }
  async get(bucket: Bucket, key: string): Promise<Uint8Array> {
    const p = await this.resolveExisting(bucket, key);
    if (!p) throw new StorageNotFound(bucket, key);
    return readFile(p);
  }
  async stream(bucket: Bucket, key: string): Promise<{ stream: Readable; size: number }> {
    const p = await this.resolveExisting(bucket, key);
    if (!p) throw new StorageNotFound(bucket, key);
    const s = await stat(p);
    return { stream: createReadStream(p), size: s.size };
  }
  async exists(bucket: Bucket, key: string): Promise<boolean> {
    return (await this.resolveExisting(bucket, key)) !== null;
  }
  async delete(bucket: Bucket, key: string): Promise<void> {
    await rm(this.file(bucket, key), { force: true });
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * In-memory storage for tests. Supports fault injection so tests can simulate a failed
 * asset load (technical failure, not candidate error).
 */
export class MemoryStorage implements ObjectStorage {
  readonly driver = "memory";
  private readonly objects = new Map<string, Uint8Array>();
  readonly failingKeys = new Set<string>();
  async put(bucket: Bucket, key: string, data: Uint8Array): Promise<void> {
    assertSafeKey(key);
    this.objects.set(`${bucket}/${key}`, data);
  }
  async get(bucket: Bucket, key: string): Promise<Uint8Array> {
    if (this.failingKeys.has(key)) throw new Error("simulated storage failure");
    const v = this.objects.get(`${bucket}/${key}`);
    if (!v) throw new StorageNotFound(bucket, key);
    return v;
  }
  async stream(bucket: Bucket, key: string): Promise<{ stream: Readable; size: number }> {
    const { Readable } = await import("node:stream");
    const data = await this.get(bucket, key);
    return { stream: Readable.from([Buffer.from(data)]), size: data.length };
  }
  async exists(bucket: Bucket, key: string): Promise<boolean> {
    return this.objects.has(`${bucket}/${key}`);
  }
  async delete(bucket: Bucket, key: string): Promise<void> {
    this.objects.delete(`${bucket}/${key}`);
  }
}
