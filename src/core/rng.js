/**
 * A seeded pseudo-random source.
 *
 * `Math.random` cannot be replayed, and a generated run has to be reproducible from
 * the seed recorded in its `origin`. Mulberry32: 32 bits of state, one multiply-xor
 * round, and no dependency.
 *
 * Reproducibility is only as good as the caller's iteration order — the same seed
 * returns the same sequence, so anything consuming it must consume it in a stable
 * order.
 */

/** FNV-1a, so a seed can be a memorable string rather than a number. */
function hash(text) {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/**
 * @typedef {object} Rng
 * @property {() => number} float Uniform in [0, 1).
 * @property {(bound: number) => number} int Uniform whole number in [0, bound).
 * @property {<T>(items: T[]) => T} pick One item, uniformly.
 * @property {<T>(items: T[]) => T[]} shuffle A shuffled copy.
 * @property {(probability?: number) => boolean} chance True with the given probability, 0.5 by default.
 */

/**
 * @param {number | string} seed
 * @returns {Rng}
 */
export function createRng(seed) {
  let state = (typeof seed === "string" ? hash(seed) : seed) >>> 0;

  /** Uniform in [0, 1). */
  const float = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /** Uniform whole number in [0, bound). */
  const int = (bound) => Math.floor(float() * bound);

  return {
    float,
    int,
    pick: (items) => items[int(items.length)],
    /** Fisher-Yates over a copy, so the caller's array is left alone. */
    shuffle(items) {
      const shuffled = [...items];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = int(i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    },
    chance: (probability = 0.5) => float() < probability,
  };
}
