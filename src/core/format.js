/** Rendering numbers for a human reading the console. */

/** Long enough that minutes read better than a four-digit second count. */
export function seconds(ms) {
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const whole = Math.round(ms / 1000);
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}
