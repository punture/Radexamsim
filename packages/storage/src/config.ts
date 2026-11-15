import path from "node:path";
import { z } from "zod";
import type { Bucket, ObjectStorage } from "./core";
import { ReadOnlyFallbackStorage } from "./fallback";
import { LocalFsStorage } from "./local";
import { S3Storage } from "./s3";

const bool = (d: boolean) => z.enum(["true", "false", "1", "0"]).default(d ? "true" : "false").transform((v) => v === "true" || v === "1");

/**
 * Storage settings, shared by the API and the worker (they must use the same values).
 * Documented in .env.example and docs/runbooks/STORAGE.md.
 */
export const StorageEnvSchema = z.object({
  STORAGE_DRIVER: z.enum(["local-fs", "s3"]).default("local-fs"),
  STORAGE_LOCAL_ROOT: z.string().default("./var/storage"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  S3_FORCE_PATH_STYLE: bool(false),
  S3_PREFIX: z.string().default(""),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_SSE: z.enum(["AES256", "aws:kms", "provider-managed"]).optional(),
  S3_SSE_KMS_KEY_ID: z.string().optional(),
  S3_CHECKSUMS: z.enum(["when_supported", "when_required"]).default("when_supported"),
});
export type StorageEnv = z.infer<typeof StorageEnvSchema>;

/** Rejects unsafe or incomplete storage settings. Call after parsing, with NODE_ENV. */
export function checkStorageEnv(env: StorageEnv, nodeEnv: string): void {
  if (env.STORAGE_DRIVER !== "s3") return;
  if (!env.S3_BUCKET) throw new Error("S3_BUCKET is required for STORAGE_DRIVER=s3");
  if (Boolean(env.S3_ACCESS_KEY_ID) !== Boolean(env.S3_SECRET_ACCESS_KEY)) throw new Error("set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither (to use the default AWS credential chain)");
  if (env.S3_SSE_KMS_KEY_ID && env.S3_SSE !== "aws:kms") throw new Error("S3_SSE_KMS_KEY_ID needs S3_SSE=aws:kms");
  if (nodeEnv === "production") {
    if (!env.S3_SSE) throw new Error("S3_SSE must be set explicitly in production: AES256, aws:kms or provider-managed (see docs/runbooks/STORAGE.md)");
    if (env.S3_ENDPOINT && !env.S3_ENDPOINT.startsWith("https://")) throw new Error("S3_ENDPOINT must use https in production");
  }
}

/**
 * Builds the configured storage. `readOnlyFallbacks` serves committed development fixture
 * media from local directories; it is empty unless fixtures are allowed.
 */
export function createStorage(env: StorageEnv, opts: { readOnlyFallbacks?: Partial<Record<Bucket, string>> } = {}): ObjectStorage {
  const fallbacks = opts.readOnlyFallbacks ?? {};
  if (env.STORAGE_DRIVER === "s3") {
    const s3 = new S3Storage({
      bucket: env.S3_BUCKET!,
      region: env.S3_REGION,
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      prefix: env.S3_PREFIX,
      ...(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY ? { credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } } : {}),
      sse: env.S3_SSE ?? "provider-managed",
      ...(env.S3_SSE_KMS_KEY_ID ? { kmsKeyId: env.S3_SSE_KMS_KEY_ID } : {}),
      checksums: env.S3_CHECKSUMS,
    });
    return Object.keys(fallbacks).length ? new ReadOnlyFallbackStorage(s3, fallbacks) : s3;
  }
  return new LocalFsStorage(path.resolve(env.STORAGE_LOCAL_ROOT), fallbacks);
}
