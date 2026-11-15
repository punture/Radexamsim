import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { assertSafeKey, StorageNotFound, type Bucket, type ObjectStorage } from "./core";

/**
 * Serves reads from read-only local directories when the primary storage has no such object.
 * Used for the committed development fixture media (labelled placeholders), which are never
 * uploaded to a bucket. Writes and deletes always go to the primary storage.
 */
export class ReadOnlyFallbackStorage implements ObjectStorage {
  readonly driver: string;
  constructor(private readonly primary: ObjectStorage, private readonly fallbacks: Partial<Record<Bucket, string>>) {
    this.driver = primary.driver;
    if (primary.selfCheck) this.selfCheck = () => primary.selfCheck!();
  }
  selfCheck?: ObjectStorage["selfCheck"];

  private async local(bucket: Bucket, key: string): Promise<string | null> {
    const dir = this.fallbacks[bucket];
    if (!dir) return null;
    assertSafeKey(key);
    const base = path.resolve(dir);
    const p = path.resolve(base, key);
    if (!p.startsWith(base + path.sep)) return null;
    try {
      return (await stat(p)).isFile() ? p : null;
    } catch {
      return null;
    }
  }

  put(bucket: Bucket, key: string, data: Uint8Array, contentType: string): Promise<void> {
    return this.primary.put(bucket, key, data, contentType);
  }
  async get(bucket: Bucket, key: string): Promise<Uint8Array> {
    try {
      return await this.primary.get(bucket, key);
    } catch (e) {
      const p = e instanceof StorageNotFound ? await this.local(bucket, key) : null;
      if (!p) throw e;
      return readFile(p);
    }
  }
  async stream(bucket: Bucket, key: string): Promise<{ stream: Readable; size: number }> {
    try {
      return await this.primary.stream(bucket, key);
    } catch (e) {
      const p = e instanceof StorageNotFound ? await this.local(bucket, key) : null;
      if (!p) throw e;
      return { stream: createReadStream(p), size: (await stat(p)).size };
    }
  }
  async exists(bucket: Bucket, key: string): Promise<boolean> {
    return (await this.primary.exists(bucket, key)) || (await this.local(bucket, key)) !== null;
  }
  delete(bucket: Bucket, key: string): Promise<void> {
    return this.primary.delete(bucket, key);
  }
}
