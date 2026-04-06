# Changelog

All notable changes to the CLI are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

---

## [0.6.2] - 2026-04-07

No user-facing changes.

---

## [0.6.1] - 2026-04-07

No user-facing changes.

---

## [0.6.0] - 2026-04-07

No user-facing changes.

---

## [0.5.5] - 2026-03-11

No user-facing changes.

---

## [0.5.4] - 2026-03-10

### Added

- Workspace backup system — automatic zip backups before container start
- Per-workspace backup toggle via **Manage workspace backups** menu item (shown when a container is selected)
- One-time migration prompt on first launch for users upgrading from versions without backup support
- Backup exclusion list extended to cover Python, Java/JVM, Go, PHP, Ruby, and Rust build artifacts (`__pycache__`, `.venv`, `venv`, `.tox`, `.mypy_cache`, `.pytest_cache`, `.ruff_cache`, `target`, `.gradle`, `vendor`)

### Fixed

- `MaxListenersExceededWarning` on the daily-rotating log transport (logger instance was recreated on every log call)

---

## [0.5.3] - 2026-03-09

### Added

- Warning banner in interactive mode when no authentication credentials are configured

---

## [0.5.2] - 2026-03-09

### Added

- Persistent log files written to `~/.claude-code-sandbox/logs/`
- Windows compatibility (path handling, shell detection)

### Fixed

- Blank/invisible screen after attaching to a running container

---

## [0.5.1] - 2026-03-09

Maintenance release — version aligned with Docker v0.5.1.

---

## [0.5.0] - 2026-03-09

Project restructured and transferred to new repository.

---

## [0.4.0] - 2026-03-09

### Added

- Docker Hub README auto-generated from `versions.json` on every release
- Docker Hub description updated automatically via CI

---

## [0.3.0] - 2026-03-08

### Added

- Claude session auto-restarts after exit — the container stays alive and loops back to a new session
- `cleanup` command to purge old container history records
- `remove-all` command to bulk-remove all containers
- Container auto-selected in interactive mode immediately after deploy
- Workspace path changeable from the interactive menu
- Selected container and workspace displayed in the interactive menu header

---

## [0.2.7] - 2026-03-08

### Fixed

- `Dynamic require of "tty" is not supported` error in ESM context (deferred `@inquirer/prompts` import)

---

## [0.2.0] - 2026-03-08

Initial public release.

---

[unreleased]: https://github.com/spiriyu/claude-code-sandbox/compare/cli-v0.6.2...HEAD
[0.6.2]: https://github.com/spiriyu/claude-code-sandbox/compare/cli-v0.6.1...cli-v0.6.2
[0.6.1]: https://github.com/spiriyu/claude-code-sandbox/compare/cli-v0.6.0...cli-v0.6.1
[0.6.0]: https://github.com/spiriyu/claude-code-sandbox/compare/cli-v0.5.5...cli-v0.6.0
[0.5.5]: https://github.com/spiriyu/claude-code-sandbox/compare/cli-v0.5.4...cli-v0.5.5
[0.5.4]: https://github.com/spiriyu/claude-code-sandbox/compare/cli-v0.5.3...cli-v0.5.4
[0.5.3]: https://github.com/spiriyu/claude-code-sandbox/compare/cli-v0.5.2...cli-v0.5.3
[0.5.2]: https://github.com/spiriyu/claude-code-sandbox/compare/cli-v0.5.1...cli-v0.5.2
[0.5.1]: https://github.com/spiriyu/claude-code-sandbox/compare/cli-v0.5.0...cli-v0.5.1
[0.5.0]: https://github.com/spiriyu/claude-code-sandbox/compare/cli-v0.4.0...cli-v0.5.0
[0.4.0]: https://github.com/spiriyu/claude-code-sandbox/compare/cli-v0.3.0...cli-v0.4.0
[0.3.0]: https://github.com/spiriyu/claude-code-sandbox/compare/cli-v0.2.7...cli-v0.3.0
[0.2.7]: https://github.com/spiriyu/claude-code-sandbox/compare/cli-v0.2.0...cli-v0.2.7
[0.2.0]: https://github.com/spiriyu/claude-code-sandbox/releases/tag/cli-v0.2.0
