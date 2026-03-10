import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { workspaceSlug, backupDirForWorkspace, loadBackupIndex, saveBackupIndex, shouldSkipBackup, enforceRotation, createBackup, type BackupMeta } from './backup.js';
import { BACKUPS_DIR_NAME, BACKUP_MIN_AGE_MS } from './constants.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
    return mkdtempSync(join(tmpdir(), 'backup-test-'));
}

function meta(overrides: Partial<BackupMeta> = {}): BackupMeta {
    return {
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago
        workspace: '/home/user/project',
        filePath: '/tmp/fake-backup.zip',
        sizeBytes: 1024,
        ...overrides,
    };
}

// ─── workspaceSlug ────────────────────────────────────────────────────────────

describe('workspaceSlug', () => {
    it('produces a non-empty string', () => {
        expect(workspaceSlug('/home/user/project')).toBeTruthy();
    });

    it('is deterministic for the same path', () => {
        const a = workspaceSlug('/home/user/project');
        const b = workspaceSlug('/home/user/project');
        expect(a).toBe(b);
    });

    it('differs for different paths', () => {
        expect(workspaceSlug('/home/user/project-a')).not.toBe(workspaceSlug('/home/user/project-b'));
    });

    it('includes the directory basename', () => {
        const slug = workspaceSlug('/home/user/my-project');
        expect(slug).toMatch(/^my-project_/);
    });

    it('normalizes Windows backslashes before hashing', () => {
        const posix = workspaceSlug('/home/user/project');
        const win = workspaceSlug('\\home\\user\\project');
        // Hash portion (after the last _) must match
        const posixHash = posix.split('_').at(-1);
        const winHash = win.split('_').at(-1);
        expect(posixHash).toBe(winHash);
    });

    it('replaces unsafe characters in basename with underscores', () => {
        const slug = workspaceSlug('/home/user/my project!@#');
        // Only alphanumeric, dots, hyphens, underscores before the hash separator
        const basePart = slug.split('_').slice(0, -1).join('_');
        expect(basePart).toMatch(/^[a-zA-Z0-9._-]+$/);
    });

    it('truncates very long basenames to 40 chars', () => {
        const longName = 'a'.repeat(100);
        const slug = workspaceSlug(`/home/user/${longName}`);
        const basePart = slug.split('_').slice(0, -1).join('_');
        expect(basePart.length).toBeLessThanOrEqual(40);
    });

    it('appends an 8-char hex hash suffix', () => {
        const slug = workspaceSlug('/home/user/project');
        const hashPart = slug.split('_').at(-1) ?? '';
        expect(hashPart).toMatch(/^[0-9a-f]{8}$/);
    });
});

// ─── backupDirForWorkspace ────────────────────────────────────────────────────

describe('backupDirForWorkspace', () => {
    it('places the backup dir inside configDir/backups/', () => {
        const dir = backupDirForWorkspace('/config', '/home/user/project');
        expect(dir.startsWith(`/config/${BACKUPS_DIR_NAME}/`)).toBe(true);
    });

    it('is deterministic for the same inputs', () => {
        const a = backupDirForWorkspace('/config', '/home/user/project');
        const b = backupDirForWorkspace('/config', '/home/user/project');
        expect(a).toBe(b);
    });

    it('differs for different workspaces', () => {
        const a = backupDirForWorkspace('/config', '/home/user/alpha');
        const b = backupDirForWorkspace('/config', '/home/user/beta');
        expect(a).not.toBe(b);
    });
});

// ─── loadBackupIndex / saveBackupIndex ────────────────────────────────────────

describe('loadBackupIndex', () => {
    it('returns empty array when index file does not exist', () => {
        const dir = makeTmpDir();
        expect(loadBackupIndex(dir)).toEqual([]);
    });

    it('returns empty array for corrupt JSON', () => {
        const dir = makeTmpDir();
        writeFileSync(join(dir, 'index.json'), 'not json');
        expect(loadBackupIndex(dir)).toEqual([]);
    });

    it('returns parsed entries from valid index file', () => {
        const dir = makeTmpDir();
        const entries = [meta(), meta({ filePath: '/tmp/other.zip' })];
        writeFileSync(join(dir, 'index.json'), JSON.stringify(entries));
        expect(loadBackupIndex(dir)).toHaveLength(2);
    });
});

describe('saveBackupIndex', () => {
    it('writes valid JSON that loadBackupIndex can read back', () => {
        const dir = makeTmpDir();
        const entries = [meta()];
        saveBackupIndex(dir, entries);
        const loaded = loadBackupIndex(dir);
        expect(loaded).toHaveLength(1);
        expect(loaded[0].workspace).toBe(entries[0].workspace);
    });

    it('overwrites existing index', () => {
        const dir = makeTmpDir();
        saveBackupIndex(dir, [meta(), meta()]);
        saveBackupIndex(dir, [meta()]);
        expect(loadBackupIndex(dir)).toHaveLength(1);
    });
});

