import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ReadOnlyFallbackStorage, S3Storage, StorageEnvSchema, checkStorageEnv, createStorage, type S3StorageOptions } from "../src";

const env = (over: Record<string, string> = {}) => StorageEnvSchema.parse({ STORAGE_DRIVER: "s3", S3_BUCKET: "sim-media", ...over });
const s3 = (over: Partial<S3StorageOptions> = {}) => new S3Storage({ bucket: "sim-media", region: "eu-west-2", sse: "AES256", credentials: { accessKeyId: "test", secretAccessKey: "test" }, ...over });

describe("storage settings", () => {
  it("defaults to local storage and needs nothing else", () => {
    const e = StorageEnvSchema.parse({});
    expect(e.STORAGE_DRIVER).toBe("local-fs");
    expect(() => checkStorageEnv(e, "production")).not.toThrow();
    expect(createStorage(e).driver).toBe("local-fs");
  });

  it("rejects incomplete or unsafe S3 settings", () => {
    expect(() => checkStorageEnv(StorageEnvSchema.parse({ STORAGE_DRIVER: "s3" }), "development")).toThrow(/S3_BUCKET/);
    expect(() => checkStorageEnv(env({ S3_ACCESS_KEY_ID: "only-the-id" }), "development")).toThrow(/both/);
    expect(() => checkStorageEnv(env({ S3_SSE: "AES256", S3_SSE_KMS_KEY_ID: "key" }), "development")).toThrow(/aws:kms/);
    // Production: encryption must be an explicit decision, and a custom endpoint must use TLS.
    expect(() => checkStorageEnv(env(), "production")).toThrow(/S3_SSE must be set/);
    expect(() => checkStorageEnv(env({ S3_SSE: "AES256", S3_ENDPOINT: "http://minio.internal:9000" }), "production")).toThrow(/https/);
    expect(() => checkStorageEnv(env({ S3_SSE: "aws:kms", S3_SSE_KMS_KEY_ID: "arn:aws:kms:eu-west-2:111122223333:key/abc" }), "production")).not.toThrow();
    expect(() => StorageEnvSchema.parse({ S3_ENDPOINT: "ftp://example.org" })).toThrow();
  });

  it("builds the S3 driver, wrapping it for read-only fixture media when asked", () => {
    const plain = createStorage(env({ S3_SSE: "AES256" }));
    expect(plain).toBeInstanceOf(S3Storage);
    const fixtures = mkdtempSync(path.join(tmpdir(), "sim-fixture-media-"));
    const wrapped = createStorage(env({ S3_SSE: "AES256" }), { readOnlyFallbacks: { derivatives: fixtures } });
    expect(wrapped).toBeInstanceOf(ReadOnlyFallbackStorage);
    expect(wrapped.driver).toBe("s3");
    expect(typeof wrapped.selfCheck).toBe("function"); // the startup check still runs through the wrapper
  });
});

describe("S3 driver without a server", () => {
  it("validates the bucket name, prefix and KMS settings", () => {
    for (const bucket of ["UPPER", "a", "has_underscore", "-leading", "dots..double"]) expect(() => s3({ bucket })).toThrow(/bucket/);
    for (const prefix of ["no-slash", "/leading/", "a//b/", "../up/", "sp ace/"]) expect(() => s3({ prefix })).toThrow(/prefix/);
    expect(() => s3({ prefix: "staging/" })).not.toThrow();
    expect(() => s3({ sse: "AES256", kmsKeyId: "k" })).toThrow(/aws:kms/);
  });

  it("stores each logical bucket under its own prefix and rejects unsafe keys before any request", () => {
    const d = s3({ prefix: "staging/" });
    expect(d.objectKey("derivatives", "cases/c1/v1/abc.png")).toBe("staging/derivatives/cases/c1/v1/abc.png");
    expect(d.objectKey("exports", "u1/r1.json")).toBe("staging/exports/u1/r1.json");
    for (const k of ["../etc/passwd", "a/../../b", "/abs", "a//b", ""]) expect(() => d.objectKey("derivatives", k)).toThrow(/invalid storage key/);
  });

  it("sends the configured server-side encryption with every write", () => {
    expect(s3({ sse: "AES256" }).encryptionParams()).toEqual({ ServerSideEncryption: "AES256" });
    expect(s3({ sse: "aws:kms" }).encryptionParams()).toEqual({ ServerSideEncryption: "aws:kms" });
    expect(s3({ sse: "aws:kms", kmsKeyId: "arn:k" }).encryptionParams()).toEqual({ ServerSideEncryption: "aws:kms", SSEKMSKeyId: "arn:k" });
    expect(s3({ sse: "provider-managed" }).encryptionParams()).toEqual({});
  });

  it("probes the URLs an anonymous client would use, for each addressing style", () => {
    const key = "derivatives/_selfcheck/a b.txt";
    expect(s3().anonymousProbeUrls(key).map((p) => p.url)).toEqual([
      "https://sim-media.s3.eu-west-2.amazonaws.com/derivatives/_selfcheck/a%20b.txt",
      "https://sim-media.s3.eu-west-2.amazonaws.com/?list-type=2&prefix=derivatives%2F_selfcheck%2Fa%20b.txt&max-keys=1",
    ]);
    expect(s3({ bucket: "media.example.org" }).anonymousProbeUrls("k")[0]!.url).toBe("https://s3.eu-west-2.amazonaws.com/media.example.org/k");
    expect(s3({ endpoint: "http://127.0.0.1:9000", forcePathStyle: true }).anonymousProbeUrls("k").map((p) => p.url)).toEqual([
      "http://127.0.0.1:9000/sim-media/k",
      "http://127.0.0.1:9000/sim-media/?list-type=2&prefix=k&max-keys=1",
    ]);
    expect(s3({ endpoint: "https://acct.r2.example.com" }).anonymousProbeUrls("k")[0]!.url).toBe("https://sim-media.acct.r2.example.com/k");
    // Supabase Storage serves public buckets outside the S3 endpoint; that URL is probed too.
    const supa = s3({ endpoint: "https://ref.supabase.co/storage/v1/s3", forcePathStyle: true }).anonymousProbeUrls("k");
    expect(supa.map((p) => [p.probe, p.url])).toEqual([
      ["object", "https://ref.supabase.co/storage/v1/s3/sim-media/k"],
      ["list", "https://ref.supabase.co/storage/v1/s3/sim-media/?list-type=2&prefix=k&max-keys=1"],
      ["supabase_public_object", "https://ref.supabase.co/storage/v1/object/public/sim-media/k"],
    ]);
  });
});
