import { DEFAULT_NODE_VERSION, DEFAULT_PYTHON_VERSION } from '@claude-code-sandbox/shared';
import { homedir } from 'os';
import { join } from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

export { DEFAULT_NODE_VERSION, DEFAULT_PYTHON_VERSION };

// Environment variable names
export const ENV_VARS = {
    CONFIG_DIR: 'CLAUDE_SANDBOX_CONFIG_DIR',
    WORKSPACE: 'CLAUDE_SANDBOX_WORKSPACE',
    IMAGE: 'CLAUDE_SANDBOX_IMAGE',
    TAG: 'CLAUDE_SANDBOX_TAG',
} as const;

// Built-in defaults
export const DEFAULT_CONFIG_DIR = join(homedir(), '.claude-code-sandbox');
export const DEFAULT_IMAGE = 'spiriyu/claude-code-sandbox';
export const DEFAULT_IMAGE_TAG = 'latest';

/**
 * Docker image version injected at build time via tsup define.
 * In dev mode (tsx), falls back to reading apps/docker/package.json directly.
 */
function resolveDockerImageVersion(): string {
    if (process.env.DOCKER_IMAGE_VERSION) return process.env.DOCKER_IMAGE_VERSION;
    try {
        // Dev mode: resolve relative to this source file → apps/cli/src/lib/
        // Traverse up to monorepo root: ../../../../apps/docker/package.json
        const thisDir = fileURLToPath(new URL('.', import.meta.url));
        const pkgPath = join(thisDir, '..', '..', '..', '..', 'apps', 'docker', 'package.json');
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
        return pkg.version;
    } catch {
        return 'latest';
    }
}

export const DOCKER_IMAGE_VERSION: string = resolveDockerImageVersion();

// Docker container naming
export const CONTAINER_NAME_PREFIX = 'claude-code-sandbox-';

// Mount paths inside the container
export const WORKSPACE_MOUNT_PATH = '/workspace';
export const CLAUDE_DIR_CONTAINER_PATH = '/home/dev/.claude';

// Git identity env vars passed into the container
// Backup
export const BACKUPS_DIR_NAME = 'backups';
export const BACKUP_MAX_COUNT = 2;
export const BACKUP_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export const GIT_ENV_VARS = {
    USER_NAME: 'GIT_USER_NAME',
    USER_EMAIL: 'GIT_USER_EMAIL',
} as const;

// Auth
export const AUTH_METHODS = {
    API_KEY: 'api_key',
    OAUTH_TOKEN: 'oauth_token',
} as const;

export type AuthMethod = (typeof AUTH_METHODS)[keyof typeof AUTH_METHODS];

export const TOKEN_PREFIXES = {
    api_key: 'sk-ant-api03-',
    oauth_token: 'sk-ant-oat01-',
} as const;
