import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_IMAGE, DEFAULT_IMAGE_TAG } from './constants.js';

export type ContainerStatus = 'created' | 'running' | 'paused' | 'exited' | 'dead' | 'removed' | 'unknown';

export interface ContainerRecord {
    id: string;
    name: string;
    workspace: string;
    image: string;
    tag: string;
    createdAt: string;
    updatedAt: string;
    lastStatus: ContainerStatus;
    removedAt: string | null;
}

export interface Settings {
    defaultImage: string;
    defaultTag: string;
    authMethod: string | null;
    currentContainerId: string | null;
    gitUserName: string | null;
    gitUserEmail: string | null;
    cleanupDays: number;
    backup: boolean;
}

export interface WorkspaceSettings {
    backup: boolean;
}

export interface ConfigFile {
    version: 1;
    containers: Record<string, ContainerRecord>;
    settings: Settings;
    workspaceSettings: Record<string, WorkspaceSettings>;
    backupMigrationDone: boolean;
}

export const DEFAULT_CLEANUP_DAYS = 10;
export const DEFAULT_BACKUP = true;

const DEFAULT_SETTINGS: Settings = {
    defaultImage: DEFAULT_IMAGE,
    defaultTag: DEFAULT_IMAGE_TAG,
    authMethod: null,
    currentContainerId: null,
    gitUserName: null,
    gitUserEmail: null,
    cleanupDays: DEFAULT_CLEANUP_DAYS,
    backup: DEFAULT_BACKUP,
};

function createEmpty(): ConfigFile {
    return { version: 1, containers: {}, settings: { ...DEFAULT_SETTINGS }, workspaceSettings: {}, backupMigrationDone: false };
}

function migrate(raw: unknown): ConfigFile {
    if (!raw || typeof raw !== 'object') return createEmpty();
    const obj = raw as Record<string, unknown>;
    const result = createEmpty();

    if (obj.containers && typeof obj.containers === 'object') {
        result.containers = obj.containers as Record<string, ContainerRecord>;
    }
    if (obj.settings && typeof obj.settings === 'object') {
        const s = obj.settings as Partial<Settings>;
        result.settings = {
            defaultImage: s.defaultImage ?? DEFAULT_SETTINGS.defaultImage,
            defaultTag: s.defaultTag ?? DEFAULT_SETTINGS.defaultTag,
            authMethod: s.authMethod ?? null,
            currentContainerId: s.currentContainerId ?? null,
            gitUserName: s.gitUserName ?? null,
            gitUserEmail: s.gitUserEmail ?? null,
            cleanupDays: typeof s.cleanupDays === 'number' ? s.cleanupDays : DEFAULT_CLEANUP_DAYS,
            backup: typeof s.backup === 'boolean' ? s.backup : DEFAULT_BACKUP,
        };
    }
    if (obj.workspaceSettings && typeof obj.workspaceSettings === 'object') {
        result.workspaceSettings = obj.workspaceSettings as Record<string, WorkspaceSettings>;
    }
    if (typeof obj.backupMigrationDone === 'boolean') {
        result.backupMigrationDone = obj.backupMigrationDone;
    }
    return result;
}

export function loadConfig(configDir: string): ConfigFile {
    const file = join(configDir, 'config.json');
    if (!existsSync(file)) return createEmpty();
    try {
        return migrate(JSON.parse(readFileSync(file, 'utf-8')));
    } catch {
        return createEmpty();
    }
}

export function saveConfig(config: ConfigFile, configDir: string): void {
    mkdirSync(configDir, { recursive: true });
    const file = join(configDir, 'config.json');
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf-8');
    renameSync(tmp, file);
}
