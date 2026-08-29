import { config } from 'epicenter-libs';

/**
 * Coordinates of the free, PUBLIC Forio Epicenter project this MVP drives.
 * They come from the project URL:  forio.com/app/{account}/{project}
 */
export const FORIO = {
  account: 'ghandourroy',
  project: 'model-toolkit-project',
} as const;

/**
 * The model versions available to swap between. Each `file` must be uploaded to
 * the project's Model folder (via `bun run deploy`). Switching just creates a
 * fresh run against the selected file — no re-upload needed.
 */
export const MODELS = [
  { id: 'test1', file: 'test1.xlsx', label: 'test1 — 5% interest' },
  { id: 'test2', file: 'test2.xlsx', label: 'test2 — 10% interest' },
] as const;

export type ModelId = (typeof MODELS)[number]['id'];
export const DEFAULT_MODEL_ID: ModelId = 'test1';

export function modelFileFor(id: ModelId): string {
  return MODELS.find((m) => m.id === id)?.file ?? MODELS[0].file;
}

/** True until the placeholders are replaced with a real project. */
export const IS_CONFIGURED =
  !FORIO.account.startsWith('YOUR_') && !FORIO.project.startsWith('YOUR_');

let configured = false;

/**
 * Point epicenter-libs at our project.
 *
 * On localhost (Vite dev) the SDK can't infer the account/project from the
 * URL, so we set them explicitly — the same pattern the reference project
 * uses (`references/ai-governance/src/utils/constants.js`). In production
 * (served under forio.com/app/{account}/{project}/) they're auto-detected.
 */
export function configureForio(): void {
  if (configured) return;
  if (config.isLocal()) {
    config.accountShortName = FORIO.account;
    config.projectShortName = FORIO.project;
  }
  configured = true;
}
