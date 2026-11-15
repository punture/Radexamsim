import { randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, type PutObjectCommandInput } from "@aws-sdk/client-s3";
import { assertSafeKey, StorageNotFound, StoragePublicError, type Bucket, type ObjectStorage, type StorageSelfCheck } from "./core";

/**
 * Server-side encryption for new objects:
 *  - "AES256":  SSE-S3, keys managed by the provider;
 *  - "aws:kms": SSE-KMS, optionally with a customer-managed key (kmsKeyId);
 *  - "provider-managed": send no encryption header, for providers that always encrypt at rest
 *    and reject or ignore the header. Confirm this in the provider's documentation first.
 */
export type S3Sse = "AES256" | "aws:kms" | "provider-managed";

export type S3StorageOptions = {
  /** One private bucket. Objects are stored as `<prefix><logical bucket>/<key>`. */
  bucket: string;
  region: string;
  /** Custom endpoint for S3-compatible providers (omit for AWS S3). */
  endpoint?: string;
  forcePathStyle?: boolean;
  /** Optional key prefix, e.g. "staging/" (empty or ending with "/"). */
  prefix?: string;
  /** Static keys. Omit to use the AWS default credential chain (instance or task role). */
  credentials?: { accessKeyId: string; secretAccessKey: string };
  sse: S3Sse;
  kmsKeyId?: string;
  /** "when_required" for providers that reject the SDK's default request checksums. */
  checksums?: "when_supported" | "when_required";
  /** Test hook: anonymous probe transport. */
  fetchImpl?: typeof fetch;
};

const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const PREFIX_RE = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*$/;

/**
 * S3-compatible object storage (AWS S3, and providers that implement its API).
 *
 * Safety properties:
 *  - never creates public objects (no ACLs), presigned URLs or any other URL for a client;
 *    the API streams each object after its own authorization check;
 *  - encrypts every new object as configured (S3_SSE);
 *  - selfCheck() refuses storage that serves objects or listings without credentials.
 */
export class S3Storage implements ObjectStorage {
  readonly driver = "s3";
  private readonly client: S3Client;
  private readonly prefix: string;

