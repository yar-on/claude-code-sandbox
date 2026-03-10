import { describe, it, expect } from 'vitest';
import { getAllContainers, findContainerById, findContainersByWorkspace, addContainer, updateContainer, markContainerRemoved, syncContainerStatuses } from './container-store.js';
import { type ConfigFile, type ContainerRecord } from './config-store.js';

function record(overrides: Partial<ContainerRecord> = {}): ContainerRecord {
    return {
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        name: 'claude-code-sandbox-a1b2c3d4',
        workspace: '/home/user/project',
        image: 'spiriyu/claude-code-sandbox',
        tag: 'latest',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        lastStatus: 'running',
        removedAt: null,
        ...overrides,
    };
}

function emptyConfig(): ConfigFile {
    return {
        version: 1,
        containers: {},
        settings: { defaultImage: 'test', defaultTag: 'latest', authMethod: null, currentContainerId: null, gitUserName: null, gitUserEmail: null, cleanupDays: 10, backup: true },
    };
}

function configWith(records: ContainerRecord[]): ConfigFile {
    const cfg = emptyConfig();
    for (const r of records) cfg.containers[r.id] = r;
    return cfg;
}

// ─── getAllContainers ─────────────────────────────────────────────────────────

describe('getAllContainers', () => {
    it('returns empty array for empty config', () => {
        expect(getAllContainers(emptyConfig())).toEqual([]);
    });

    it('returns only non-removed containers by default', () => {
        const cfg = configWith([record({ id: 'aaa-1', name: 'n1' }), record({ id: 'bbb-2', name: 'n2', removedAt: '2024-01-02T00:00:00.000Z', lastStatus: 'removed' })]);
        const result = getAllContainers(cfg);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('aaa-1');
    });

    it('returns all containers when includeRemoved=true', () => {
        const cfg = configWith([record({ id: 'aaa-1', name: 'n1' }), record({ id: 'bbb-2', name: 'n2', removedAt: '2024-01-02T00:00:00.000Z', lastStatus: 'removed' })]);
        expect(getAllContainers(cfg, true)).toHaveLength(2);
    });
});

// ─── findContainerById ────────────────────────────────────────────────────────

describe('findContainerById', () => {
    const fullId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const cfg = configWith([record({ id: fullId, name: 'claude-code-sandbox-a1b2c3d4' })]);

    it('finds by exact full UUID', () => {
        expect(findContainerById(cfg, fullId)).toBeDefined();
    });

    it('finds by 8-char short prefix', () => {
        expect(findContainerById(cfg, 'a1b2c3d4')).toBeDefined();
    });

    it('matches prefix case-insensitively', () => {
        expect(findContainerById(cfg, 'A1B2C3D4')).toBeDefined();
    });

    it('returns undefined for non-matching id', () => {
        expect(findContainerById(cfg, 'zzzzzzzz')).toBeUndefined();
    });

    it('returns undefined on empty config', () => {
        expect(findContainerById(emptyConfig(), 'a1b2c3d4')).toBeUndefined();
    });

    it('returns first match when prefix is ambiguous', () => {
        // Two containers whose UUIDs both start with 'a1b2c3d4'
        const id1 = 'a1b2c3d4-1111-1111-1111-111111111111';
        const id2 = 'a1b2c3d4-2222-2222-2222-222222222222';
        const cfg2 = configWith([record({ id: id1, name: 'n1' }), record({ id: id2, name: 'n2' })]);
        const found = findContainerById(cfg2, 'a1b2c3d4');
        // Must find one of them (not undefined)
        expect(found).toBeDefined();
        expect([id1, id2]).toContain(found?.id);
    });
});

// ─── findContainersByWorkspace ────────────────────────────────────────────────

describe('findContainersByWorkspace', () => {
    const ws = '/home/user/project';

    it('returns matching non-removed containers', () => {
        const cfg = configWith([record({ id: 'r1', name: 'n1', workspace: ws })]);
        expect(findContainersByWorkspace(cfg, ws)).toHaveLength(1);
    });

    it('returns empty array when no match', () => {
        const cfg = configWith([record({ id: 'r1', name: 'n1', workspace: '/other/path' })]);
        expect(findContainersByWorkspace(cfg, ws)).toHaveLength(0);
    });

    it('does not return removed containers', () => {
        const cfg = configWith([record({ id: 'r1', name: 'n1', workspace: ws, removedAt: '2024-01-01T00:00:00.000Z' })]);
        expect(findContainersByWorkspace(cfg, ws)).toHaveLength(0);
    });

    it('returns multiple containers for same workspace', () => {
        const cfg = configWith([record({ id: 'r1', name: 'n1', workspace: ws }), record({ id: 'r2', name: 'n2', workspace: ws })]);
        expect(findContainersByWorkspace(cfg, ws)).toHaveLength(2);
    });

    it('requires exact path match (not prefix)', () => {
        const cfg = configWith([record({ id: 'r1', name: 'n1', workspace: '/home/user/project-extra' })]);
        expect(findContainersByWorkspace(cfg, ws)).toHaveLength(0);
    });
});

// ─── addContainer ─────────────────────────────────────────────────────────────

