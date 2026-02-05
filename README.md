# task-sync

Sync tasks between **Microsoft To Do (Microsoft Graph)** and **Google Tasks**.

This repo currently contains a solid **MVP scaffolding**:

- A working CLI (`task-sync`) with:
  - `task-sync doctor` → checks config/env
  - `task-sync sync --dry-run` → runs the sync engine using **mock providers** (no API keys required)
  - `task-sync sync` → intended for real providers (currently scaffolded; will error with clear instructions)
- A minimal sync engine:
  - Canonical `Task` model
  - JSON state store under `.task-sync/state.json`
  - Mapping between provider IDs
  - Conflict policy: **last-write-wins** (by `updatedAt`)
  - “Zombie prevention”: completed/deleted tasks produce **tombstones** to avoid resurrecting them later
- Unit tests (Vitest)

## MVP scope (what works today)

✅ Works:

- Project builds (`npm run build`)
- Tests pass (`npm test`)
- Dry-run sync with mock providers (`task-sync sync --dry-run`)
- State store + mapping + tombstones logic

🚧 Not yet implemented (by design for this MVP):

- Real Google Tasks API calls
- Real Microsoft Graph API calls
- OAuth flows / token refresh

Those are intentionally left as **scaffolds** so you can add keys/tokens when ready.

## Quickstart

### Requirements

- Node.js **>= 22**

### Install

```bash
npm install
```

### Run health check

```bash
npm run build
node dist/cli.js doctor
# or after global install: task-sync doctor
```

### Run dry-run sync (no API keys)

```bash
npm run build
node dist/cli.js sync --dry-run
```

You should see a JSON report describing the actions the engine would take.

## Configuration (for when real providers are implemented)

Set these env vars (placeholders for next steps):

### Provider selection

- `TASK_SYNC_PROVIDER_A` = `google` | `microsoft`
- `TASK_SYNC_PROVIDER_B` = `google` | `microsoft`

### Google Tasks (scaffold)

- `TASK_SYNC_GOOGLE_CLIENT_ID`
- `TASK_SYNC_GOOGLE_CLIENT_SECRET`
- `TASK_SYNC_GOOGLE_REFRESH_TOKEN`
- `TASK_SYNC_GOOGLE_TASKLIST_ID` (optional; defaults to `@default`)

### Microsoft Graph / To Do (scaffold)

- `TASK_SYNC_MS_CLIENT_ID`
- `TASK_SYNC_MS_TENANT_ID`
- `TASK_SYNC_MS_REFRESH_TOKEN`
- `TASK_SYNC_MS_LIST_ID` (optional)

Run:

```bash
task-sync doctor
```

to see what’s missing.

## How state works (.task-sync/)

`task-sync` writes local state under:

- `.task-sync/state.json`

This includes:

- `lastSyncAt` watermark (ISO timestamp)
- `mappings`: links a canonical ID to provider IDs
- `tombstones`: prevents resurrecting completed/deleted tasks

You can delete `.task-sync/` to reset state.

## Development

```bash
npm run dev -- doctor
npm run dev -- sync --dry-run
npm test
npm run lint
npm run typecheck
```

## Next steps (planned)

- Implement GoogleTasksProvider using Google Tasks API
- Implement MicrosoftTodoProvider using Microsoft Graph
- Add real delta queries (list only changed tasks since watermark)
- Improve conflict handling:
  - per-field merge strategies
  - better deletion semantics
- Add a persistent DB store option (SQLite)

## License

MIT (see LICENSE)
