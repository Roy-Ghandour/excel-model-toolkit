import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Compile `modelkit` into a standalone binary.
 *
 *     bun run build          # this machine
 *     bun run build --all    # every target we ship
 *
 * The binary is a *distribution* artifact, not part of the development loop —
 * `bun bin/modelkit.js <tool>` runs the same code from source with no build at all.
 * The one thing a build is good for is proving the bundle is complete: `--compile`
 * resolves the import graph ahead of time, so anything reached dynamically works
 * from source and then fails only in the artifact people actually use.
 */

/** Repo root, resolved from this file so the script works from any directory. */
const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The entry point whose import graph becomes the binary. */
const ENTRY = join(ROOT, "bin/modelkit.js");

/** Where binaries are outputted. */
const DIST = join(ROOT, "dist");

/**
 * The targets `--all` produces.
 *
 * Bun cross-compiles all of these from any host, so one machine can cut a release
 * for every machine. macOS needs both architectures because they are genuinely
 * different binaries; Linux is absent until someone needs it.
 */
const TARGETS = ["bun-darwin-arm64", "bun-darwin-x64", "bun-windows-x64"];

/**
 * Compile one binary.
 *
 * @param {object} [options]
 * @param {string} [options.target] A Bun target triple. Omitted means this machine.
 * @returns {string} Path to the binary that was written.
 */
export function build({ target } = {}) {
  mkdirSync(DIST, { recursive: true });

  // Windows binaries get `.exe` appended by Bun, so the returned path is what we
  // asked for rather than necessarily what landed. Only the caller's message uses it.
  const outfile = join(DIST, target ? `modelkit-${target}` : "modelkit");

  const args = ["build", "--compile", "--outfile", outfile];
  if (target) args.push(`--target=${target}`);
  args.push(ENTRY);

  const result = spawnSync("bun", args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`bun build failed for ${target ?? "this machine"}`);
  }
  return outfile;
}

if (import.meta.main) {
  const all = process.argv.includes("--all");
  const targets = all ? TARGETS : [undefined];

  // Clear folder
  rmSync(DIST, { recursive: true, force: true });
  for (const target of targets) build({ target });
  const count = targets.length;
  console.log(
    `\nwrote ${count} ${count === 1 ? "binary" : "binaries"} to ${DIST}`
  );
}
