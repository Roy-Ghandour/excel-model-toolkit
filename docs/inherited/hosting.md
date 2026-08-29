# Hosting

> **Status:** decided 2026-07-25. Everything runs on free tiers with no credit card
> and no trial clocks. Related: `design.md` (architecture), `mvp-findings.md` (Forio I/O).

---

## 1. The stack

| Layer                                   | Service                | Why                                                                                                                                                                                      |
| --------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend                                | **Cloudflare Pages**   | Free static/SPA hosting, same vendor as the backend.                                                                                                                                     |
| Backend                                 | **Cloudflare Workers** | Free tier, co-located with the database (no network hop to D1).                                                                                                                          |
| Database                                | **Cloudflare D1**      | Free SQLite-based relational DB, bound directly into the Worker.                                                                                                                         |
| Model file storage + simulation runtime | **Forio Epicenter**    | The `.xlsx` versions live and run on Forio — we already need it, so it doubles as blob storage for model files. See `references/mvp-archive/tools/deploy.ts` for the proven upload path. |

One vendor (Cloudflare) for everything except Forio. Big binaries (the Excel
files) never touch D1 — only relational data does: projects, model-version
metadata, runs, base runs, action history.

## 2. Deployment shape

- **Pages** serves the built frontend.
- A **Worker** exposes the backend API; D1 is attached as a binding in
  `wrangler.toml`/`wrangler.jsonc` (one line of config, no connection strings).
- The Worker talks to **Forio** for model upload, deploy, and simulation runs.
- Secrets (Forio credentials) go in Worker secrets (`wrangler secret put`),
  mirroring the local git-ignored `.env` convention.
