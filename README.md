# Claude Code Sandbox

> Run [Claude Code](https://docs.anthropic.com/en/docs/claude-code) in an isolated Docker sandbox — safely, instantly, on any machine.

[![Docker Hub](https://img.shields.io/docker/pulls/spiriyu/claude-code-sandbox)](https://hub.docker.com/r/spiriyu/claude-code-sandbox)
[![Docker Image Size](https://img.shields.io/docker/image-size/spiriyu/claude-code-sandbox/latest)](https://hub.docker.com/r/spiriyu/claude-code-sandbox)
[![npm](https://img.shields.io/npm/v/@claude-code-sandbox/cli)](https://www.npmjs.com/package/@claude-code-sandbox/cli)

---

## Why This Project Exists

Claude Code is powerful — but running an AI agent that can execute arbitrary code directly on your machine carries real risk. One misunderstood prompt, one runaway loop, one accidental `rm -rf` can damage your system or leak credentials.

**Claude Code Sandbox solves this** by wrapping Claude Code in a Docker container with:

- **Isolation** — Claude Code runs inside a container, not on your host. Your system files, processes, and credentials are never exposed.
- **Clean environment** — Every session starts from a known-good image. No leftover state, no polluted PATH, no version conflicts.
- **Workspace mounting** — Your project directory is mounted at `/workspace`. Claude reads and writes your real files, but can't touch anything outside that directory.
- **No setup friction** — One CLI command handles the entire lifecycle: pull image, configure auth, start container, open shell.

---

## How Developers Benefit

| Problem                           | Without Claude Sandbox | With Claude Sandbox                  |
| --------------------------------- | ---------------------- | ------------------------------------ |
| AI agent modifies system files    | Direct risk            | Contained in Docker                  |
| Different Node/Python per project | Version conflicts      | Pick the right image tag             |
| Share Claude setup with team      | "Works on my machine"  | Reproducible image                   |
| Try Claude Code quickly           | Install + configure    | `npx @claude-code-sandbox/cli start` |
| Rotate credentials safely         | Stored in host shell   | Isolated per session                 |

---

## Quick Start

```bash
# 1. Install the CLI globally (or use npx)
npm install -g @claude-code-sandbox/cli

# 2. Set up credentials (one-time)
claude-code-sandbox auth setup

# 3. Start the sandbox in your project directory
cd my-project
claude-code-sandbox start

# 4. Attach to the Claude Code process
claude-code-sandbox attach

# 5. When done
claude-code-sandbox stop
```

Or use the interactive menu (no subcommand needed):

```bash
claude-code-sandbox
```

---

## CLI Commands

| Command                                        | Description                                         |
| ---------------------------------------------- | --------------------------------------------------- |
| `claude-code-sandbox`                          | Open interactive TUI menu                           |
| `claude-code-sandbox start`                    | Pull image (if needed) and start/resume a container |
| `claude-code-sandbox stop`                     | Stop the active container                           |
| `claude-code-sandbox start-all`                | Start all stopped containers                        |
| `claude-code-sandbox stop-all`                 | Stop all running containers                         |
| `claude-code-sandbox remove`                   | Remove a container from Docker and config           |
| `claude-code-sandbox attach`                   | Attach terminal to the Claude Code process          |
| `claude-code-sandbox shell`                    | Open a bash session inside the container            |
| `claude-code-sandbox ls`                       | List active containers                              |
| `claude-code-sandbox history`                  | List all containers including removed ones          |
| `claude-code-sandbox use [id]`                 | Set the active container for the current session    |
| `claude-code-sandbox auth setup`               | Interactive credential setup wizard                 |
| `claude-code-sandbox auth status`              | Show stored credentials                             |
| `claude-code-sandbox config list`              | Show all settings                                   |
| `claude-code-sandbox config get <key>`         | Get a single setting value                          |
| `claude-code-sandbox config set <key> <value>` | Override a setting                                  |
| `claude-code-sandbox config reset [key]`       | Reset one or all settings to defaults               |

Global options available on every command:

```
-w, --workspace <path>   Workspace directory (default: cwd)
--id <id>                Target a specific container by ID or short ID
--config-dir <path>      Config directory (default: ~/.claude-code-sandbox)
```

See [apps/cli/README.md](apps/cli/README.md) for the full CLI reference.

---

## Interactive Mode

Running `npx @claude-code-sandbox/cli` with no arguments opens a looping TUI menu:

```
  Claude Code Sandbox — Interactive Mode
  ──────────────────────────────────────

  ── Container Lifecycle ──
  > Start container
    Stop container
    ...
  ── Authentication ──
  > Auth setup wizard
    ...
    Exit
```

- Select an action with arrow keys and Enter
- Press **ESC** at any prompt to cancel and return to the menu
- Select **Exit** or press **Ctrl+C** to quit

---

## Authentication

You need one of:

| Method      | Variable                  | How to get                                                                         |
| ----------- | ------------------------- | ---------------------------------------------------------------------------------- |
| API Key     | `ANTHROPIC_API_KEY`       | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| OAuth Token | `CLAUDE_CODE_OAUTH_TOKEN` | Claude Pro/Max — run `claude setup-token` inside the container                     |

Run `claude-code-sandbox auth setup` for an interactive setup guide. Credentials are stored in `~/.claude-code-sandbox/.env` (chmod 600) and never written to the config store.

---

## Git Identity

To allow Claude to commit with your identity, configure git settings once:

```bash
claude-code-sandbox config set gitUserName "Your Name"
claude-code-sandbox config set gitUserEmail "you@example.com"
```

These are passed as environment variables to new containers, which apply them via `git config --global` at startup.

---

## Docker Image

The image (`spiriyu/claude-code-sandbox`) is built on **Debian 12 (Bookworm) slim** with:

- **Node.js** via nvm (default: v22)
- **Python** via pyenv (default: 3.13)
- **Claude Code CLI** (`@anthropic-ai/claude-code`, latest)
- **Dev tools**: git, vim, jq, ripgrep, fzf, tmux, tree, htop

### Using Specific Versions

```bash
# Node 20 + Python 3.12
docker run -it --rm \
  -e ANTHROPIC_API_KEY=your_key \
  -v $(pwd):/workspace \
  spiriyu/claude-code-sandbox:latest_node20_python3.12

# Or configure the CLI
claude-code-sandbox config set defaultTag latest_node20_python3.12
```

### Manual Docker Run

```bash
docker run -it --rm \
  -e ANTHROPIC_API_KEY=your_key \
  -v $(pwd):/workspace \
  spiriyu/claude-code-sandbox
```

---

## Repository Structure

This is a monorepo managed with [NX](https://nx.dev) (lightweight orchestration, no heavy plugins):

```
claude-code-sandbox/
├── apps/
│   ├── cli/          # @claude-code-sandbox/cli — npm CLI tool
│   └── docker/       # Docker image (Dockerfile, entrypoint, CI scripts)
├── libs/
│   └── shared/       # @claude-code-sandbox/shared — versions.json + TypeScript helpers
├── .github/
│   └── workflows/
│       └── docker-publish.yml   # Publishes to Docker Hub on git tag
├── archive/          # Historical planning docs (no longer active)
├── nx.json           # NX workspace config
├── package.json      # Root package with workspaces
└── tsconfig.base.json
```

### Key Design Decisions

- **`libs/shared/src/versions.json`** is the single source of truth for which Node.js and Python versions the image supports. Both the CLI defaults and the CI/CD build matrix read from this file.
- **NX** is used as a lightweight task runner with caching — each app keeps its own tooling (tsup, vitest, Docker). No NX plugins or generators needed.
- **dockerode** is used for Docker API communication, giving typed access to the Docker daemon without shelling out.

---

## Contributing

### Prerequisites

- Node.js ≥ 18
- npm ≥ 7 (for workspaces)
- Docker (for testing the image)

### Setup

```bash
git clone https://github.com/yar-on/claude-code-sandbox
cd claude-code-sandbox
npm install          # installs all workspace packages
```

### Development

```bash
# Build all
npm run build

# Test all
npm run test

# Or target a specific app
nx run cli:build
nx run cli:test
nx run docker:generate-matrix
```

### Adding Node/Python Versions

1. Edit `libs/shared/src/versions.json`
2. Verify: `RELEASE_VERSION=test node apps/docker/scripts/generate-matrix.js | jq .`
3. Commit and release

### Releasing

```bash
npm run release   # runs release-it → bumps version → tags → GitHub Release
```

The `v*` tag triggers `.github/workflows/docker-publish.yml` which builds and pushes all version combinations to Docker Hub.

Required GitHub secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`

---

## License

MIT © [yar-on](https://github.com/yar-on)
