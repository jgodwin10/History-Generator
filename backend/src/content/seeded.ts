// src/content/seeded.ts
//
// Deterministic picks: the same seed always gives the same choice. Used for
// per-book writing styles and per-account defaults (copyright wording, fonts,
// table of contents). Changing seedFromString would silently change every
// account's defaults, so leave it as it is.

export function seedFromString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // FNV-1a's low bits barely depend on later characters, so picks salted
  // with different suffixes ("::background", "::focus") came out correlated
  // and half of all combinations could never occur. Murmur3's finalizer
  // spreads every input bit across the output before we take a remainder.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

// mulberry32: small, fast, good enough for picking from lists
export function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(seed: string, salt: string, pool: readonly T[]): T {
  return pool[seedFromString(`${seed}::${salt}`) % pool.length];
}

export function pickSeveral<T>(
  seed: string,
  salt: string,
  pool: readonly T[],
  count: number,
): T[] {
  const random = seededRandom(seedFromString(`${seed}::${salt}`));
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(count, copy.length));
}
