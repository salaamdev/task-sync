# task-sync

Sync tasks across **Google Tasks**, **Microsoft To Do (Microsoft Graph)**, and an optional 3rd provider.

Currently implemented providers:

- Google Tasks (OAuth refresh-token)
- Microsoft To Do via Microsoft Graph (OAuth refresh-token)
- Habitica Todos (API token)

## Quickstart

### Requirements

- Node.js **>= 22**

### Install

```bash
npm install
```

### Build + run doctor

```bash
npm run build
node dist/cli.js doctor
```

### Run sync once

```bash
node dist/cli.js sync
```

### Polling mode

```bash
# every 5 minutes
node dist/cli.js sync --poll 5

# or env
export TASK_SYNC_POLL_INTERVAL_MINUTES=5
node dist/cli.js sync
```

### Dry-run

Dry-run still uses your configured providers, but **does not write** any changes.

```bash
node dist/cli.js sync --dry-run
```

## Configuration (.env)

Create a `.env.local` (recommended) or `.env`:

### Provider selection (2-3 providers)

```bash
TASK_SYNC_PROVIDER_A=google
TASK_SYNC_PROVIDER_B=microsoft
TASK_SYNC_PROVIDER_C=habitica   # optional
```

### State

```bash
TASK_SYNC_STATE_DIR=.task-sync
TASK_SYNC_LOG_LEVEL=info
```

### Google Tasks

```bash
TASK_SYNC_GOOGLE_CLIENT_ID=...
TASK_SYNC_GOOGLE_CLIENT_SECRET=...
TASK_SYNC_GOOGLE_REFRESH_TOKEN=...
TASK_SYNC_GOOGLE_TASKLIST_ID=@default   # optional
```

### Microsoft To Do (Graph)

```bash
TASK_SYNC_MS_CLIENT_ID=...
TASK_SYNC_MS_TENANT_ID=common   # or your tenant id
TASK_SYNC_MS_REFRESH_TOKEN=...
TASK_SYNC_MS_LIST_ID=...        # optional (defaults to first list)
```

### Habitica

```bash
TASK_SYNC_HABITICA_USER_ID=...
TASK_SYNC_HABITICA_API_TOKEN=...
```

Run:

```bash
task-sync doctor
```

to see what’s missing.

## OAuth helper scripts (refresh tokens)

These scripts spin up a local HTTP callback server, print an auth URL, and on success print the refresh token.

### Google refresh token

1) Create OAuth credentials in Google Cloud Console:
- APIs & Services → Credentials
- Create Credentials → OAuth client ID
- Application type: **Desktop app** (recommended)
- Enable the **Google Tasks API** on the project

2) Set env vars and run:

```bash
export TASK_SYNC_GOOGLE_CLIENT_ID=...
export TASK_SYNC_GOOGLE_CLIENT_SECRET=...
npm run oauth:google
```

### Microsoft refresh token

1) Create an app registration in Azure:
- Azure Portal → App registrations → New registration
- Add a **redirect URI** (platform: *Mobile and desktop applications*):
  - `http://localhost:53683/callback`
- API permissions (Delegated):
  - `offline_access`
  - `User.Read`
  - `Tasks.ReadWrite`

2) Run:

```bash
export TASK_SYNC_MS_CLIENT_ID=...
export TASK_SYNC_MS_TENANT_ID=common
npm run oauth:microsoft
```

## Notes on Habitica mapping

Habitica tasks are synced as **Todos**.

- `Task.title` ↔ Habitica `text`
- `Task.notes` ↔ Habitica `notes` (human notes only)
- Extra fields are preserved by packing JSON into the Habitica `notes` field under a `--- task-sync ---` block.

## How state works

`task-sync` writes local state under:

- `.task-sync/state.json`

This includes:

- `lastSyncAt` watermark (ISO timestamp)
- `mappings`: links a canonical ID to provider IDs
- `tombstones`: prevents resurrecting completed/deleted tasks

Delete `.task-sync/` to reset sync state.

## Development

```bash
npm run dev -- doctor
npm run dev -- sync --dry-run
npm test
npm run lint
npm run typecheck
```

## License

MIT (see LICENSE)
