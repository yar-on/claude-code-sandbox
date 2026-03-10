import archiver from 'archiver';
import { createHash } from 'crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { BACKUPS_DIR_NAME, BACKUP_MAX_COUNT, BACKUP_MIN_AGE_MS } from './constants.js';

export interface BackupMeta {
    createdAt: string;
    workspace: string;
    filePath: string;
    sizeBytes: number;
}

export function workspaceSlug(workspacePath: string): string {
    const normalized = workspacePath.replace(/\\/g, '/').toLowerCase();
    const hash = createHash('sha1').update(normalized).digest('hex').slice(0, 8);
    const safe = basename(workspacePath)
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 40);
    return `${safe}_${hash}`;
}

export function backupDirForWorkspace(configDir: string, workspacePath: string): string {
    return join(configDir, BACKUPS_DIR_NAME, workspaceSlug(workspacePath));
}

const INDEX_FILE = 'index.json';

export function loadBackupIndex(backupDir: string): BackupMeta[] {
    const file = join(backupDir, INDEX_FILE);
    if (!existsSync(file)) return [];
    try {
        return JSON.parse(readFileSync(file, 'utf-8')) as BackupMeta[];
    } catch {
        return [];
    }
}

export function saveBackupIndex(backupDir: string, entries: BackupMeta[]): void {
    writeFileSync(join(backupDir, INDEX_FILE), JSON.stringify(entries, null, 2), 'utf-8');
}

export function shouldSkipBackup(entries: BackupMeta[]): { skip: boolean; reason?: string } {
    if (entries.length === 0) return { skip: false };
    const sorted = [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const age = Date.now() - Date.parse(sorted[0].createdAt);
    if (age < BACKUP_MIN_AGE_MS) {
        const days = Math.floor(age / (1000 * 60 * 60 * 24));
        return { skip: true, reason: days === 0 ? 'Last backup was today' : `Last backup was ${days} day(s) ago` };
    }
    return { skip: false };
}

export function enforceRotation(entries: BackupMeta[], maxCount = BACKUP_MAX_COUNT): void {
    entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    while (entries.length > maxCount) {
        const victim = entries.pop();
        if (!victim) break;
        try {
            unlinkSync(victim.filePath);
        } catch {
            // File already gone — ignore
        }
    }
}

/**
 * Directories excluded from both the size estimate and the zip archive.
 * Covers dependency caches and build artifacts for the most common ecosystems.
 */
export const BACKUP_IGNORE_DIRS: readonly string[] = [
    // JavaScript / TypeScript
    'node_modules',
    // Python
    '__pycache__',
    '.venv',
    'venv',
    '.tox',
    '.mypy_cache',
    '.pytest_cache',
    '.ruff_cache',
    // Java / JVM — Maven, Gradle, SBT
    'target',
    '.gradle',
    // Go / PHP / Ruby / Rust — vendored dependencies
    'vendor',
    // Version control
    '.git',
];

const SKIP_DIRS = new Set(BACKUP_IGNORE_DIRS);
const THROUGHPUT_BYTES_PER_SEC = 80 * 1024 * 1024; // 80 MB/s at zip level 1

export function estimateWorkspaceSize(workspacePath: string): { bytes: number; estimatedSeconds: number } {
    let bytes = 0;

    function walk(dir: string): void {
        let entries: ReturnType<typeof readdirSync>;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (SKIP_DIRS.has(entry.name)) continue;
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile()) {
                try {
                    bytes += statSync(full).size;
                } catch {
                    // skip unreadable files
                }
            }
        }
    }

    walk(workspacePath);
    return { bytes, estimatedSeconds: Math.max(1, bytes / THROUGHPUT_BYTES_PER_SEC) };
}

export function deleteWorkspaceBackups(configDir: string, workspacePath: string): void {
    const backupDir = backupDirForWorkspace(configDir, workspacePath);
    if (!existsSync(backupDir)) return;
    try {
        rmSync(backupDir, { recursive: true, force: true });
    } catch {
        // ignore
    }
}

function formatTimestamp(d: Date): string {
    return d.toISOString().replace(/[-:]/g, '').slice(0, 15);
}

export async function createBackup(configDir: string, workspacePath: string, onProgress?: (msg: string) => void): Promise<BackupMeta | null> {
    if (!existsSync(workspacePath) || !statSync(workspacePath).isDirectory()) {
        return null;
    }

    const backupDir = backupDirForWorkspace(configDir, workspacePath);
    mkdirSync(backupDir, { recursive: true });

    const entries = loadBackupIndex(backupDir);
    const check = shouldSkipBackup(entries);
    if (check.skip) {
        return null;
    }

    const slug = workspaceSlug(workspacePath);
    const ts = formatTimestamp(new Date());
    const filename = `${ts}_${slug}.zip`;
    const filePath = join(backupDir, filename);

    onProgress?.('Backing up workspace...');

    await new Promise<void>((resolve, reject) => {
        const output = createWriteStream(filePath);
        const archive = archiver('zip', { zlib: { level: 1 } });

        output.on('close', resolve);
        archive.on('error', (err) => {
            try {
                unlinkSync(filePath);
            } catch {
                // Ignore cleanup error
            }
            reject(err);
        });
        archive.on('progress', ({ entries: e }) => {
            onProgress?.(`Backing up workspace... (${e.processed} files)`);
        });

        archive.pipe(output);
        archive.glob('**/*', {
            cwd: workspacePath,
            ignore: BACKUP_IGNORE_DIRS.map((d) => `**/${d}/**`),
            dot: true,
        });
        void archive.finalize();
    });

    const sizeBytes = statSync(filePath).size;
    const meta: BackupMeta = {
        createdAt: new Date().toISOString(),
        workspace: workspacePath,
        filePath,
        sizeBytes,
    };

    entries.push(meta);
    enforceRotation(entries);
    saveBackupIndex(backupDir, entries);

    return meta;
}
