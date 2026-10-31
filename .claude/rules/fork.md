# Fork rules (mohan6623/t3code)

This checkout is the user's fork of T3 Code, not upstream. Read this before any change.

## Where things are

- Work folder on the main PC: `D:\Self\t3code-merge`, local branch `merge-for-push`.
- Remote branch: `custom/usage-badge` on `mohan6623/t3code` (the fork's default branch).
- A push to `custom/usage-badge` builds and publishes a new app update (`.github/workflows/fork-desktop.yml`, about 15 min). A daily job merges upstream nightlies into it.
- `D:\Self\t3code` is an old copy. Never edit or build there. Its `.t3` folder is only the test app's data.

## Rules

- Push only when the user says so. UI tweaks are batched and shown in the local test app first.
- Before a push: `git fetch origin custom/usage-badge` and rebase onto it. If `pnpm-lock.yaml` changed, run `pnpm install --frozen-lockfile`. Then run `pnpm typecheck` (0 errors). Push with `git push origin merge-for-push:custom/usage-badge`.
- Commit as `mohan6623 <mohanaprasath6623@gmail.com>`. Run commits with `KNIP_DISABLE_RAW_TRANSFER=1` (the pre-commit hook runs fmt, lint and knip).
- On Windows, write files with LF endings. `git show HEAD | grep -c $'\r'` must print 0.
- Never commit `.t3` or `routeTree.gen.ts`.
- Mark fork-only code with a `Fork:` comment, so upstream merges stay easy.
- Lint rules: no arbitrary Tailwind values (`[..]`), no native `title` attribute, JSX attribute comments as `//`.
- Run browser tests one file at a time.
- Keep upstream's UI labels. Explain confusing ones; do not rename them.
- Release notes use upstream's summary format, so the update popup reads them in order. Do not add install steps.

## Tools on the main PC

- The pnpm shim is broken. Use `node /c/Users/Mohan/AppData/Local/pnpm/.tools/pnpm/12.14.0/node_modules/pnpm/bin/pnpm.mjs`.
- Put `node_modules/.bin` on PATH. Run web tests with `cd apps/web && vp test run <file>`.
- Local test app: `D:\Self\t3code-build\perf\fast-desktop.sh build`, then `preview`, then `desktop`.
- "memory allocation of N bytes failed" in builds usually means the `C:` drive is full.
