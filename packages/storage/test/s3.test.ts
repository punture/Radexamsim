import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import { CreateBucketCommand, HeadObjectCommand, ListObjectsV2Command, PutBucketPolicyCommand, S3Client } from "@aws-sdk/client-s3";
import { beforeAll, describe, expect, it } from "vitest";
import { BUCKETS, ReadOnlyFallbackStorage, S3Storage, StorageNotFound, StoragePublicError, type S3StorageOptions } from "../src";

/**
 * Integration tests against local moto S3 servers (an independent S3 implementation), started
 * by `pnpm test:s3` (scripts/test-s3.sh):
 *  - S3_TEST_ENDPOINT verifies request signatures (keys in S3_TEST_ACCESS_KEY_ID/SECRET);
 *  - S3_TEST_OPEN_ENDPOINT is moto's default mode, where a public bucket policy, or moto's
 *    anonymous listings, stand in for a misconfigured public bucket.
 * Skipped when the servers are not configured (plain `pnpm test`).
 */
const AUTH = process.env.S3_TEST_ENDPOINT;
const OPEN = process.env.S3_TEST_OPEN_ENDPOINT;
const credentials = { accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? "test", secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? "test" };
const region = "us-east-1";

const admin = (endpoint: string) => new S3Client({ endpoint, region, forcePathStyle: true, credentials });
const driver = (endpoint: string, bucket: string, over: Partial<S3StorageOptions> = {}) =>
  new S3Storage({ bucket, region, endpoint, forcePathStyle: true, prefix: "it/", credentials, sse: "AES256", ...over });

async function newBucket(endpoint: string): Promise<string> {
  const bucket = `sim-it-${randomUUID().slice(0, 8)}`;
  await admin(endpoint).send(new CreateBucketCommand({ Bucket: bucket }));
  return bucket;
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks);
}

async function keysUnder(endpoint: string, bucket: string, prefix: string): Promise<string[]> {
  const out = await admin(endpoint).send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
  return (out.Contents ?? []).map((o) => o.Key!);
}

