/**
 * Agreement statistics used in evaluation reports. Every statistic is reported with its
 * denominator; small samples get wide intervals and the report says so.
 */

export type Pair = readonly [reference: number, predicted: number];

/** Cohen's kappa with optional ordinal weights. Returns null when undefined (no variation). */
export function kappa(pairs: readonly Pair[], k: number, weight: "none" | "linear" | "quadratic" = "none"): number | null {
  if (pairs.length === 0 || k < 2) return null;
  const n = pairs.length;
  const O = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const rows = new Array<number>(k).fill(0);
  const cols = new Array<number>(k).fill(0);
  for (const [r, p] of pairs) {
    O[r]![p]! += 1 / n;
    rows[r]! += 1 / n;
    cols[p]! += 1 / n;
  }
  const w = (i: number, j: number) => (weight === "none" ? (i === j ? 0 : 1) : weight === "linear" ? Math.abs(i - j) / (k - 1) : ((i - j) / (k - 1)) ** 2);
  let obs = 0;
  let exp = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      obs += w(i, j) * O[i]![j]!;
      exp += w(i, j) * rows[i]! * cols[j]!;
    }
  }
  if (exp === 0) return null;
  return 1 - obs / exp;
}

/** Wilson score interval for a proportion. */
export function wilson(successes: number, n: number, z = 1.96): [number, number] | null {
  if (n === 0) return null;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Percentile bootstrap interval for a statistic over clusters (e.g. resampling whole case
 * families or patterns, because responses within one case are not independent).
 */
export function bootstrap<T>(clusters: readonly T[][], stat: (items: T[]) => number | null, iterations = 1000, seed = 20261115): [number, number] | null {
  if (clusters.length < 2) return null;
  const rnd = mulberry32(seed);
  const values: number[] = [];
  for (let b = 0; b < iterations; b++) {
    const sample: T[] = [];
    for (let i = 0; i < clusters.length; i++) sample.push(...clusters[Math.floor(rnd() * clusters.length)]!);
    const v = stat(sample);
    if (v !== null && Number.isFinite(v)) values.push(v);
  }
  if (values.length < iterations * 0.5) return null;
  values.sort((a, b) => a - b);
  return [values[Math.floor(0.025 * (values.length - 1))]!, values[Math.ceil(0.975 * (values.length - 1))]!];
}

export function confusion(pairs: readonly Pair[], k: number): number[][] {
  const m = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (const [r, p] of pairs) m[r]![p]! += 1;
  return m;
}

export const pct = (x: number | null | undefined, digits = 0) => (x === null || x === undefined ? "n/a" : `${(x * 100).toFixed(digits)}%`);
export const fmt = (x: number | null | undefined, digits = 2) => (x === null || x === undefined ? "n/a" : x.toFixed(digits));
