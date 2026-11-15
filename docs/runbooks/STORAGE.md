# Object storage

> **Status, 2026-11-15.** Two drivers exist: `local-fs` (one directory tree) and `s3` (one private S3-compatible bucket). The S3 driver is tested against moto, a local implementation of the S3 API (`pnpm test:s3`). **It has not been used with a real provider**: no account or credentials were available, and choosing and paying for a provider needs the owner's authorization.

Related: [DEPLOYMENT.md](DEPLOYMENT.md) §3.5 · [BACKUP_RESTORE.md](BACKUP_RESTORE.md) §3 · [DATA_RETENTION.md](DATA_RETENTION.md) · code in `packages/storage`

## 1. What is stored

| Bucket (logical) | Contents | Written by | Read by |
|---|---|---|---|
| `derivatives` | Imported, de-identified case images. The only server-side copy. | API (owner import) | API: `/api/media/:handle/:frame` and the owner preview route |
| `exports` | Learner data exports (JSON) | Worker (`data_export`) | API (download). Deleted by the worker's retention sweep. |
| `recordings` | Nothing yet (no code captures audio) | — | Deleted by the privacy jobs |
| `quarantine` | Unused by the server. Quarantine lives on the owner's computer (`tools/ingestion`). | — | — |

Each logical bucket is a directory (`local-fs`) or a key prefix (`s3`): `<S3_PREFIX><bucket>/<key>`, for example `derivatives/cases/<case>/<version>/<sha256>.png`. Keys are validated against path traversal before any access.

Development fixture media (labelled placeholders) are never uploaded. When `ALLOW_FIXTURES=true`, reads that miss the storage fall back to the committed fixture directory, read-only.

## 2. Rules for every driver

1. **Never public.** No public bucket, public object, website hosting, static-file route, CDN or presigned URL. The API streams each object after its own authorization check, with `Cache-Control: private, no-store`.
2. **Encrypted at rest.** An encrypted volume (`local-fs`) or server-side encryption (`s3`).
3. **Credentials stay server-side**, in the API and worker environments only. Never in a `NEXT_PUBLIC_*` variable, the browser, logs or tickets.
4. **The API and the worker use the same storage settings.** The worker writes exports that the API serves.

## 3. Choosing a driver

| | `local-fs` | `s3` |
|---|---|---|
| Hosts | One host, or one volume mounted by the API and the worker at the same path | Any. The bucket is shared over the network. |
| Encryption | The volume's | Server-side (`S3_SSE`) |
| Backups | Volume snapshots | Bucket versioning and lifecycle rules (§5) |
| Startup check | None | Privacy self-check (§6) |

The provider and region are owner decisions (DEPLOYMENT.md §12), including where case images and learner exports may be stored.

## 4. Settings

All are read by both the API and the worker. Full descriptions are in [.env.example](../../.env.example).

| Variable | Meaning |
|---|---|
| `STORAGE_DRIVER` | `local-fs` (default) or `s3` |
| `STORAGE_LOCAL_ROOT` | Root directory for `local-fs` |
| `S3_BUCKET` | The private bucket (required for `s3`) |
| `S3_REGION` | Default `us-east-1` |
| `S3_ENDPOINT` | Endpoint of an S3-compatible provider. Omit for AWS S3. Must be `https` in production. |
| `S3_FORCE_PATH_STYLE` | `true` for providers and local servers that need path-style addressing |
| `S3_PREFIX` | Optional key prefix, e.g. `staging/` |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Static keys (both or neither). With neither, the AWS default credential chain is used: an instance or task role, which is preferred on AWS. |
| `S3_SSE` | `AES256`, `aws:kms` or `provider-managed`. **Required in production.** |
| `S3_SSE_KMS_KEY_ID` | Optional KMS key for `aws:kms` |
| `S3_CHECKSUMS` | `when_supported` (default) or `when_required`, for providers that reject the SDK's default upload checksums |

The services refuse to start with incomplete or unsafe settings: no bucket, one key without the other, a KMS key without `aws:kms`, and in production no `S3_SSE` or a plain-`http` endpoint.

## 5. Setting up a bucket

Do this once per environment, with separate buckets (or at least separate prefixes and identities) for staging and production.

1. **Create a dedicated bucket** in the chosen region.
2. **Block all public access** at the account and bucket level. On AWS, turn on all four S3 Block Public Access settings and set Object Ownership to "Bucket owner enforced" (ACLs disabled). The driver never sends ACLs.
3. **Default encryption.** Turn on SSE-S3 or SSE-KMS and set `S3_SSE` to match. Use `provider-managed` only for a provider that always encrypts at rest and rejects the encryption header, and only after confirming this in its documentation.
4. **Versioning on**, to protect `derivatives` against accidental deletion or overwriting.
5. **Lifecycle rules:**
   - Permanently delete noncurrent versions after N days (owner decision). With versioning, a deleted export or recording survives as a noncurrent version until then, so the deletion window in the privacy notice must include N (DATA_RETENTION.md).
   - Optional backstop: expire current objects under `<prefix>exports/` after `EXPORT_RETENTION_DAYS` + 1 days. The worker deletes them first.
   - Abort incomplete multipart uploads after 7 days (the driver does not use multipart uploads, so this is housekeeping).
