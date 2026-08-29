/**
 * Model deploy script — uploads the MVP model versions to the Forio project's
 * model folder, replacing the manual drag-and-drop step. Run with:
 *
 *     bun run deploy                  # upload all models in src/mvp/models/ (never deletes)
 *     bun run deploy --list [path]    # authenticate and print the project's file tree
 *     bun run deploy --delete <path>  # delete ONE file, e.g. --delete model/old.xlsx
 *     bun run deploy --probe          # try auth objectTypes and report which works
 *
 * Config + credentials live in a git-ignored `.env` at the project root (copy
 * `.env.example`). Bun auto-loads `.env` into process.env, so `bun run deploy`
 * reads them itself — no interactive entry. `.env` is blocked from the assistant's
 * tools by the global secret-file guard (~/.claude/hooks/guard-sensitive.py).
 *
 * Endpoint semantics (from epicenter-libs v3 src/adapters/file.ts JSDoc and the
 * Forio-provided proxy deploy script in `references/deploy reference/`):
 *   - POST /file/{dir} — create NEW file(s); filename carried in the FormData part
 *   - PUT  /file/{dir} — replace EXISTING file(s)
 *   - DELETE /file/{path} — remove one file (or directory — we only ever pass files)
 * We list the target dir first and pick POST vs PUT per file, so nothing is deleted.
 *
 * Why raw fetch (not the SDK fileAdapter): the SDK's own JSDoc marks create/upload
 * as browser-only — in Node the Router doesn't serialize FormData as multipart.
 * Native fetch in Bun/Node does.
 *
 * Auth (verified 2026-07-25 against the live API): a personal-account author logs
 * in the way the Epicenter manager UI does — POST
 * /api/v3/epicenter/manager/authentication with objectType 'admin'. The returned
 * token works directly on the project's /file API, no regenerate needed.
 * Project-scoped admin login (the Forio proxy script's approach) is TEAM-account
 * only — on a personal account it 500s with a PersonalAccount→TeamAccount cast
 * error. 'personal' is not a valid objectType. `--probe` reports every candidate.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = join(HERE, '..', 'src', 'mvp', 'models');
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface Config {
  server: string;
  account: string;
  project: string;
  secretKey?: string;
  handle?: string;
  password?: string;
  modelDir: string;
}

interface FileSystemEntry {
  objectType: 'file' | 'directory';
  name?: string;
  size?: number;
  lastModifiedTime?: string;
  children?: FileSystemEntry[];
}

/** Load config from the environment (Bun auto-loads the root `.env`). */
function loadConfig(): Config {
  const account = process.env.FORIO_ACCOUNT;
  const project = process.env.FORIO_PROJECT;
  const secretKey = process.env.FORIO_SECRET_KEY;
  const handle = process.env.FORIO_HANDLE;
  const password = process.env.FORIO_PASSWORD;

  const bad = (v?: string) => !v || v.startsWith('YOUR_');
  const problems: string[] = [];
  if (bad(account)) problems.push('FORIO_ACCOUNT');
  if (bad(project)) problems.push('FORIO_PROJECT');
  if (bad(secretKey) && (bad(handle) || bad(password))) {
    problems.push('FORIO_SECRET_KEY (or FORIO_HANDLE + FORIO_PASSWORD)');
  }
  if (problems.length) {
    console.error(
      `✗ Missing ${problems.join(', ')}. Set them in .env at the project root (copy .env.example).`,
    );
    process.exit(1);
  }
  return {
    server: process.env.FORIO_SERVER || 'https://forio.com',
    account: account!,
    project: project!,
    secretKey: bad(secretKey) ? undefined : secretKey,
    handle: bad(handle) ? undefined : handle,
    password: bad(password) ? undefined : password,
    modelDir: process.env.FORIO_MODEL_DIR || 'model',
  };
}

const projectUrl = (cfg: Config, suffix: string) =>
  `${cfg.server}/api/v3/${cfg.account}/${cfg.project}${suffix}`;

/** file paths may contain spaces etc — encode segments, keep '/' separators */
const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** One login attempt; returns the token or a failure description. */
async function tryLogin(
  payload: Record<string, unknown>,
  url: string,
): Promise<{ token?: string; error?: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await readBody(res)) as {
    token?: string;
    body?: { token?: string };
    message?: string;
  };
  const token = body?.token ?? body?.body?.token;
  if (res.ok && token) return { token };
  return {
    error: `HTTP ${res.status}${body?.message ? ` — ${body.message}` : ''}`,
  };
}

/** Candidate [label, payload, url] triples, in the order we should try them. */
function authCandidates(
  cfg: Config,
): Array<[string, Record<string, unknown>, string]> {
  const out: Array<[string, Record<string, unknown>, string]> = [];
  if (cfg.handle && cfg.password) {
    // Author login, the way the Epicenter manager UI does it (works for
    // personal accounts; project-scoped 'admin' is team-account-only).
    out.push([
      'admin via epicenter/manager',
      { objectType: 'admin', handle: cfg.handle, password: cfg.password },
      `${cfg.server}/api/v3/epicenter/manager/authentication`,
    ]);
    out.push([
      'user (project-scoped)',
      { objectType: 'user', handle: cfg.handle, password: cfg.password },
      projectUrl(cfg, '/authentication'),
    ]);
  }
  if (cfg.secretKey) {
    out.push([
      'account (secretKey)',
      { objectType: 'account', secretKey: cfg.secretKey },
      projectUrl(cfg, '/authentication'),
    ]);
  }
  return out;
}

