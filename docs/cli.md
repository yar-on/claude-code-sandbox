# CLI App — @claude-code-sandbox/cli

Source: `apps/cli/`
Package: `@claude-code-sandbox/cli`
Binary: `claude-code-sandbox`

## Development Commands

```bash
cd apps/cli

npm run build      # tsup → dist/  (ESM bundle with shebang)
npm run dev        # tsup --watch  (rebuilds on change)
npm run test       # vitest run    (63 tests)
npm run lint       # tsc --noEmit  (type-check only, no emit)
```

Via NX from workspace root:

```bash
nx run cli:build
nx run cli:test
nx run cli:lint
```

## Source Layout

```
apps/cli/src/
├── cli.ts                  # Entry point — registers all commands, prints version
├── commands/
│   ├── start.ts            # claude-code-sandbox start
│   ├── stop.ts             # claude-code-sandbox stop
│   ├── start-all.ts        # claude-code-sandbox start-all
│   ├── stop-all.ts         # claude-code-sandbox stop-all
│   ├── remove.ts           # claude-code-sandbox remove
│   ├── remove-all.ts       # claude-code-sandbox remove-all
│   ├── status.ts           # claude-code-sandbox status
│   ├── shell.ts            # claude-code-sandbox shell
│   ├── attach.ts           # claude-code-sandbox attach
│   ├── ls.ts               # claude-code-sandbox ls
│   ├── history.ts          # claude-code-sandbox history
│   ├── use.ts              # claude-code-sandbox use
│   ├── auth.ts             # claude-code-sandbox auth (+ auth setup, auth status)
│   └── config.ts           # claude-code-sandbox config (+ list, get, set, reset)
├── lib/
│   ├── constants.ts        # App-wide constants (image name, auth methods, token prefixes)
│   ├── config.ts           # Persistent config store via `conf`
│   └── docker.ts           # Docker helpers (spawnSync wrappers)
└── utils/
    └── logger.ts           # chalk-coloured logger + ora spinner factory
```

## Commands Reference

### `claude-code-sandbox start`

Pulls the image (if not cached or `--pull`), resolves auth credentials, then runs the container.

```
Options:
  -w, --workspace <path>   Workspace directory to mount (default: cwd)
  --pull                   Force pull the latest image before starting
  -d, --detach             Run container in the background
```

Flow:

1. Check Docker is installed and running
2. Check container isn't already running
3. Pull image if missing or `--pull` specified
4. Resolve auth (env vars → `~/.claude-code-sandbox/.env`) — exit if none found
5. `docker run --name <container> --rm [-d] -v <workspace>:/workspace -e <auth> <image>:<tag>`

### `claude-code-sandbox stop`

```
Options:
  --rm   Remove the container after stopping
```

### `claude-code-sandbox start-all`

Starts all stopped containers. Does not create new ones.

### `claude-code-sandbox stop-all`

Stops all running containers.

### `claude-code-sandbox remove`

Removes a single container from Docker (stops it first if running). The container is preserved in history.

```
Options:
  -f, --force   Skip confirmation prompt
```

### `claude-code-sandbox remove-all`

Removes **all** containers from Docker (stops running ones first). Each container is preserved in history. Displays a list of all containers that will be removed and requires confirmation before proceeding — this action cannot be undone.

```
Options:
  -f, --force   Skip confirmation prompt
```

### `claude-code-sandbox status`

Inspects the container and prints state, image, uptime, and workspace mount.

```
Options:
  --json   Machine-readable JSON output
```

Output fields: `exists`, `running`, `name`, `image`, `status`, `uptime`, `workspaceMount`

### `claude-code-sandbox shell`

Runs `docker exec -it <container> bash -l`. If the container isn't running, offers to start it.

### `claude-code-sandbox auth`

Interactive wizard. Sub-commands:

- `auth` / `auth setup` — guides through API Key or OAuth Token setup
- `auth status` — shows which credential is active and where it's stored

See [auth.md](./auth.md) for full details on credential storage and resolution.

### `claude-code-sandbox config`

Manages the persistent config store at `~/.claude-code-sandbox/config.json` via the `conf` library.

Sub-commands: `list`, `get <key>`, `set <key> <value>`, `reset [key]`

Config keys:

| Key             | Default                       | Description                            |
| --------------- | ----------------------------- | -------------------------------------- |
| `imageName`     | `spiriyu/claude-code-sandbox` | Docker Hub image                       |
| `imageTag`      | `latest`                      | Image tag                              |
| `containerName` | `claude-code-sandbox`         | Container name for `docker run --name` |
| `workspacePath` | `process.cwd()` at startup    | Default workspace mount                |
| `authMethod`    | `null`                        | Set by `auth` wizard for reference     |
| `defaultModel`  | `null`                        | Reserved for future use                |

## Key Modules

### `lib/constants.ts`

Imports `DEFAULT_NODE_VERSION` and `DEFAULT_PYTHON_VERSION` from `@claude-code-sandbox/shared` so they always reflect the highest versions in `libs/shared/src/versions.json`.

Static constants defined here:

- `DEFAULT_IMAGE = 'spiriyu/claude-code-sandbox'`
- `DEFAULT_IMAGE_TAG = 'latest'`
- `DEFAULT_CONTAINER_NAME = 'claude-code-sandbox'`
- `AUTH_METHODS` — `'api_key'` | `'oauth_token'`
- `TOKEN_PREFIXES` — `'sk-ant-api03-'` | `'sk-ant-oat01-'`

### `lib/docker.ts`

All Docker interactions. Every function uses `spawnSync('docker', args)` — no Docker SDK.

Key exports:

- `isDockerInstalled()` — checks `docker --version`
- `isDockerRunning()` — checks `docker info`
- `getContainerStatus(name)` → `ContainerStatus`
- `pullImage(image, tag)` → `boolean`
- `buildRunArgs(opts)` → `string[]` (testable, pure function)
- `runContainer(opts)` → `boolean`
- `stopContainer(name)` → `boolean`
- `execInContainer(name, cmd)` — used by `shell` command
- `formatUptime(since: Date)` → human string

### `lib/config.ts`

Thin wrapper around `conf` that enforces the `ConfigSchema` type. Exposes:

- `config.get(key)` / `config.set(key, value)` / `config.getAll()` / `config.reset([key])`
- `config.validKeys` — array of known keys (used for input validation in `config` command)
- `config.path` — filesystem path to the JSON file

### `utils/logger.ts`

- `logger.info/success/warn/error(msg)` — chalk-coloured prefix symbols
- `logger.line()` — horizontal rule
- `logger.blank()` — empty line
- `spinner(text)` — returns an `ora` spinner instance

## Build Output

tsup bundles `src/cli.ts` into a single `dist/cli.mjs` (ESM) with the `#!/usr/bin/env node` shebang prepended. Shared library code is inlined into the bundle at build time — the published npm package has no dependency on the monorepo.

The `bin` field in `package.json` points to `./dist/cli.js` (npm resolves `.mjs` automatically when `type: module` is absent from the dist — note tsup outputs `.mjs` but package.json uses `.js` suffix; npm handles this correctly).

## Adding a New Command

1. Create `apps/cli/src/commands/<name>.ts` — export `make<Name>Command(): Command`
2. Import and register in `apps/cli/src/cli.ts`: `program.addCommand(make<Name>Command())`
3. Add tests in `apps/cli/src/commands/<name>.test.ts` or `apps/cli/test/`
