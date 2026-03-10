# @claude-code-sandbox/cli

CLI for managing [Claude Code](https://docs.anthropic.com/en/docs/claude-code) Docker sandbox containers.

[![npm](https://img.shields.io/npm/v/@claude-code-sandbox/cli)](https://www.npmjs.com/package/@claude-code-sandbox/cli)
[![Changelog](https://img.shields.io/badge/changelog-view-blue)](CHANGELOG.md)

---

## Installation

```bash
npm install -g @claude-code-sandbox/cli
```

Or run without installing:

```bash
npx @claude-code-sandbox/cli <command>
```

---

## Global Options

These options are available on every command:

| Option                   | Description                                          | Default                   |
| ------------------------ | ---------------------------------------------------- | ------------------------- |
| `-w, --workspace <path>` | Workspace directory                                  | current working directory |
| `--id <id>`              | Target a specific container by ID or 8-char short ID | —                         |
| `--config-dir <path>`    | Config directory                                     | `~/.claude-code-sandbox`  |
| `-v, --version`          | Print version                                        | —                         |
| `-h, --help`             | Show help                                            | —                         |

Environment variable overrides:

| Variable                         | Overrides      |
| -------------------------------- | -------------- |
| `CLAUDE_CODE_SANDBOX_CONFIG_DIR` | `--config-dir` |
| `CLAUDE_CODE_SANDBOX_WORKSPACE`  | `--workspace`  |

---

## Interactive Mode

Running the CLI with no subcommand opens a looping TUI menu:

```bash
claude-code-sandbox
```

```
  Claude Code Sandbox — Interactive Mode
  ──────────────────────────────────────

  ── Container Lifecycle ──
  > Start container
    Stop container
    Start all stopped containers
    Stop all running containers
    Remove a container

  ── Attach & Shell ──
  > Attach to Claude Code process
    Open bash session

  ── Inspect ──
  > List containers
    List all history (including removed)

  ── Selection ──
  > Select active container
    Clear active container selection

  ── Authentication ──
  > Auth setup wizard
    Auth status

  ── Configuration ──
  > List settings
    Get a setting
    Set a setting
    Reset settings

  ── ──
  > Show help
    Exit
```

**Navigation:**

- Arrow keys / Enter to select
- **ESC** at any prompt to cancel and return to the menu without performing any action
- **Ctrl+C** or select **Exit** to quit

After each command runs, output is shown and the menu waits for a keypress before reappearing, so you can read the result before the display resets.

---

## Commands

### `start`

Start or resume a container for the current workspace.

```bash
claude-code-sandbox start [options]
```

| Option            | Description                                                |
| ----------------- | ---------------------------------------------------------- |
| `--image <image>` | Docker image name (default: `spiriyu/claude-code-sandbox`) |
| `--tag <tag>`     | Docker image tag (default: `latest`)                       |
| `--pull`          | Force pull image before starting                           |

- If a container already exists for the workspace, it is resumed instead of creating a new one.
- If multiple containers match, an interactive picker is shown.
- If no image is present locally, it is pulled automatically (unless `--pull` is also omitted).

```bash
# Start for current directory
npx @claude-code-sandbox/cli start

# Start with a specific image version
npx @claude-code-sandbox/cli start --tag latest_node20_python3.12

# Force re-pull then start
npx @claude-code-sandbox/cli start --pull
```

---

### `stop`

Stop the active container.

```bash
npx @claude-code-sandbox/cli stop [options]
```

| Option             | Description                                        |
| ------------------ | -------------------------------------------------- |
| `--timeout <secs>` | Seconds to wait before force-killing (default: 10) |

Container selection order: `--id` → `currentContainerId` (set via `use`) → workspace match → interactive picker.

---

### `start-all`

Start all stopped containers (does not create new ones).

```bash
npx @claude-code-sandbox/cli start-all
```

---

### `stop-all`

Stop all currently running containers.

```bash
npx @claude-code-sandbox/cli stop-all [options]
```

| Option             | Description                                                       |
| ------------------ | ----------------------------------------------------------------- |
| `--timeout <secs>` | Seconds to wait before force-killing each container (default: 10) |

---

### `remove`

Remove a container from Docker and mark it removed in the config.

```bash
npx @claude-code-sandbox/cli remove [options]
```

| Option    | Description              |
| --------- | ------------------------ |
| `--force` | Skip confirmation prompt |

Container selection: same resolution order as `stop`. Prompts for confirmation unless `--force`.

---

### `attach`

Attach your terminal to the container's main process (Claude Code).

```bash
npx @claude-code-sandbox/cli attach
```

Connects to the running Claude Code process via a raw TTY stream. Terminal resize events are forwarded. Detach with the container's escape sequence or by stopping Claude Code.

---

### `shell`

Open a new login bash session inside the container.

```bash
npx @claude-code-sandbox/cli shell
```

Opens a fresh `bash -l` session via `docker exec`. The main Claude Code process keeps running in parallel.

---

### `ls`

List all active (non-removed) containers.

```bash
npx @claude-code-sandbox/cli ls [options]
```

| Option   | Description    |
| -------- | -------------- |
| `--json` | Output as JSON |

Shows ID, name, workspace, status, and time since last update.

---

### `history`

List all containers including removed ones.

```bash
npx @claude-code-sandbox/cli history [options]
```

| Option   | Description    |
| -------- | -------------- |
| `--json` | Output as JSON |

Reads from config only (no Docker check required). Useful for auditing past sessions.

---

### `use`

Set the active container (persists until changed or cleared).

```bash
npx @claude-code-sandbox/cli use [id]
npx @claude-code-sandbox/cli use --clear
```

| Option / Argument | Description                                 |
| ----------------- | ------------------------------------------- |
| `[id]`            | Container ID or short ID to select directly |
| `--clear`         | Clear the current selection                 |

When no `[id]` is given, an interactive picker shows all Docker-verified containers. The selected container becomes the target for `stop`, `attach`, `shell`, and `remove` until changed.

---

### `auth setup`

Interactive credential setup wizard.

```bash
npx @claude-code-sandbox/cli auth setup
```

Guides you through choosing an auth method and storing credentials in `~/.claude-code-sandbox/.env` (chmod 600). Credentials are **never** written to the config store.

**Supported methods:**

| Method      | Variable                  | How to get                                                                         |
| ----------- | ------------------------- | ---------------------------------------------------------------------------------- |
| API Key     | `ANTHROPIC_API_KEY`       | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| OAuth Token | `CLAUDE_CODE_OAUTH_TOKEN` | Claude Pro/Max — run `claude setup-token`                                          |

Press **ESC** at any prompt during setup to cancel and return without saving.

---

### `auth status`

Show currently stored credentials.

```bash
npx @claude-code-sandbox/cli auth status
```

Displays which credential is set and how it will be passed to new containers. Does not show the credential value.

---

### `config list`

Show all settings.

```bash
npx @claude-code-sandbox/cli config list [--json]
```

---

### `config get`

Get a single setting value.

```bash
npx @claude-code-sandbox/cli config get <key>
```

---

### `config set`

Set a setting value.

```bash
npx @claude-code-sandbox/cli config set <key> <value>
```

**Available settings:**

| Key            | Description                                                 | Default                       |
| -------------- | ----------------------------------------------------------- | ----------------------------- |
| `defaultImage` | Docker image name                                           | `spiriyu/claude-code-sandbox` |
| `defaultTag`   | Docker image tag                                            | `latest`                      |
| `authMethod`   | Preferred auth method (`api_key`, `oauth_token`, or `null`) | `null`                        |
| `gitUserName`  | Git user name passed into containers                        | `null`                        |
| `gitUserEmail` | Git user email passed into containers                       | `null`                        |

```bash
# Use a different default image tag
npx @claude-code-sandbox/cli config set defaultTag 1.0.0_node20_python3.12

# Set git identity for commits inside containers
npx @claude-code-sandbox/cli config set gitUserName "Your Name"
npx @claude-code-sandbox/cli config set gitUserEmail "you@example.com"
```

---

### `config reset`

Reset one or all settings to their defaults.

```bash
# Reset everything
npx @claude-code-sandbox/cli config reset

# Reset a specific key
npx @claude-code-sandbox/cli config reset defaultTag
```

---

## Container Selection

Most commands that target a specific container resolve it in this order:

1. `--id <id>` flag (exact UUID or 8-char short ID)
2. `currentContainerId` set via `use`
3. Workspace match — containers whose `workspace` field equals the resolved workspace path
4. If multiple workspace matches: interactive picker
5. If nothing matches: error

---

## Config Store

Settings are stored in `~/.claude-code-sandbox/config.json`. Container records are stored alongside settings in the same file.

Credentials are stored separately in `~/.claude-code-sandbox/.env` and are never included in the config file.

The `--config-dir` flag (or `CLAUDE_CODE_SANDBOX_CONFIG_DIR` env var) overrides the default location. Each container's Claude state is persisted under `<config-dir>/containers/<short-id>/.claude/`.

---

## Git Identity in Containers

Set once:

```bash
npx @claude-code-sandbox/cli config set gitUserName "Your Name"
npx @claude-code-sandbox/cli config set gitUserEmail "you@example.com"
```

When a new container is created, these values are passed as `GIT_USER_NAME` and `GIT_USER_EMAIL` environment variables. The container's entrypoint applies them via:

```bash
git config --global user.name "$GIT_USER_NAME"
git config --global user.email "$GIT_USER_EMAIL"
```

This lets Claude commit changes under your identity without any manual configuration inside the container.

---
