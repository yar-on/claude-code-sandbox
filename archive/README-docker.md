# claude-code-sandbox

> A Docker image that runs [Claude Code](https://github.com/anthropics/claude-code) in an isolated sandbox environment.

[![Docker Hub](https://img.shields.io/docker/pulls/spiriyu/claude-code-sandbox)](https://hub.docker.com/r/spiriyu/claude-code-sandbox)
[![Docker Image Size](https://img.shields.io/docker/image-size/spiriyu/claude-code-sandbox/latest)](https://hub.docker.com/r/spiriyu/claude-code-sandbox)

## What's Inside

- **OS**: Debian 12 (Bookworm) slim
- **Node.js**: v22 (via nvm)
- **Python**: 3.13 (via pyenv)
- **Claude Code**: latest (`@anthropic-ai/claude-code`)
- **Tools**: git, curl, vim, jq, ripgrep, fzf, tmux, tree, htop

## Quick Start

The easiest way is to use the CLI tool:

```bash
npx @claude-code-sandbox/cli start
```

Or manually with Docker:

```bash
# With API Key
docker run -it --rm \
  -e ANTHROPIC_API_KEY=your_key_here \
  -v $(pwd):/workspace \
  spiriyu/claude-code-sandbox

# With OAuth Token
docker run -it --rm \
  -e CLAUDE_CODE_OAUTH_TOKEN=your_token_here \
  -v $(pwd):/workspace \
  spiriyu/claude-code-sandbox
```

## Authentication

You need one of:

| Method | Variable | How to Get                                                                         |
|--------|----------|------------------------------------------------------------------------------------|
| API Key | `ANTHROPIC_API_KEY` | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| OAuth Token | `CLAUDE_CODE_OAUTH_TOKEN` | Requires Claude Pro/Max — run `claude setup-token`                                 |

Run `npx @claude-code-sandbox/cli auth` for an interactive setup guide.

## Building Locally

```bash
git clone https://github.com/spiriyu/claude-code-sandbox
cd claude-code-sandbox

docker build -t claude-code-sandbox .

# Custom UID/GID (recommended — matches your host user)
docker build \
  --build-arg USER_UID=$(id -u) \
  --build-arg USER_GID=$(id -g) \
  -t claude-code-sandbox .
```

## Build Arguments

| Arg | Default | Description |
|-----|---------|-------------|
| `USER_UID` | `1000` | Host user UID for file permission mapping |
| `USER_GID` | `1000` | Host user GID for file permission mapping |
| `NODE_VERSION` | `22` | Node.js major version |
| `PYTHON_VERSION` | `3.13` | Python version |

## Customizing Node.js or Python Versions

The image ships with Node.js 22 and Python 3.13 by default. You can change either version at build time using build args:

```bash
# Use Node.js 20 instead of 22
docker build --build-arg NODE_VERSION=20 -t claude-code-sandbox .

# Use Python 3.12 instead of 3.13
docker build --build-arg PYTHON_VERSION=3.12 -t claude-code-sandbox .

# Both at once, with UID/GID mapping
docker build \
  --build-arg NODE_VERSION=20 \
  --build-arg PYTHON_VERSION=3.12 \
  --build-arg USER_UID=$(id -u) \
  --build-arg USER_GID=$(id -g) \
  -t claude-code-sandbox .
```

Node.js is installed via [nvm](https://github.com/nvm-sh/nvm) — any version nvm supports will work (e.g. `18`, `20`, `22`).
Python is installed via [pyenv](https://github.com/pyenv/pyenv) — any version pyenv supports will work (e.g. `3.11`, `3.12`, `3.13`).

To check available versions:
```bash
# Inside a running container
nvm ls-remote --lts        # List available Node.js versions
pyenv install --list       # List available Python versions
```

## Docker Compose

Create a `docker-compose.yml` in your project directory:

```yaml
services:
  claude-code-sandbox:
    image: spiriyu/claude-code-sandbox
    container_name: claude-code-sandbox
    stdin_open: true
    tty: true
    restart: unless-stopped
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
      # Or use OAuth instead:
      # - CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_CODE_OAUTH_TOKEN:-}
    volumes:
      - .:/workspace
```

Then run:

```bash
# Start the sandbox
docker compose up -d

# Attach to the Claude session
docker attach claude-code-sandbox

# Or open a shell
docker compose exec claude-code-sandbox bash -l

# Stop
docker compose down
```

To pass your API key, either export it in your shell or create a `.env` file next to `docker-compose.yml`:

```bash
# .env (do NOT commit this file)
ANTHROPIC_API_KEY=sk-ant-api03-...
```

### Building from source with Compose

If you want to build the image locally (e.g. to customize UID/GID or tool versions):

```yaml
services:
  claude-code-sandbox:
    build:
      context: .
      args:
        USER_UID: 1000
        USER_GID: 1000
        NODE_VERSION: 22
        PYTHON_VERSION: 3.13
    container_name: claude-code-sandbox
    stdin_open: true
    tty: true
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
    volumes:
      - .:/workspace
```

```bash
docker compose up -d --build
```

## CLI Tool

For a better experience, use the companion CLI:

```bash
npm install -g @claude-code-sandbox/cli

claude-code-sandbox start      # Start the sandbox
claude-code-sandbox shell      # Open a shell inside it
claude-code-sandbox auth       # Configure credentials
claude-code-sandbox status     # Show container state
claude-code-sandbox stop       # Stop the container
```

## Publishing

See [PUBLISHING.md](./PUBLISHING.md) for Docker Hub publishing steps.

## License

MIT
