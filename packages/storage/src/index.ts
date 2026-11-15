/**
 * Object storage adapters (spec §13, §17). See ./core for the bucket model. Drivers:
 *  - local-fs: one private directory tree (development, or a single host with one volume);
 *  - s3:       one private S3-compatible bucket, shared by the API and the worker;
 *  - memory:   tests.
 * No bucket is public and no driver hands out URLs: the API streams each object after an
 * authorization check. Setup and checks: docs/runbooks/STORAGE.md.
 */
export * from "./core";
export * from "./local";
export * from "./s3";
export * from "./fallback";
export * from "./config";