/** Authenticate: first candidate that yields a token wins. */
async function login(cfg: Config): Promise<string> {
  const failures: string[] = [];
  for (const [label, payload, url] of authCandidates(cfg)) {
    const { token, error } = await tryLogin(payload, url);
    if (token) {
      console.log(`Logged in ✓ (${label})`);
      return token;
    }
    failures.push(`  ${label}: ${error}`);
  }
  throw new Error(`all auth attempts failed:\n${failures.join('\n')}`);
}

/** Try every auth candidate and report — no uploads. */
async function probe(cfg: Config): Promise<void> {
  for (const [label, payload, url] of authCandidates(cfg)) {
    const { token, error } = await tryLogin(payload, url);
    console.log(token ? `  ✓ ${label}` : `  ✗ ${label}: ${error}`);
  }
}

/** List the project's files at `path` (returns [] if the path doesn't exist yet). */
async function listFiles(
  cfg: Config,
  token: string,
  path = '',
  depth = 3,
): Promise<FileSystemEntry[]> {
  const suffix = path ? `/file/${encodePath(path)}` : '/file';
  const res = await fetch(projectUrl(cfg, `${suffix}?depth=${depth}`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return [];
  const body = await readBody(res);
  if (!res.ok) {
    throw new Error(`list failed (HTTP ${res.status}): ${JSON.stringify(body)}`);
  }
  return body as FileSystemEntry[];
}

/**
 * Upload one file into `dir` without touching anything else:
 * POST (create) if the name isn't taken there yet, PUT (replace) if it is.
 */
async function uploadFile(
  cfg: Config,
  token: string,
  filePath: string,
  dir: string,
  existingNames: Set<string>,
): Promise<void> {
  const name = basename(filePath);
  const method = existingNames.has(name) ? 'PUT' : 'POST';

  const form = new FormData();
  form.append('file', new Blob([readFileSync(filePath)], { type: XLSX_MIME }), name);

  const res = await fetch(projectUrl(cfg, `/file/${encodePath(dir)}`), {
    method,
    headers: { Authorization: `Bearer ${token}` }, // no Content-Type — fetch sets the multipart boundary
    body: form,
  });
  const body = await readBody(res);
  if (!res.ok) {
    throw new Error(
      `${method} of ${dir}/${name} failed (HTTP ${res.status}): ${JSON.stringify(body)}`,
    );
  }
  console.log(`  ✓ ${name} → ${dir}/${name} (${method === 'PUT' ? 'replaced' : 'created'})`);
}

/** Delete exactly one file (sole action; guarded against directories). */
async function deleteFile(cfg: Config, token: string, path: string): Promise<void> {
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const name = basename(path);
  const entries = await listFiles(cfg, token, parent, 1);
  const entry = entries.find((e) => e.name === name);
  if (!entry) {
    throw new Error(`no such file on the server: ${path}`);
  }
  if (entry.objectType !== 'file') {
    throw new Error(`refusing to delete "${path}" — it is a ${entry.objectType}, not a file`);
  }
  const res = await fetch(projectUrl(cfg, `/file/${encodePath(path)}`), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await readBody(res);
    throw new Error(`delete of ${path} failed (HTTP ${res.status}): ${JSON.stringify(body)}`);
  }
  console.log(`  ✓ deleted ${path}`);
}

async function main() {
  const cfg = loadConfig();
  const args = process.argv.slice(2);
  const arg = (flag: string) => {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : (args[i + 1] ?? '');
  };

  console.log(`Deploy target: ${cfg.account}/${cfg.project} on ${cfg.server}`);

  if (args.includes('--probe')) {
    console.log('\nAuth probe:');
    await probe(cfg);
    return;
  }

  const token = await login(cfg);

  if (args.includes('--list')) {
    const path = arg('--list') || '';
    console.log(`\nFile tree${path ? ` at ${path}` : ''}:`);
    console.log(JSON.stringify(await listFiles(cfg, token, path), null, 2));
    return;
  }

  const deletePath = arg('--delete');
  if (deletePath !== undefined) {
    if (!deletePath) throw new Error('--delete needs a file path, e.g. --delete model/old.xlsx');
    await deleteFile(cfg, token, deletePath);
    return;
  }

  const models = readdirSync(MODELS_DIR).filter((f) => f.endsWith('.xlsx'));
  if (models.length === 0) {
    console.error(`✗ No .xlsx models found in ${MODELS_DIR}`);
    process.exit(1);
  }

  const existing = new Set(
    (await listFiles(cfg, token, cfg.modelDir, 1))
      .filter((e) => e.objectType === 'file' && e.name)
      .map((e) => e.name!),
  );

  console.log(`Uploading ${models.length} model(s) to "${cfg.modelDir}/" (no deletions):`);
  for (const m of models) {
    await uploadFile(cfg, token, join(MODELS_DIR, m), cfg.modelDir, existing);
  }

  console.log('\nVerifying model directory:');
  console.log(JSON.stringify(await listFiles(cfg, token, cfg.modelDir, 1), null, 2));
  console.log('\nAll done ✓');
}

main().catch((err) => {
  console.error('\n✗ Deploy failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
