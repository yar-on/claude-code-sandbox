# Docker Image Overview

## Supported tags and respective `Dockerfile` links

> Tags are prefixed with the release version at publish time (e.g. `0.4.0_node24_python3.13`). See [Build Matrix & Tagging](#build-matrix--tagging) for the full scheme.

- [`latest`, `node24.14.0_python3.13`, `node24.14.0_python3`, `node24_python3.13`, `node24_python3`, `node24.14_python3.13`, `node24.14_python3`](https://github.com/spiriyu/claude-code-sandbox/blob/main/apps/docker/image/Dockerfile)

- [`node24.14.0_python3.12`, `node24_python3.12`, `node24.14_python3.12`](https://github.com/spiriyu/claude-code-sandbox/blob/main/apps/docker/image/Dockerfile)

- [`node24.14.0_python3.11`, `node24_python3.11`, `node24.14_python3.11`](https://github.com/spiriyu/claude-code-sandbox/blob/main/apps/docker/image/Dockerfile)

- [`node22.18.0_python3.13`, `node22.18.0_python3`, `node22_python3.13`, `node22_python3`, `node22.18_python3.13`, `node22.18_python3`](https://github.com/spiriyu/claude-code-sandbox/blob/main/apps/docker/image/Dockerfile)

- [`node22.18.0_python3.12`, `node22_python3.12`, `node22.18_python3.12`](https://github.com/spiriyu/claude-code-sandbox/blob/main/apps/docker/image/Dockerfile)

- [`node22.18.0_python3.11`, `node22_python3.11`, `node22.18_python3.11`](https://github.com/spiriyu/claude-code-sandbox/blob/main/apps/docker/image/Dockerfile)

- [`node20.19.4_python3.13`, `node20.19.4_python3`, `node20_python3.13`, `node20_python3`, `node20.19_python3.13`, `node20.19_python3`](https://github.com/spiriyu/claude-code-sandbox/blob/main/apps/docker/image/Dockerfile)

- [`node20.19.4_python3.12`, `node20_python3.12`, `node20.19_python3.12`](https://github.com/spiriyu/claude-code-sandbox/blob/main/apps/docker/image/Dockerfile)

- [`node20.19.4_python3.11`, `node20_python3.11`, `node20.19_python3.11`](https://github.com/spiriyu/claude-code-sandbox/blob/main/apps/docker/image/Dockerfile)

## What This Image Does

A ready-to-use sandbox for running [Claude Code](https://docs.anthropic.com/en/docs/claude-code) inside Docker. It provides a non-root `dev` user with Node.js (via nvm), Python (via pyenv), and the Claude Code CLI pre-installed.

## Base Image

**Debian 12 (Bookworm) slim** — chosen over Alpine for glibc compatibility with pyenv-built Python and native npm packages.

## Build Arguments

| Argument         | Default | Description                        |
| ---------------- | ------- | ---------------------------------- |
| `USER_UID`       | `1000`  | UID for the `dev` user             |
| `USER_GID`       | `1000`  | GID for the `dev` user             |
| `NODE_VERSION`   | `24`    | Node.js version installed via nvm  |
| `PYTHON_VERSION` | `3.13`  | Python version installed via pyenv |

## Authentication

The entrypoint requires at least one credential to be set:

| Environment Variable      | Source                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`       | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude Pro/Max subscription (`claude login`)                                       |

If neither is set, the container exits with an error message.

## Image Layers (build order)

```
1. System packages    — apt-get (curl, git, vim, jq, build-essential, etc.)
2. Locale             — en_US.UTF-8
3. Non-root user      — dev (UID/GID from build args, handles GID collisions)
4. Workspace          — /workspace owned by dev
5. Shell profiles     — /etc/profile.d/nvm.sh, /etc/profile.d/pyenv.sh
6. Entrypoint         — /entrypoint.sh (auth validation + exec)
7. nvm + Node.js      — /home/dev/.nvm
8. pyenv + Python     — /home/dev/.pyenv
9. Claude Code CLI    — globally installed via npm
10. Bootstrap config  — /home/dev/.claude.json (skips onboarding)
```

## Key Paths Inside the Container

| Path                      | Purpose                                          |
| ------------------------- | ------------------------------------------------ |
| `/workspace`              | Default working directory, mount your code here  |
| `/home/dev/.nvm`          | nvm installation + Node.js versions              |
| `/home/dev/.pyenv`        | pyenv installation + Python versions             |
| `/home/dev/.claude.json`  | Bootstrap config (skips onboarding prompts)      |
| `/entrypoint.sh`          | Auth gate — validates credentials then execs CMD |
| `/etc/profile.d/nvm.sh`   | Loads nvm in login shells                        |
| `/etc/profile.d/pyenv.sh` | Loads pyenv in login shells                      |

## Entrypoint Behavior

1. Checks that `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` is set (non-empty)
2. If neither is present, prints an error with setup instructions and exits 1
3. If valid, `exec`s the CMD — signals (SIGTERM, SIGINT) pass directly to the process

Default CMD: `bash -lc "claude --dangerously-skip-permissions"`

## Shell Profiles

Login shells (`bash -l`, `docker exec -it ... bash -l`) automatically source:

- **nvm.sh** — exports `NVM_DIR`, loads nvm and bash completion
- **pyenv.sh** — exports `PYENV_ROOT`, adds pyenv to `PATH`, runs `pyenv init`

Both scripts are safe to source when nvm/pyenv binaries are absent (no errors).

## Build Matrix & Tagging

Defined in `versions.json`:

```json
{
    "node": ["24.14.0", "22.18.0", "20.19.4"],
    "python": ["3.13", "3.12", "3.11"]
}
```

CI builds the **Cartesian product** (9 combinations). Tags follow the pattern:

```
{version}_node{N}_python{P}
```

The highest Node + highest Python combo also gets `latest` and the bare version tag.

**Example tags for release `0.4.0`:**

```
0.4.0_node24.14.0_python3.13   <- also tagged: latest, 0.4.0
0.4.0_node24.14.0_python3.12
0.4.0_node24.14.0_python3.11
0.4.0_node22.18.0_python3.13
0.4.0_node22.18.0_python3.12
0.4.0_node22.18.0_python3.11
0.4.0_node20.19.4_python3.13
0.4.0_node20.19.4_python3.12
0.4.0_node20.19.4_python3.11
```

## Quick Reference

```bash
# Build locally
docker build -f image/Dockerfile \
  --build-arg USER_UID=$(id -u) \
  --build-arg USER_GID=$(id -g) \
  -t claude-code-sandbox .

# Run with API key
docker run -it --rm \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -v $(pwd):/workspace \
  spiriyu/claude-code-sandbox:latest

# Run with OAuth token
docker run -it --rm \
  -e CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat... \
  -v $(pwd):/workspace \
  spiriyu/claude-code-sandbox:latest

# Drop into bash instead of Claude
docker run -it --rm \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -v $(pwd):/workspace \
  spiriyu/claude-code-sandbox:latest bash -l

# Run tests
bash test/entrypoint.test.sh
bash test/profile.test.sh
```

## Docker Compose

Create a `.env` file with your credentials, then use this `docker-compose.yml`:

```yaml
services:
    claude-code-sandbox:
        image: spiriyu/claude-code-sandbox:latest
        stdin_open: true # docker run -i
        tty: true # docker run -t
        env_file: .env # loads ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN
        volumes:
            - .:/workspace
```

`.env`:

```
ANTHROPIC_API_KEY=sk-ant-api03-...
```

```bash
# Start Claude Code interactively
docker compose run --rm claude-code-sandbox

# Drop into bash instead
docker compose run --rm claude-code-sandbox bash -l

# Run a one-off command
docker compose run --rm claude-code-sandbox bash -lc "claude -p 'explain this project'"
```

To match your host user's UID/GID (avoids file permission issues on mounted volumes), build locally:

```yaml
services:
    claude-code-sandbox:
        build:
            context: .
            dockerfile: image/Dockerfile
            args:
                USER_UID: ${UID:-1000}
                USER_GID: ${GID:-1000}
        stdin_open: true
        tty: true
        env_file: .env
        volumes:
            - .:/workspace
```

```bash
# Build with your UID/GID and start
UID=$(id -u) GID=$(id -g) docker compose run --rm claude-code-sandbox
```
