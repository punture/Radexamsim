# Private test copy in GitHub Codespaces

> **Status, 2026-11-17.** Run in a real codespace (2-core, US East). Checked there: setup, the app running in a terminal, the private site behind GitHub sign-in, testing mode, and a typed practice station over `wss://<site>/ws` (the examiner's questions arrived). Two fixes came out of that run (the app now runs from `postAttachCommand`, and `setup.sh` creates the database role); the role step was checked by re-running `setup.sh` in that codespace, not yet in a new one. Later the codespace stopped after its idle timeout; when it was reopened (in a second browser, which asked for Workspace Trust again), the app started by itself from `postAttachCommand` and reported `API ready`. Model-assessed results were not seen there: at the time, Google answered `gemini-4-hydrogen` requests with HTTP 503 ("currently experiencing high demand"), so the examiner used its scripted fallback and the assessment job kept retrying.

A codespace runs the development setup on GitHub's machines instead of the owner's computer: PostgreSQL, the API, the worker and the website. It uses the fictional fixtures, testing mode and, optionally, Gemini on a free-tier key. It is a private test copy, not staging or production; those are planned in [DEPLOYMENT.md](DEPLOYMENT.md).

## Rules

- **Fictional fixtures only.** Never import, ingest or upload real cases, quarantine material, or the owner computer's database or case storage. Intake stays on the owner's computer.
- **Keep port 3000 private.** Testing mode signs in whoever reaches the site as the test owner. Never set the port to Public and never share its address. GitHub opens a private port only for the codespace's owner, after GitHub sign-in.
- **The Gemini key is a Codespaces secret** that the owner enters on GitHub. It is never written to a file in the codespace, and `LLM_FIXTURES_ONLY=true` is always set with it.

## What it costs

GitHub Free personal accounts include, each month, 120 core hours (60 hours on the 2-core machine) and 15 GB-month of storage ([GitHub docs](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces), checked 2026-11-17). Without a payment method on the account, use beyond that is blocked, not charged. With a payment method, set a Codespaces budget of $0 in the account's billing settings.

- Choose the 2-core machine. Larger machines use the hours 2 to 16 times faster.
- Hours count only while the codespace runs. A stopped codespace still uses storage. Delete it when you no longer need it; a new one sets itself up again.

## First time

1. Optional, for model-assessed results: on GitHub, **Settings → Codespaces → Secrets → New secret**. Name `GEMINI_API_KEY` (`GEMINI` also works), value the free-tier key. Under **Repository access**, select this repository: a secret with no repository access never reaches a codespace. Without it, results come from the labelled development baseline assessor.
2. On the repository page: **Code → Codespaces → … → New with options**. Choose the branch to test and the **2-core** machine, then create it.
3. Setup runs by itself (`setup.sh`: PostgreSQL 16, pnpm and the packages; several minutes the first time).
4. If the editor asks whether you trust the authors of the files in this folder, choose **Trust Folder & Continue**. The app runs in a terminal, which Restricted Mode does not allow. Each browser asks once, so a second browser or device asks again.
5. `start.sh` then runs the app in a terminal; it is ready when the log shows `API ready` and Next.js `Ready`. Open the site from the **Ports** tab: port 3000, then **Open in Browser**. GitHub asks you to sign in to GitHub the first time.

## Everyday use

- **Start:** github.com/codespaces → the codespace → Open. The app starts in a terminal when the editor opens.
- **Stay awake while testing:** keep the codespace's editor tab open. The app runs in its terminal, and GitHub counts terminal output as activity; traffic to the site alone does not count. Once activity ends, the codespace stops after the idle timeout: 30 minutes by default, adjustable from 5 to 240 minutes under Settings → Codespaces. GitHub also stops any codespace after 12 hours.
- **Stop:** close the tabs and let it time out, or github.com/codespaces → … → Stop codespace. Ctrl+C in the app's terminal stops only the app. A station in progress when the app stops is paused. Reopened soon enough, it resumes; otherwise it is invalidated and its minutes are credited back ([DEPLOYMENT.md](DEPLOYMENT.md) §3.2).
- **Log:** the app's terminal, also saved to `var/log/codespace-dev.log`.
- **New commits:** the codespace has its own clone. Run `git pull` in its terminal, then stop and start the codespace. After a change to `.devcontainer/`, use **Codespaces: Rebuild Container** instead.
- **A secret added or changed later** takes effect after the codespace is stopped and started.

## How it is wired

| File | What it does |
|---|---|
| `.devcontainer/devcontainer.json` | Image `mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm` (Node 22, Debian 12). Runs the two scripts below. Labels port 3000 and ignores every other port, so the API (4000) and PostgreSQL (5432) are not forwarded. |
| `.devcontainer/setup.sh` | Once, at creation (`postCreateCommand`): PostgreSQL 16 from the PostgreSQL project's Debian repository, pnpm at the version pinned in `package.json`, then `pnpm install --frozen-lockfile`. |
| `.devcontainer/start.sh` | Whenever the editor connects (`postAttachCommand`): writes `.env`, then runs `scripts/dev.sh` in the terminal (database, migrations, seed, API, worker, website), or follows the log if the app is already running. The `.env` starts with `# Generated by .devcontainer/start.sh` and is rewritten each time; delete that line to keep your own edits. |

The app does not run from `postStartCommand`: Codespaces stops the processes such a command leaves in the background. Seen on 2026-11-17: an app started in the background that way printed nothing, and PostgreSQL was never started.

The browser reaches the API only through the website. `/api/*` is rewritten as on a laptop. The live-examination WebSocket uses `wss://<site>/ws`, which the Next.js server forwards to the API (`apps/web/next.config.ts`), so `.env` sets `PUBLIC_API_WS_URL` and `NEXT_PUBLIC_API_WS_URL` to the site's own address. `PUBLIC_WEB_ORIGIN` holds the same address; the Next.js dev server also uses it to accept requests for its own resources (hot reload) from that host (`allowedDevOrigins`).