  constructor(private readonly opts: S3StorageOptions) {
    if (!BUCKET_RE.test(opts.bucket) || opts.bucket.includes("..")) throw new Error("S3 bucket name is not valid");
    this.prefix = opts.prefix ?? "";
    if (!PREFIX_RE.test(this.prefix)) throw new Error('S3 prefix must be empty or like "staging/" (letters, digits, ".", "_", "-", ending with "/")');
    if (opts.kmsKeyId && opts.sse !== "aws:kms") throw new Error("a KMS key id needs S3_SSE=aws:kms");
    const checksums = opts.checksums === "when_required" ? "WHEN_REQUIRED" : "WHEN_SUPPORTED";
    this.client = new S3Client({
      region: opts.region,
      ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
      forcePathStyle: opts.forcePathStyle ?? false,
      ...(opts.credentials ? { credentials: opts.credentials } : {}),
      requestChecksumCalculation: checksums,
      responseChecksumValidation: checksums,
      maxAttempts: 3,
      requestHandler: {
        connectionTimeout: 5_000,
        requestTimeout: 60_000,
        httpAgent: new http.Agent({ keepAlive: true, maxSockets: 128 }),
        httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 128 }),
      },
    });
  }

  /** The object key inside the bucket. Validates the caller's key first. */
  objectKey(bucket: Bucket, key: string): string {
    assertSafeKey(key);
    return `${this.prefix}${bucket}/${key}`;
  }

  /** Encryption parameters sent with every write. */
  encryptionParams(): Pick<PutObjectCommandInput, "ServerSideEncryption" | "SSEKMSKeyId"> {
    if (this.opts.sse === "AES256") return { ServerSideEncryption: "AES256" };
    if (this.opts.sse === "aws:kms") return { ServerSideEncryption: "aws:kms", ...(this.opts.kmsKeyId ? { SSEKMSKeyId: this.opts.kmsKeyId } : {}) };
    return {};
  }

  async put(bucket: Bucket, key: string, data: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.opts.bucket, Key: this.objectKey(bucket, key), Body: data, ContentLength: data.byteLength, ContentType: contentType, ...this.encryptionParams() }),
    );
  }

  async get(bucket: Bucket, key: string): Promise<Uint8Array> {
    const out = await this.getObject(bucket, key);
    return out.Body!.transformToByteArray();
  }

  async stream(bucket: Bucket, key: string): Promise<{ stream: Readable; size: number }> {
    const out = await this.getObject(bucket, key);
    const size = out.ContentLength;
    if (typeof size === "number" && out.Body instanceof Readable) return { stream: out.Body, size };
    // No length or no Node stream (unusual provider or runtime): buffer, so callers can still send Content-Length.
    const bytes = Buffer.from(await out.Body!.transformToByteArray());
    return { stream: Readable.from([bytes]), size: bytes.length };
  }

  async exists(bucket: Bucket, key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.opts.bucket, Key: this.objectKey(bucket, key) }));
      return true;
    } catch (e) {
      if (isMissingObject(e)) return false;
      throw e;
    }
  }

  /** Deletes the current object version. Missing objects are not an error. */
  async delete(bucket: Bucket, key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: this.objectKey(bucket, key) }));
  }

  private async getObject(bucket: Bucket, key: string) {
    try {
      return await this.client.send(new GetObjectCommand({ Bucket: this.opts.bucket, Key: this.objectKey(bucket, key) }));
    } catch (e) {
      if (isMissingObject(e)) throw new StorageNotFound(bucket, key);
      throw e;
    }
  }

  /**
   * URLs an anonymous client could use to read `objectKey`, or to list the bucket, at the
   * configured endpoint (plus Supabase Storage's public object URL for a Supabase endpoint).
   * Public access through a CDN, a custom domain or a provider's separate public hostname
   * (such as Cloudflare R2's r2.dev) cannot be derived and is not covered.
   */
  anonymousProbeUrls(objectKey: string): { probe: string; url: string; kind: "object" | "list" }[] {
    const encKey = objectKey.split("/").map(encodeURIComponent).join("/");
    const { bucket, region } = this.opts;
    // Listing scoped to the canary, so a public listing must show it.
    const list = `list-type=2&prefix=${encodeURIComponent(objectKey)}&max-keys=1`;
    if (!this.opts.endpoint) {
      const pathStyle = this.opts.forcePathStyle || bucket.includes(".");
      const base = pathStyle ? `https://s3.${region}.amazonaws.com/${bucket}` : `https://${bucket}.s3.${region}.amazonaws.com`;
      return [
        { probe: "object", url: `${base}/${encKey}`, kind: "object" },
        { probe: "list", url: `${base}/?${list}`, kind: "list" },
      ];
    }
    const u = new URL(this.opts.endpoint);
    const basePath = u.pathname.replace(/\/+$/, "");
    const base = this.opts.forcePathStyle ? `${u.origin}${basePath}/${bucket}` : `${u.protocol}//${bucket}.${u.host}${basePath}`;
    const urls: { probe: string; url: string; kind: "object" | "list" }[] = [
      { probe: "object", url: `${base}/${encKey}`, kind: "object" },
      { probe: "list", url: `${base}/?${list}`, kind: "list" },
    ];
    if (basePath.endsWith("/storage/v1/s3")) {
      // Supabase serves public buckets from a separate path, not through the S3 endpoint.
      urls.push({ probe: "supabase_public_object", url: `${u.origin}${basePath.slice(0, -"/s3".length)}/object/public/${bucket}/${encKey}`, kind: "object" });
    }
    return urls;
  }

  /**
   * Writes a canary object, reads it back with credentials, then confirms that anonymous
   * requests (following redirects) neither return its content nor list its key. Deletes the
   * canary. Exposure is judged by the data returned, not the status code alone: providers
   * answer refused requests with 401, 403, 400 or even 5xx. Throws StoragePublicError when
   * anything is exposed, and an ordinary error when the check cannot be completed. The
   * services call this at startup and refuse to run when it throws.
   */
  async selfCheck(): Promise<StorageSelfCheck> {
    const key = `${this.prefix}_selfcheck/${randomUUID()}.txt`;
    const body = `storage self-check ${new Date().toISOString()}`;
    const put = await this.client.send(new PutObjectCommand({ Bucket: this.opts.bucket, Key: key, Body: body, ContentType: "text/plain", ...this.encryptionParams() }));
    const anonymousProbes: StorageSelfCheck["anonymousProbes"] = [];
    try {
      const got = await this.client.send(new GetObjectCommand({ Bucket: this.opts.bucket, Key: key }));
      if ((await got.Body!.transformToString()) !== body) throw new Error("storage self-check: the canary object read back differently");
      const doFetch = this.opts.fetchImpl ?? fetch;
      for (const p of this.anonymousProbeUrls(key)) {
        let status: number;
        let text = "";
        try {
          const res = await doFetch(p.url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(10_000) });
          status = res.status;
          if (res.ok) text = await readText(res, 64 * 1024);
          else await res.body?.cancel();
        } catch (e) {
          const err = e as Error & { cause?: { code?: string; message?: string } };
          const cause = err.cause?.code ?? err.cause?.message;
          throw new Error(`storage self-check: could not complete the anonymous ${p.probe} probe, so privacy is unverified (${err.message}${cause ? `: ${cause}` : ""})`);
        }
        const exposed = status >= 200 && status < 300 && (p.kind === "object" ? text === body : text.includes(`<Key>${key}</Key>`));
        anonymousProbes.push({ probe: p.probe, status, exposed });
        if (exposed) {
          throw new StoragePublicError(
            p.kind === "object"
              ? `The storage bucket serves objects without credentials (${p.probe} probe, HTTP ${status}). Make the bucket private before starting.`
              : `The storage bucket lists its keys without credentials (${p.probe} probe, HTTP ${status}). Make the bucket private before starting.`,
          );
        }
      }
    } finally {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key })).catch(() => undefined);
    }
    const requested = this.encryptionParams().ServerSideEncryption;
    const encryption = !requested ? "provider_managed" : put.ServerSideEncryption === requested ? "confirmed" : "requested_not_confirmed";
    return { driver: this.driver, anonymousProbes, encryption };
  }
}

/** Reads at most `limit` bytes of a response body as text. */
async function readText(res: Response, limit: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return Buffer.concat(chunks).toString("utf8").slice(0, limit);
}

/** A missing object (not a missing bucket, which is a configuration error). */
function isMissingObject(e: unknown): boolean {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  if (!err) return false;
  if (err.name === "NoSuchKey" || err.name === "NotFound") return true;
  return err.$metadata?.httpStatusCode === 404 && err.name !== "NoSuchBucket";
}