describe('addContainer', () => {
    it('adds a record to the config', () => {
        const cfg = emptyConfig();
        const r = record();
        addContainer(cfg, r);
        expect(cfg.containers[r.id]).toEqual(r);
    });

    it('can add multiple records', () => {
        const cfg = emptyConfig();
        addContainer(cfg, record({ id: 'r1', name: 'n1' }));
        addContainer(cfg, record({ id: 'r2', name: 'n2' }));
        expect(Object.keys(cfg.containers)).toHaveLength(2);
    });

    it('overwrites an existing record with same id', () => {
        const cfg = emptyConfig();
        addContainer(cfg, record({ tag: 'v1' }));
        addContainer(cfg, record({ tag: 'v2' }));
        const r = cfg.containers['a1b2c3d4-e5f6-7890-abcd-ef1234567890'];
        expect(r.tag).toBe('v2');
    });
});

// ─── updateContainer ──────────────────────────────────────────────────────────

describe('updateContainer', () => {
    it('updates specified fields and bumps updatedAt', () => {
        const before = '2024-01-01T00:00:00.000Z';
        const cfg = configWith([record({ updatedAt: before })]);
        updateContainer(cfg, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', { lastStatus: 'exited' });

        const r = cfg.containers['a1b2c3d4-e5f6-7890-abcd-ef1234567890'];
        expect(r.lastStatus).toBe('exited');
        expect(r.updatedAt).not.toBe(before);
    });

    it('resolves by short id', () => {
        const cfg = configWith([record()]);
        updateContainer(cfg, 'a1b2c3d4', { lastStatus: 'paused' });
        expect(cfg.containers['a1b2c3d4-e5f6-7890-abcd-ef1234567890'].lastStatus).toBe('paused');
    });

    it('silently does nothing for unknown id', () => {
        const cfg = configWith([record()]);
        expect(() => updateContainer(cfg, 'ffffffff', { lastStatus: 'dead' })).not.toThrow();
        // Original unchanged
        expect(cfg.containers['a1b2c3d4-e5f6-7890-abcd-ef1234567890'].lastStatus).toBe('running');
    });

    it('does not mutate unrelated fields', () => {
        const cfg = configWith([record({ tag: 'v1', workspace: '/original' })]);
        updateContainer(cfg, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', { lastStatus: 'exited' });
        const r = cfg.containers['a1b2c3d4-e5f6-7890-abcd-ef1234567890'];
        expect(r.tag).toBe('v1');
        expect(r.workspace).toBe('/original');
    });
});

// ─── markContainerRemoved ─────────────────────────────────────────────────────

describe('markContainerRemoved', () => {
    it('sets removedAt to an ISO timestamp', () => {
        const cfg = configWith([record()]);
        markContainerRemoved(cfg, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
        const r = cfg.containers['a1b2c3d4-e5f6-7890-abcd-ef1234567890'];
        expect(r.removedAt).not.toBeNull();
        expect(new Date(r.removedAt as string).getTime()).toBeGreaterThan(0);
    });

    it('sets lastStatus to "removed"', () => {
        const cfg = configWith([record({ lastStatus: 'running' })]);
        markContainerRemoved(cfg, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
        expect(cfg.containers['a1b2c3d4-e5f6-7890-abcd-ef1234567890'].lastStatus).toBe('removed');
    });

    it('is idempotent on already-removed container', () => {
        const already = '2024-01-01T00:00:00.000Z';
        const cfg = configWith([record({ removedAt: already, lastStatus: 'removed' })]);
        // Should not throw, and removedAt gets updated (re-removed)
        expect(() => markContainerRemoved(cfg, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890')).not.toThrow();
    });
});

// ─── syncContainerStatuses ────────────────────────────────────────────────────

describe('syncContainerStatuses', () => {
    it('updates lastStatus for containers found in Docker', () => {
        const cfg = configWith([record({ lastStatus: 'created' })]);
        syncContainerStatuses(cfg, new Map([['claude-code-sandbox-a1b2c3d4', 'running']]));
        expect(cfg.containers['a1b2c3d4-e5f6-7890-abcd-ef1234567890'].lastStatus).toBe('running');
    });

    it('marks containers not in Docker as "unknown"', () => {
        const cfg = configWith([record({ lastStatus: 'running' })]);
        syncContainerStatuses(cfg, new Map()); // empty Docker state
        expect(cfg.containers['a1b2c3d4-e5f6-7890-abcd-ef1234567890'].lastStatus).toBe('unknown');
    });

    it('does not update removed containers', () => {
        const cfg = configWith([record({ removedAt: '2024-01-01T00:00:00.000Z', lastStatus: 'removed' })]);
        syncContainerStatuses(cfg, new Map([['claude-code-sandbox-a1b2c3d4', 'running']]));
        // lastStatus should remain 'removed'
        expect(cfg.containers['a1b2c3d4-e5f6-7890-abcd-ef1234567890'].lastStatus).toBe('removed');
    });

    it('bumps updatedAt for containers found in Docker', () => {
        const before = '2024-01-01T00:00:00.000Z';
        const cfg = configWith([record({ updatedAt: before })]);
        syncContainerStatuses(cfg, new Map([['claude-code-sandbox-a1b2c3d4', 'running']]));
        expect(cfg.containers['a1b2c3d4-e5f6-7890-abcd-ef1234567890'].updatedAt).not.toBe(before);
    });

    it('handles empty dockerStates without errors', () => {
        const cfg = configWith([record(), record({ id: 'b2-id', name: 'claude-code-sandbox-b2b2b2b2' })]);
        expect(() => syncContainerStatuses(cfg, new Map())).not.toThrow();
    });
});
