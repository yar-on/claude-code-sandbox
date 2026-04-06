# ===================================================
# Claude Code Sandbox
# Debian 12 (Bookworm) slim + nvm + pyenv
# ===================================================

FROM debian:bookworm-slim

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# ---- Build arguments ----
ARG USER_UID=1000
ARG USER_GID=1000
ARG NODE_VERSION=22
ARG PYTHON_VERSION=3.13

# ---- System packages ----
RUN apt-get update && apt-get install -y --no-install-recommends \
    # essentials \
    ca-certificates \
    curl \
    wget \
    gnupg \
    # shell & dev tools \
    git \
    vim \
    jq \
    tmux \
    tree \
    htop \
    unzip \
    ripgrep \
    fzf \
    # build toolchain (needed by pyenv and some npm packages) \
    build-essential \
    # pyenv build dependencies \
    libssl-dev \
    zlib1g-dev \
    libbz2-dev \
    libreadline-dev \
    libsqlite3-dev \
    libncursesw5-dev \
    xz-utils \
    tk-dev \
    libxml2-dev \
    libxmlsec1-dev \
    libffi-dev \
    liblzma-dev \
    # locale \
    locales \
 && sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen \
 && locale-gen \
 && rm -rf /var/lib/apt/lists/*

ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8

# ---- Non-root user ----
# Handle GID collision (e.g. macOS GID 20 = linux dialout)
RUN if getent group ${USER_GID} > /dev/null 2>&1; then \
      EXISTING_GROUP=$(getent group ${USER_GID} | cut -d: -f1); \
      useradd --uid ${USER_UID} --gid ${EXISTING_GROUP} --create-home --shell /bin/bash dev; \
    else \
      groupadd --gid ${USER_GID} dev; \
      useradd --uid ${USER_UID} --gid dev --create-home --shell /bin/bash dev; \
    fi

# ---- Workspace ----
RUN mkdir -p /workspace && chown dev:$(id -gn dev) /workspace

# ---- Shell profile (sourced by all login shells, including docker exec -it ... bash -l) ----
COPY image/src/profile.d/nvm.sh  /etc/profile.d/nvm.sh
COPY image/src/profile.d/pyenv.sh /etc/profile.d/pyenv.sh

# ---- Entrypoint script ----
COPY image/src/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# ---- Switch to dev user for all tool installs ----
USER dev
WORKDIR /home/dev

# ---- nvm + Node.js ----
ENV NVM_DIR=/home/dev/.nvm
ENV NODE_VERSION=${NODE_VERSION}

RUN curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh \
    | PROFILE=/dev/null bash \
    && . "${NVM_DIR}/nvm.sh" \
    && nvm install "${NODE_VERSION}" \
    && nvm alias default "${NODE_VERSION}" \
    && nvm cache clear

# ---- pyenv + Python ----
ENV PYENV_ROOT=/home/dev/.pyenv
ENV PATH="${PYENV_ROOT}/bin:${PYENV_ROOT}/shims:${PATH}"
ENV PYTHON_VERSION=${PYTHON_VERSION}

RUN curl -fsSL https://pyenv.run | bash \
    && pyenv install "${PYTHON_VERSION}" \
    && pyenv global "${PYTHON_VERSION}" \
    && pyenv rehash

# ---- Claude Code CLI ----
# adding claude installed directory into PATH (ENV so it applies to subsequent RUN steps too)
ENV PATH="/home/dev/.local/bin:${PATH}"
RUN echo 'export PATH="$HOME/.local/bin:$PATH"' >> /home/dev/.bashrc
RUN curl -fsSL https://claude.ai/install.sh | bash
RUN claude install

# ---- Claude bootstrap src (skips onboarding, no personal data) ----
COPY --chown=dev:dev image/src/.claude.json /home/dev/.claude.json

# ---- Default working directory ----
WORKDIR /workspace

# ---- Health check ----
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD bash -lc "claude --version" || exit 1

# ---- Entrypoint + default command ----
# ENTRYPOINT validates auth then execs CMD.
# Override CMD to run a different process (e.g. bash for debugging).
ENTRYPOINT ["/bin/bash", "/entrypoint.sh"]
CMD ["bash", "-lc", "claude --dangerously-skip-permissions"]
