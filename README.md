# task-sync

Sync tasks between **Google Tasks** and **Microsoft To Do**.

Works as a CLI for power users, or as a self-hosted web UI for everyone else.

## Features

- **Bidirectional sync** between Google Tasks and Microsoft To Do
- **Field-level conflict resolution** (last-write-wins per field)
- **Cold-start matching** — deduplicates tasks on first sync by title + notes
- **Delete propagation** — tombstones prevent resurrecting deleted tasks
- **Dry-run mode** — preview changes before applying
- **Polling mode** — auto-sync on an interval
- **Web UI** — connect accounts with OAuth, sync with one click
- **Self-hosted** — your data stays on your machine

## Requirements

- Node.js **>= 22**

## Quick Start — Web UI

The web UI lets you connect your Google and Microsoft accounts via OAuth
and sync tasks with one click. No manual token management needed.

### 1. Set up OAuth apps

**Google Tasks:**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or select existing)
3. Enable the **Google Tasks API**
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**
5. Application type: **Web application**
6. Add authorized redirect URI: `http://localhost:3000/api/auth/google/callback`
7. Copy the **Client ID** and **Client Secret**

**Microsoft To Do:**

1. Go to [Azure Portal → App registrations](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. **New registration**
3. Supported account types: **Personal Microsoft accounts only** (or multi-tenant)
4. Redirect URI (Web): `http://localhost:3000/api/auth/microsoft/callback`
5. Go to **API permissions** → Add: `Tasks.ReadWrite`, `User.Read`, `offline_access`
6. Copy the **Application (client) ID**

### 2. Configure

Create `.env.local` in the project root:

```bash
TASK_SYNC_PROVIDER_A=google
TASK_SYNC_PROVIDER_B=microsoft

TASK_SYNC_GOOGLE_CLIENT_ID=your-google-client-id
TASK_SYNC_GOOGLE_CLIENT_SECRET=your-google-client-secret

TASK_SYNC_MS_CLIENT_ID=your-microsoft-client-id
TASK_SYNC_MS_TENANT_ID=consumers
```

### 3. Install and run

```bash
npm install
npm run web:install
npm run web:dev
```

Open [http://localhost:3000](http://localhost:3000). Click **Connect** for each
provider, approve the OAuth consent, then hit **Sync Now**.

### Production

```bash
npm run web:build
npm run web:start
```

## Quick Start — CLI

For headless environments, scripts, or cron jobs.

### 1. Install

```bash
npm install
npm run build
```

### 2. Get refresh tokens

You need refresh tokens for each provider. Helper scripts are included:

```bash
# Google
export TASK_SYNC_GOOGLE_CLIENT_ID=...
export TASK_SYNC_GOOGLE_CLIENT_SECRET=...
npm run oauth:google

# Microsoft
export TASK_SYNC_MS_CLIENT_ID=...
export TASK_SYNC_MS_TENANT_ID=consumers
npm run oauth:microsoft
```

Each script opens a browser for consent, then prints the refresh token.

### 3. Configure

Add all tokens to `.env.local`:

```bash
TASK_SYNC_PROVIDER_A=google
TASK_SYNC_PROVIDER_B=microsoft

TASK_SYNC_GOOGLE_CLIENT_ID=...
TASK_SYNC_GOOGLE_CLIENT_SECRET=...
TASK_SYNC_GOOGLE_REFRESH_TOKEN=...

TASK_SYNC_MS_CLIENT_ID=...
TASK_SYNC_MS_TENANT_ID=consumers
TASK_SYNC_MS_REFRESH_TOKEN=...
```

### 4. Run

```bash
# Check config
node dist/cli.js doctor

# Sync once
node dist/cli.js sync

# Dry-run (preview changes)
node dist/cli.js sync --dry-run

# Auto-sync every 5 minutes
node dist/cli.js sync --poll 5

# JSON output (for scripts)
node dist/cli.js sync --format json
```

## Configuration

All configuration is via environment variables. Create a `.env.local` file in the
project root.

### Required

| Variable | Description |
|---|---|
| `TASK_SYNC_PROVIDER_A` | First provider (`google` or `microsoft`) |
| `TASK_SYNC_PROVIDER_B` | Second provider (`google` or `microsoft`) |
| `TASK_SYNC_GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `TASK_SYNC_GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `TASK_SYNC_MS_CLIENT_ID` | Microsoft app (client) ID |

### Optional

| Variable | Default | Description |
|---|---|---|
| `TASK_SYNC_MS_TENANT_ID` | `consumers` | Azure tenant ID |
| `TASK_SYNC_GOOGLE_REFRESH_TOKEN` | — | CLI only: Google refresh token |
| `TASK_SYNC_MS_REFRESH_TOKEN` | — | CLI only: Microsoft refresh token |
| `TASK_SYNC_GOOGLE_TASKLIST_ID` | `@default` | Google task list to sync |
| `TASK_SYNC_MS_LIST_ID` | First list | Microsoft To Do list to sync |
| `TASK_SYNC_STATE_DIR` | `.task-sync` | Directory for sync state |
| `TASK_SYNC_LOG_LEVEL` | `info` | Log level: `silent\|error\|warn\|info\|debug` |
| `TASK_SYNC_POLL_INTERVAL_MINUTES` | — | Auto-sync interval (CLI only) |
| `TASK_SYNC_MODE` | `bidirectional` | Sync mode: `bidirectional\|a-to-b-only\|mirror` |
| `TASK_SYNC_TOMBSTONE_TTL_DAYS` | `30` | How long to keep delete tombstones |

## How It Works

### Sync State

`task-sync` stores local state in `.task-sync/state.json`:

- **`lastSyncAt`** — watermark timestamp for incremental sync
- **`mappings`** — links canonical task IDs to provider-specific IDs
- **`tombstones`** — prevents resurrecting deleted tasks

Delete `.task-sync/` to reset all sync state.

### Web UI Token Storage

The web UI stores OAuth refresh tokens in `.task-sync/tokens.json`. These
tokens never leave your machine. The web server uses them to authenticate
with Google and Microsoft APIs on your behalf during sync.

### Sync Algorithm

1. **Fetch** tasks from all providers (incremental via `lastSyncAt`)
2. **Cold-start match** — on first run, match tasks by title+notes to avoid duplicates
3. **Tombstone check** — skip tasks that were intentionally deleted
4. **Field-level diff** — compare each field (title, notes, status, due date) against the last canonical snapshot
5. **Conflict resolution** — if multiple providers changed the same field, last-write-wins
6. **Fan out** — apply the resolved canonical state to all providers

## Project Structure

```
task-sync/
├── src/                    # Core engine + CLI
│   ├── cli.ts              # CLI entry point
│   ├── sync/engine.ts      # Sync algorithm
│   ├── providers/          # Google, Microsoft, Mock providers
│   ├── store/              # State persistence (JSON)
│   ├── model.ts            # Task data model
│   └── ...
├── web/                    # Next.js web UI
│   ├── app/                # Pages + API routes
│   │   ├── page.tsx        # Dashboard
│   │   └── api/            # OAuth + sync endpoints
│   ├── components/         # React components (shadcn/ui)
│   └── lib/                # Env loading, token storage
├── test/                   # Vitest tests
├── scripts/                # OAuth helper scripts
└── .env.local              # Your credentials (git-ignored)
```

## Development

```bash
# Run CLI in dev mode
npm run dev -- doctor
npm run dev -- sync --dry-run

# Run web in dev mode (builds core first)
npm run web:dev

# Tests
npm test

# Lint & typecheck
npm run lint
npm run typecheck
```

## Security Notes

- **Self-hosted only** — this project is designed to run on your own machine or server.
- **No telemetry** — no data is sent anywhere except Google and Microsoft APIs.
- **Tokens on disk** — refresh tokens are stored in `.task-sync/tokens.json`. Treat this file like a password.
- **No auth on the web UI** — if you expose the web UI to the internet, put it behind a reverse proxy with authentication (e.g., Caddy, nginx + basic auth, Cloudflare Tunnel).

## License

MIT (see [LICENSE](LICENSE))
