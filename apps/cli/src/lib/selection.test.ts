import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatContainerLine, pickInteractively, resolveContainer } from './selection.js';
import { type ConfigFile, type ContainerRecord } from './config-store.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const { mockGetContainerStates, mockSelect } = vi.hoisted(() => ({
    mockGetContainerStates: vi.fn<[string[]], Promise<Map<string, string>>>(),
    mockSelect: vi.fn<[], Promise<string>>(),
}));

vi.mock('./docker.js', () => ({
    getContainerStates: mockGetContainerStates,
    formatRelativeTime: vi.fn(() => '5m ago'),
}));

vi.mock('../utils/logger.js', () => ({
    logger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        success: vi.fn(),
        blank: vi.fn(),
        line: vi.fn(),
    },
}));

vi.mock('@inquirer/prompts', () => ({
    select: mockSelect,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WS = '/home/user/project';

function makeRecord(overrides: Partial<ContainerRecord> = {}): ContainerRecord {
    return {
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        name: 'claude-code-sandbox-a1b2c3d4',
        workspace: WS,
        image: 'spiriyu/claude-code-sandbox',
        tag: 'latest',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        lastStatus: 'running',
        removedAt: null,
        ...overrides,
    };
}

function makeConfig(records: ContainerRecord[], currentContainerId: string | null = null): ConfigFile {
    const containers: Record<string, ContainerRecord> = {};
    for (const r of records) containers[r.id] = r;
    return {
        version: 1,
        containers,
        settings: {
            defaultImage: 'test',
            defaultTag: 'latest',
            authMethod: null,
            currentContainerId,
            gitUserName: null,
            gitUserEmail: null,
            cleanupDays: 10,
            backup: true,
        },
    };
}

// ─── formatContainerLine ──────────────────────────────────────────────────────

describe('formatContainerLine', () => {
    it('uses the first 8 hex chars of the UUID as the display id', () => {
        const c = makeRecord({ id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' });
        expect(formatContainerLine(c)).toContain('a1b2c3d4');
    });

    it('shows full workspace path when it is 35 chars or fewer', () => {
        const c = makeRecord({ workspace: '/short/path' }); // 11 chars
        expect(formatContainerLine(c)).toContain('/short/path');
    });

    it('truncates workspace longer than 35 chars with "..." prefix', () => {
        const longWs = '/very/long/absolute/workspace/path/that/exceeds/the/limit';
        const c = makeRecord({ workspace: longWs });
        const line = formatContainerLine(c);
        expect(line).toContain('...');
        expect(line).not.toContain(longWs);
        // Last 32 chars of workspace should appear
        expect(line).toContain(longWs.slice(-32));
    });

    it('pads status to 10 characters', () => {
        const c = makeRecord({ lastStatus: 'run' });
        const line = formatContainerLine(c);
        expect(line).toContain('run       '); // padEnd(10)
    });

    it('includes relative time from formatRelativeTime mock', () => {
        const c = makeRecord();
        expect(formatContainerLine(c)).toContain('5m ago');
    });
});

// ─── pickInteractively ────────────────────────────────────────────────────────

describe('pickInteractively', () => {
    it('returns null for empty array', async () => {
        expect(await pickInteractively([])).toBeNull();
    });

    it('returns the single item without prompting', async () => {
        const c = makeRecord();
        const result = await pickInteractively([c]);
        expect(result).toBe(c);
        expect(mockSelect).not.toHaveBeenCalled();
    });

    it('calls select prompt when multiple containers exist', async () => {
        const c1 = makeRecord({ id: 'a1b2c3d4-0000-0000-0000-000000000000', name: 'claude-code-sandbox-a1b2c3d4' });
        const c2 = makeRecord({ id: 'b2b2b2b2-0000-0000-0000-000000000000', name: 'claude-code-sandbox-b2b2b2b2' });
        mockSelect.mockResolvedValue(c2.id);

        const result = await pickInteractively([c1, c2]);
        expect(mockSelect).toHaveBeenCalledOnce();
        expect(result?.id).toBe(c2.id);
    });

    it('returns null if select resolves to an unknown id', async () => {
        const c = makeRecord();
        mockSelect.mockResolvedValue('not-a-real-id');
        const result = await pickInteractively([c, makeRecord({ id: 'zzzzzzzz-0000-0000-0000-000000000000' })]);
        expect(result).toBeNull();
    });
});

// ─── resolveContainer ─────────────────────────────────────────────────────────

describe('resolveContainer', () => {
    beforeEach(() => {
        mockGetContainerStates.mockResolvedValue(new Map());
        mockSelect.mockReset();
    });

    it('returns record when --id matches config and Docker', async () => {
        const c = makeRecord();
        const cfg = makeConfig([c]);
        mockGetContainerStates.mockResolvedValue(new Map([[c.name, 'running']]));

        const result = await resolveContainer(cfg, { id: 'a1b2c3d4' });
        expect(result?.id).toBe(c.id);
    });

    it('falls through when --id is not found in config', async () => {
        const c = makeRecord();
        const cfg = makeConfig([c]);
        // Mock Docker not needed — config lookup fails first
        const result = await resolveContainer(cfg, { id: 'ffffffff' });
        // No currentContainerId, no workspace match → null
        expect(result).toBeNull();
    });

    it('falls through when --id points to a removed container', async () => {
        const c = makeRecord({ removedAt: '2024-01-01T00:00:00.000Z' });
        const cfg = makeConfig([c]);

        const result = await resolveContainer(cfg, { id: 'a1b2c3d4' });
        expect(result).toBeNull();
    });

    it('falls through when --id container is absent from Docker', async () => {
        const c = makeRecord();
        const cfg = makeConfig([c]);
        // Docker returns empty map — container not found
        mockGetContainerStates.mockResolvedValue(new Map());

        const result = await resolveContainer(cfg, { id: 'a1b2c3d4' });
        expect(result).toBeNull();
    });

    it('resolves via currentContainerId when no --id', async () => {
        const c = makeRecord();
        const cfg = makeConfig([c], c.id);

        const result = await resolveContainer(cfg, {});
        expect(result?.id).toBe(c.id);
    });

    it('skips removed container in currentContainerId', async () => {
        const c = makeRecord({ removedAt: '2024-01-01T00:00:00.000Z' });
        const cfg = makeConfig([c], c.id);

        // No workspace match either → null
        const result = await resolveContainer(cfg, { workspace: '/no/match' });
        expect(result).toBeNull();
    });

    it('returns single workspace match directly', async () => {
        const c = makeRecord({ workspace: WS });
        const cfg = makeConfig([c]);

        const result = await resolveContainer(cfg, { workspace: WS });
        expect(result?.id).toBe(c.id);
    });

    it('calls pickInteractively when multiple workspace candidates', async () => {
        const c1 = makeRecord({ id: 'a1b2c3d4-0000-0000-0000-000000000000', name: 'n1', workspace: WS });
        const c2 = makeRecord({ id: 'b2b2b2b2-0000-0000-0000-000000000000', name: 'n2', workspace: WS });
        const cfg = makeConfig([c1, c2]);
        mockSelect.mockResolvedValue(c1.id);

        const result = await resolveContainer(cfg, { workspace: WS });
        expect(mockSelect).toHaveBeenCalledOnce();
        expect(result?.id).toBe(c1.id);
    });

    it('returns null when no containers match', async () => {
        const cfg = makeConfig([]);
        const result = await resolveContainer(cfg, { workspace: '/no/match' });
        expect(result).toBeNull();
    });
});