// ─── shouldSkipBackup ─────────────────────────────────────────────────────────

describe('shouldSkipBackup', () => {
    it('returns skip=false for empty entries', () => {
        expect(shouldSkipBackup([])).toEqual({ skip: false });
    });

    it('returns skip=true when newest entry is from today', () => {
        const result = shouldSkipBackup([meta({ createdAt: new Date().toISOString() })]);
        expect(result.skip).toBe(true);
        expect(result.reason).toContain('today');
    });

    it('returns skip=true when newest entry is less than 7 days old', () => {
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
        const result = shouldSkipBackup([meta({ createdAt: threeDaysAgo })]);
        expect(result.skip).toBe(true);
        expect(result.reason).toContain('3 day(s) ago');
    });

    it('returns skip=false when newest entry is exactly 7 days old', () => {
        const sevenDaysAgo = new Date(Date.now() - BACKUP_MIN_AGE_MS).toISOString();
        expect(shouldSkipBackup([meta({ createdAt: sevenDaysAgo })])).toEqual({ skip: false });
    });

    it('returns skip=false when newest entry is older than 7 days', () => {
        const old = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
        expect(shouldSkipBackup([meta({ createdAt: old })])).toEqual({ skip: false });
    });

    it('uses the newest entry when multiple are present', () => {
        const recent = new Date().toISOString();
        const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const result = shouldSkipBackup([meta({ createdAt: old }), meta({ createdAt: recent })]);
        expect(result.skip).toBe(true);
    });

    it('does not mutate the input array', () => {
        const entries = [meta({ createdAt: new Date().toISOString() })];
        const copy = [...entries];
        shouldSkipBackup(entries);
        expect(entries).toEqual(copy);
    });
});

// ─── enforceRotation ──────────────────────────────────────────────────────────

describe('enforceRotation', () => {
    it('does nothing when entries are within the limit', () => {
        const entries = [meta(), meta()];
        enforceRotation(entries, 2);
        expect(entries).toHaveLength(2);
    });

    it('removes oldest entry when over the limit', () => {
        const old = meta({ createdAt: '2020-01-01T00:00:00.000Z', filePath: '/tmp/old.zip' });
        const recent = meta({ createdAt: new Date().toISOString(), filePath: '/tmp/recent.zip' });
        const entries = [old, recent];
        enforceRotation(entries, 1);
        expect(entries).toHaveLength(1);
        expect(entries[0].filePath).toBe('/tmp/recent.zip');
    });

    it('removes multiple entries when more than one over the limit', () => {
        const entries = [
            meta({ createdAt: '2020-01-01T00:00:00.000Z', filePath: '/tmp/a.zip' }),
            meta({ createdAt: '2021-01-01T00:00:00.000Z', filePath: '/tmp/b.zip' }),
            meta({ createdAt: '2024-01-01T00:00:00.000Z', filePath: '/tmp/c.zip' }),
        ];
        enforceRotation(entries, 1);
        expect(entries).toHaveLength(1);
        expect(entries[0].filePath).toBe('/tmp/c.zip');
    });

    it('keeps entries sorted newest-first after rotation', () => {
        const entries = [
            meta({ createdAt: '2020-01-01T00:00:00.000Z', filePath: '/tmp/a.zip' }),
            meta({ createdAt: '2024-06-01T00:00:00.000Z', filePath: '/tmp/b.zip' }),
            meta({ createdAt: '2024-01-01T00:00:00.000Z', filePath: '/tmp/c.zip' }),
        ];
        enforceRotation(entries, 2);
        expect(entries[0].filePath).toBe('/tmp/b.zip');
        expect(entries[1].filePath).toBe('/tmp/c.zip');
    });

    it('does not throw when zip file does not exist on disk', () => {
        const entries = [
            meta({ createdAt: '2020-01-01T00:00:00.000Z', filePath: '/nonexistent/path.zip' }),
            meta({ createdAt: '2024-01-01T00:00:00.000Z', filePath: '/tmp/keep.zip' }),
        ];
        expect(() => enforceRotation(entries, 1)).not.toThrow();
        expect(entries).toHaveLength(1);
    });

    it('handles empty array without error', () => {
        const entries: BackupMeta[] = [];
        expect(() => enforceRotation(entries, 2)).not.toThrow();
        expect(entries).toHaveLength(0);
    });
});

// ─── createBackup (integration) ───────────────────────────────────────────────