6. **A dedicated identity with least privilege.** For example, on AWS (replace `BUCKET` and `PREFIX`, which may be empty):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": "arn:aws:s3:::BUCKET/PREFIX*" },
       { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::BUCKET", "Condition": { "StringLike": { "s3:prefix": "PREFIX*" } } }
     ]
   }
   ```

   `s3:ListBucket` lets a missing object come back as 404 rather than 403, so the API can report a missing image correctly. With a customer-managed KMS key, also allow `kms:GenerateDataKey` and `kms:Decrypt` on that key. Keys from S3-compatible providers are often valid for every bucket in the account or project: keep them in the API and worker environments only.
7. **Nothing else:** no CORS configuration, no website hosting, no CDN in front of the bucket.

## 6. The startup self-check

With `STORAGE_DRIVER=s3`, the API and the worker each run a self-check before doing anything else, and exit if it fails:

1. They write a canary object (`<prefix>_selfcheck/<random>.txt`) with the configured encryption, then read it back with credentials.
2. They send anonymous requests, following redirects, for:
   - the canary object;
   - a listing scoped to the canary;
   - for a Supabase Storage endpoint (`…/storage/v1/s3`), also Supabase's public object URL (`…/storage/v1/object/public/<bucket>/<key>`), because Supabase serves public buckets outside its S3 endpoint.
3. If any anonymous request returns the canary's content, or a listing that contains its key, the service refuses to start: "The storage bucket serves objects without credentials" or "…lists its keys without credentials". Exposure is judged by the data returned, because providers answer refused requests with 401, 403, 400 or even a 5xx.
4. If a probe cannot be completed at all (network error, or a port that `fetch` blocks, such as 5060 or 5061), privacy is unverified and the service also refuses to start.
5. The canary is deleted, and the log line `storage self-check passed` records each probe's status and the encryption result:
   - `confirmed`: the provider echoed the requested encryption;
   - `requested_not_confirmed`: encryption was requested but not echoed. Check the bucket's default encryption by hand.
   - `provider_managed`: no header was sent (`S3_SSE=provider-managed`).

**What the check cannot see:** public access through a CDN, a custom domain or a provider's separate public hostname (for example Cloudflare R2's `r2.dev` addresses), and access granted to other accounts rather than to anonymous users. Review those settings by hand when setting up the bucket and after any change.

## 7. Provider notes (not verified against real accounts)

- **AWS S3.** Leave `S3_ENDPOINT` unset and set `S3_REGION`. Prefer an instance or task role to static keys. Use `S3_SSE=AES256` or `aws:kms`.
- **S3-compatible providers** (for example Cloudflare R2, Supabase Storage, MinIO). Set `S3_ENDPOINT`, and `S3_FORCE_PATH_STYLE` and `S3_REGION` as the provider documents.
  - Check whether the provider accepts the `x-amz-server-side-encryption` header before choosing `S3_SSE`.
  - If uploads fail with checksum errors, set `S3_CHECKSUMS=when_required`.
  - Supabase Storage: keep each bucket's "Public" setting off. The self-check probes its public URL.
  - Cloudflare R2: keep public access through `r2.dev` and custom domains off. The self-check cannot see them.

## 8. Testing

```bash
pnpm test:s3
```

`scripts/test-s3.sh` installs moto once into `var/s3-test/venv` (git-ignored), starts two local servers and runs:

1. the driver tests (`packages/storage/test/s3.test.ts`) against a server that verifies request signatures (round trips in every bucket, encryption, missing objects, a 3 MB stream, wrong-secret rejection, the self-check passing on a private bucket, and failing when it cannot complete);
2. the self-check refusal tests against a second server in moto's default mode, where a public bucket policy, or moto's anonymous listings, stand in for a misconfigured public bucket;
3. the whole API and worker test suites with `STORAGE_DRIVER=s3`, including an owner import whose image is streamed back byte for byte.

Plain `pnpm test` skips the S3 tests and runs the configuration and key-layout tests (`packages/storage/test/config.test.ts`).

## 9. Moving from `local-fs` to `s3`

1. Stop the API and the worker (a maintenance window; see ROLLBACK.md §3 for checking that no station is active).
2. Copy every object, keeping the same relative layout and the encryption, for example with the AWS CLI:

   ```bash
   aws s3 sync "$STORAGE_LOCAL_ROOT/derivatives" "s3://BUCKET/PREFIXderivatives" --sse AES256
   ```

   Repeat for `exports`. Never pass `--acl` or any public option.
3. Set the `S3_*` settings in **both** services, start them, and check the self-check log line.
4. Spot-check that several `storageKey` values from published case versions resolve (BACKUP_RESTORE.md §6.2), then open a case image as a learner and as the owner.
5. Keep the local volume, read-only, until a backup of the bucket exists.

## 10. Deletion and backups

- `delete` removes the current version of an object. With versioning on, the data remain in a noncurrent version until the lifecycle rule in §5 removes them. Plan privacy deletion windows accordingly (DATA_RETENTION.md).
- Backups, restore order and consistency with the database: BACKUP_RESTORE.md §3.