describe.skipIf(!AUTH)("S3 driver against a signature-verifying S3 server", () => {
  let bucket = "";
  beforeAll(async () => {
    bucket = await newBucket(AUTH!);
  });

  it("round-trips objects in every logical bucket, encrypted, under the prefix", async () => {
    const s = driver(AUTH!, bucket);
    for (const b of BUCKETS) {
      const data = new Uint8Array([1, 2, 3, b.length]);
      await s.put(b, "cases/c1/v1/frame-0.png", data, "image/png");
      expect([...(await s.get(b, "cases/c1/v1/frame-0.png"))]).toEqual([...data]);
      const { stream, size } = await s.stream(b, "cases/c1/v1/frame-0.png");
      expect(size).toBe(4);
      expect([...(await readAll(stream))]).toEqual([...data]);
      expect(await s.exists(b, "cases/c1/v1/frame-0.png")).toBe(true);
      const head = await admin(AUTH!).send(new HeadObjectCommand({ Bucket: bucket, Key: `it/${b}/cases/c1/v1/frame-0.png` }));
      expect(head.ServerSideEncryption).toBe("AES256");
      expect(head.ContentType).toBe("image/png");
    }
    await s.delete("exports", "cases/c1/v1/frame-0.png");
    expect(await s.exists("exports", "cases/c1/v1/frame-0.png")).toBe(false);
    await expect(s.delete("exports", "cases/c1/v1/frame-0.png")).resolves.toBeUndefined(); // idempotent
  });

  it("maps missing objects to not-found, and streams a larger object with its exact length", async () => {
    const s = driver(AUTH!, bucket);
    await expect(s.get("derivatives", "missing.png")).rejects.toBeInstanceOf(StorageNotFound);
    await expect(s.stream("derivatives", "missing.png")).rejects.toBeInstanceOf(StorageNotFound);
    expect(await s.exists("derivatives", "missing.png")).toBe(false);
    const big = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251);
    await s.put("derivatives", "big.bin", big, "application/octet-stream");
    const { stream, size } = await s.stream("derivatives", "big.bin");
    expect(size).toBe(big.length);
    expect(Buffer.compare(await readAll(stream), Buffer.from(big))).toBe(0);
  });

  it("works with request checksums limited to when they are required", async () => {
    const s = driver(AUTH!, bucket, { checksums: "when_required" });
    await s.put("derivatives", "checksums/a.json", new TextEncoder().encode("{}"), "application/json");
    expect(new TextDecoder().decode(await s.get("derivatives", "checksums/a.json"))).toBe("{}");
  });

  it("is rejected by the server when signed with the wrong secret (the server really verifies)", async () => {
    const wrong = driver(AUTH!, bucket, { credentials: { accessKeyId: credentials.accessKeyId, secretAccessKey: "wrong-secret" } });
    await expect(wrong.put("derivatives", "x.png", new Uint8Array([1]), "image/png")).rejects.toMatchObject({ name: "SignatureDoesNotMatch" });
  });

  it("passes the startup self-check on a private bucket, confirms encryption, and removes the canary", async () => {
    const r = await driver(AUTH!, bucket).selfCheck();
    expect(r.driver).toBe("s3");
    expect(r.encryption).toBe("confirmed");
    expect(r.anonymousProbes.map((p) => p.probe)).toEqual(["object", "list"]);
    for (const p of r.anonymousProbes) expect(p.exposed).toBe(false);
    expect(await keysUnder(AUTH!, bucket, "it/_selfcheck/")).toEqual([]);
  });

  it("fails the self-check when privacy cannot be verified", async () => {
    const s = driver(AUTH!, bucket, { fetchImpl: async () => Promise.reject(new Error("network unreachable")) });
    const err = await s.selfCheck().catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(StoragePublicError);
    expect((err as Error).message).toMatch(/privacy is unverified/);
    expect(await keysUnder(AUTH!, bucket, "it/_selfcheck/")).toEqual([]);
  });

  it("serves committed fixture media read-only when the bucket has no such object", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sim-fixture-media-"));
    mkdirSync(path.join(dir, "fx"), { recursive: true });
    writeFileSync(path.join(dir, "fx", "placeholder.png"), Buffer.from([7, 7]));
    const s = new ReadOnlyFallbackStorage(driver(AUTH!, bucket), { derivatives: dir });
    expect([...(await s.get("derivatives", "fx/placeholder.png"))]).toEqual([7, 7]);
    expect((await s.stream("derivatives", "fx/placeholder.png")).size).toBe(2);
    expect(await s.exists("derivatives", "fx/placeholder.png")).toBe(true);
    expect(await s.exists("exports", "fx/placeholder.png")).toBe(false);
    await expect(s.get("derivatives", "fx/../../etc/passwd")).rejects.toThrow(/invalid storage key/);
    // Writes go to the bucket, never to the fixture directory.
    await s.put("derivatives", "fx/new.png", new Uint8Array([1]), "image/png");
    expect(await keysUnder(AUTH!, bucket, "it/derivatives/fx/")).toEqual(["it/derivatives/fx/new.png"]);
  });
});

describe.skipIf(!OPEN)("S3 driver self-check refuses public storage", () => {
  it("refuses a bucket whose policy lets anyone read objects", async () => {
    const bucket = await newBucket(OPEN!);
    const policy = { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: "*", Action: "s3:GetObject", Resource: `arn:aws:s3:::${bucket}/*` }] };
    await admin(OPEN!).send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: JSON.stringify(policy) }));
    const err = await driver(OPEN!, bucket).selfCheck().catch((e: Error) => e);
    expect(err).toBeInstanceOf(StoragePublicError);
    expect((err as Error).message).toMatch(/serves objects without credentials/);
    expect(await keysUnder(OPEN!, bucket, "it/_selfcheck/")).toEqual([]);
  });

  it("refuses a bucket that lists its keys without credentials", async () => {
    // moto's default mode answers anonymous listings, like a bucket with a public list grant.
    const bucket = await newBucket(OPEN!);
    const err = await driver(OPEN!, bucket).selfCheck().catch((e: Error) => e);
    expect(err).toBeInstanceOf(StoragePublicError);
    expect((err as Error).message).toMatch(/lists its keys without credentials/);
  });
});