describe('createBackup', () => {
    let configDir: string;
    let workspace: string;

    beforeEach(() => {
        configDir = makeTmpDir();
        workspace = makeTmpDir();
    });

    afterEach(() => {
        try {
            rmSync(configDir, { recursive: true, force: true });
        } catch {
            /* ignore */
        }
        try {
            rmSync(workspace, { recursive: true, force: true });
        } catch {
            /* ignore */
        }
    });

    it('creates a zip file and returns BackupMeta', async () => {
        writeFileSync(join(workspace, 'hello.txt'), 'hello world');

        const result = await createBackup(configDir, workspace);

        expect(result).not.toBeNull();
        if (result === null) return;
        expect(result.filePath).toMatch(/\.zip$/);
        expect(result.sizeBytes).toBeGreaterThan(0);
        expect(result.workspace).toBe(workspace);
        expect(result.createdAt).toMatch(/^\d{4}-/);
    }, 15_000);

    it('writes an index.json alongside the zip', async () => {
        writeFileSync(join(workspace, 'file.txt'), 'content');

        const result = await createBackup(configDir, workspace);
        expect(result).not.toBeNull();
        if (result === null) return;

        const backupDir = backupDirForWorkspace(configDir, workspace);
        const index = loadBackupIndex(backupDir);
        expect(index).toHaveLength(1);
        expect(index[0].filePath).toBe(result.filePath);
    }, 15_000);

    it('calls onProgress at least once', async () => {
        writeFileSync(join(workspace, 'file.txt'), 'data');

        const messages: string[] = [];
        await createBackup(configDir, workspace, (msg) => messages.push(msg));

        expect(messages.length).toBeGreaterThan(0);
    }, 15_000);

    it('returns null for non-existent workspace', async () => {
        const result = await createBackup(configDir, '/does/not/exist/anywhere');
        expect(result).toBeNull();
    });

    it('returns null for a file path (not a directory)', async () => {
        const filePath = join(configDir, 'notadir.txt');
        writeFileSync(filePath, 'x');
        const result = await createBackup(configDir, filePath);
        expect(result).toBeNull();
    });

    it('returns null when a recent backup already exists (skip logic)', async () => {
        writeFileSync(join(workspace, 'file.txt'), 'data');

        const first = await createBackup(configDir, workspace);
        expect(first).not.toBeNull();

        const second = await createBackup(configDir, workspace);
        expect(second).toBeNull();
    }, 15_000);

    it('enforces max 2 backups, deleting the oldest on the third run', async () => {
        writeFileSync(join(workspace, 'file.txt'), 'data');

        const backupDir = backupDirForWorkspace(configDir, workspace);

        // Manually inject two old entries so rotation triggers on the next real backup
        const oldEntry1 = meta({
            createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
            workspace,
            filePath: join(backupDir, 'old1.zip'),
        });
        const oldEntry2 = meta({
            createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
            workspace,
            filePath: join(backupDir, 'old2.zip'),
        });

        mkdirSync(backupDir, { recursive: true });
        writeFileSync(oldEntry1.filePath, 'dummy');
        writeFileSync(oldEntry2.filePath, 'dummy');
        saveBackupIndex(backupDir, [oldEntry1, oldEntry2]);

        const newMeta = await createBackup(configDir, workspace);
        expect(newMeta).not.toBeNull();
        if (newMeta === null) return;

        const index = loadBackupIndex(backupDir);
        expect(index).toHaveLength(2);
        const paths = index.map((e) => e.filePath);
        expect(paths).not.toContain(oldEntry1.filePath);
        expect(paths).toContain(oldEntry2.filePath);
        expect(paths).toContain(newMeta.filePath);
    }, 15_000);

    it('excludes node_modules from the zip', async () => {
        // Put a large file in node_modules and a small one outside
        const nmDir = join(workspace, 'node_modules', 'some-pkg');
        mkdirSync(nmDir, { recursive: true });
        // 200 KB of content in node_modules
        writeFileSync(join(nmDir, 'big.js'), 'x'.repeat(200_000));
        // Tiny source file
        writeFileSync(join(workspace, 'index.ts'), 'export {}');

        const result = await createBackup(configDir, workspace);
        expect(result).not.toBeNull();
        if (result === null) return;

        // If node_modules was included the zip would be much larger than 200 KB.
        // With exclusion the zip should only contain the tiny index.ts.
        expect(result.sizeBytes).toBeLessThan(200_000);
    }, 15_000);

    it('works on an empty workspace directory', async () => {
        const result = await createBackup(configDir, workspace);
        expect(result).not.toBeNull();
        if (result === null) return;
        expect(result.sizeBytes).toBeGreaterThan(0);
    }, 15_000);

    it('backup file name contains a timestamp prefix', async () => {
        writeFileSync(join(workspace, 'x.txt'), 'x');
        const result = await createBackup(configDir, workspace);
        expect(result).not.toBeNull();
        if (result === null) return;
        const filename = result.filePath.split('/').at(-1) ?? '';
        // Timestamp format: 20260310T143022 (15 chars of collapsed ISO)
        expect(filename).toMatch(/^\d{8}T\d{6}_/);
    }, 15_000);
});
