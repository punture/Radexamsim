import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalFsStorage, assertSafeKey } from "../src";

describe("storage", () => {
  it("rejects path traversal and unsafe keys", () => {
    for (const k of ["../etc/passwd", "a/../../b", "/abs", "a//b", "", "x\u0000y"]) expect(() => assertSafeKey(k)).toThrow();
    expect(() => assertSafeKey("fixtures/fx-case/ct/0.png")).not.toThrow();
  });
  it("round-trips objects and serves read-only fallbacks", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "sim-storage-"));
    const fb = mkdtempSync(path.join(tmpdir(), "sim-fallback-"));
    const s1 = new LocalFsStorage(root);
    await s1.put("derivatives", "a/b.png", new Uint8Array([1, 2, 3]));
    expect([...(await s1.get("derivatives", "a/b.png"))]).toEqual([1, 2, 3]);
    await new LocalFsStorage(fb).put("derivatives", "x.png", new Uint8Array([9]));
    const s2 = new LocalFsStorage(root, { derivatives: path.join(fb, "derivatives") });
    expect(await s2.exists("derivatives", "x.png")).toBe(true);
    expect(await s2.exists("quarantine", "x.png")).toBe(false);
    await expect(s2.get("derivatives", "missing.png")).rejects.toThrow(/not found/);
  });
});
