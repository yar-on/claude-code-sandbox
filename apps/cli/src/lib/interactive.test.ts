import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type Command } from 'commander';
import {
    buildGlobalFlags,
    promptConfigGet,
    promptConfigSet,
    promptConfigReset,
    promptMainMenu,
    promptContainerSelect,
    CONTAINER_UNSET,
    runInteractiveMode,
    startWizard,
} from './interactive.js';
import { DEFAULT_CONFIG_DIR } from './constants.js';
import { type ConfigFile } from './config-store.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const { mockSelect, mockInput, mockConfirm, mockCheckbox } = vi.hoisted(() => ({
    mockSelect: vi.fn<[], Promise<string>>(),
    mockInput: vi.fn<[], Promise<string>>(),
    mockConfirm: vi.fn<[], Promise<boolean>>(),
    mockCheckbox: vi.fn<[], Promise<string[]>>().mockResolvedValue([]),
}));

vi.mock('@inquirer/prompts', () => ({
    select: mockSelect,
    input: mockInput,
    confirm: mockConfirm,
    checkbox: mockCheckbox,
    Separator: class {
        readonly separator: string;
        readonly type = 'separator';
        constructor(separator?: string) {
            this.separator = separator ?? '──────────';
        }
    },
}));

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn(), line: vi.fn(), blank: vi.fn() },
    spinner: vi.fn(() => {
        const s = { text: '', start: vi.fn(), succeed: vi.fn(), fail: vi.fn() };
        s.start = vi.fn(() => s);
        return s;
    }),
}));

// ─── buildGlobalFlags ─────────────────────────────────────────────────────────

describe('buildGlobalFlags', () => {
    const fakeProgram = { help: vi.fn(), parseAsync: vi.fn(), version: vi.fn().mockReturnValue('0.0.0-test') };

    it('returns [] when all opts are defaults', async () => {
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => undefined as never);
        Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
        mockSelect.mockResolvedValueOnce('__exit__');
        await runInteractiveMode(fakeProgram as unknown as Command, { configDir: DEFAULT_CONFIG_DIR });
        expect(buildGlobalFlags()).toEqual([]);
        exitSpy.mockRestore();
    });

    it('returns --config-dir when configDir differs from default', async () => {
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => undefined as never);
        Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
        mockSelect.mockResolvedValueOnce('__exit__');
        await runInteractiveMode(fakeProgram as unknown as Command, { configDir: '/custom' });
        expect(buildGlobalFlags()).toEqual(['--config-dir', '/custom']);
        exitSpy.mockRestore();
    });

    it('returns --workspace when workspace is set', async () => {
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => undefined as never);
        Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
        mockSelect.mockResolvedValueOnce('__exit__');
        await runInteractiveMode(fakeProgram as unknown as Command, { configDir: DEFAULT_CONFIG_DIR, workspace: '/proj' });
        expect(buildGlobalFlags()).toEqual(['--workspace', '/proj']);
        exitSpy.mockRestore();
    });

    it('returns config-dir and workspace flags (id cleared when container not found)', async () => {
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => undefined as never);
        Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
        mockSelect.mockResolvedValueOnce('__exit__');
        // id 'abc123' does not match any container, so runInteractiveMode clears it
        await runInteractiveMode(fakeProgram as unknown as Command, { configDir: '/custom', workspace: '/proj', id: 'abc123' });
        expect(buildGlobalFlags()).toEqual(['--config-dir', '/custom', '--workspace', '/proj']);
        exitSpy.mockRestore();
    });
});

// ─── promptConfigGet ──────────────────────────────────────────────────────────

describe('promptConfigGet', () => {
    beforeEach(() => {
        mockSelect.mockReset();
    });

    it('returns ["config","get",key] for selected key', async () => {
        mockSelect.mockResolvedValueOnce('defaultTag');
        expect(await promptConfigGet()).toEqual(['config', 'get', 'defaultTag']);
    });
});

// ─── promptConfigSet ──────────────────────────────────────────────────────────

describe('promptConfigSet', () => {
    beforeEach(() => {
        mockSelect.mockReset();
        mockInput.mockReset();
    });

    it('returns ["config","set",key,value] for selected key and input value', async () => {
        mockSelect.mockResolvedValueOnce('defaultImage');
        mockInput.mockResolvedValueOnce('myimage');
        expect(await promptConfigSet()).toEqual(['config', 'set', 'defaultImage', 'myimage']);
    });
});

// ─── promptConfigReset ────────────────────────────────────────────────────────

describe('promptConfigReset', () => {
    beforeEach(() => {
        mockSelect.mockReset();
    });

    it('returns ["config","reset"] when scope is all', async () => {
        mockSelect.mockResolvedValueOnce('all');
        expect(await promptConfigReset()).toEqual(['config', 'reset']);
    });

    it('returns ["config","reset",key] when scope is key', async () => {
        mockSelect.mockResolvedValueOnce('key');
        mockSelect.mockResolvedValueOnce('authMethod');
        expect(await promptConfigReset()).toEqual(['config', 'reset', 'authMethod']);
    });
});

// ─── promptMainMenu ───────────────────────────────────────────────────────────

describe('promptMainMenu', () => {
    const mockProgram = { help: vi.fn(), parseAsync: vi.fn(), version: vi.fn().mockReturnValue('0.0.0-test') };

    beforeEach(() => {
        mockSelect.mockReset();
        mockInput.mockReset();
        mockProgram.help.mockReset();
        mockProgram.parseAsync.mockReset();
    });

    it("returns ['start'] for 'start'", async () => {
        mockSelect.mockResolvedValueOnce('start');
        expect(await promptMainMenu(mockProgram as unknown as Command)).toEqual(['start']);
    });

    it("returns ['__start-wizard__'] for 'start-wizard'", async () => {
        mockSelect.mockResolvedValueOnce('start-wizard');
        expect(await promptMainMenu(mockProgram as unknown as Command)).toEqual(['__start-wizard__']);
    });

    it("returns ['__cleanup__'] for 'cleanup'", async () => {
        mockSelect.mockResolvedValueOnce('cleanup');
        expect(await promptMainMenu(mockProgram as unknown as Command)).toEqual(['__cleanup__']);
    });

    it("returns ['auth', 'setup'] for 'auth-setup'", async () => {
        mockSelect.mockResolvedValueOnce('auth-setup');
        expect(await promptMainMenu(mockProgram as unknown as Command)).toEqual(['auth', 'setup']);
    });

    it("returns ['use', '--clear'] for 'use-clear'", async () => {
        mockSelect.mockResolvedValueOnce('use-clear');
        expect(await promptMainMenu(mockProgram as unknown as Command)).toEqual(['use', '--clear']);
    });

    it('calls process.exit(0) for __exit__', async () => {
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => undefined as never);
        mockSelect.mockResolvedValueOnce('__exit__');
        await promptMainMenu(mockProgram as unknown as Command);
        expect(exitSpy).toHaveBeenCalledWith(0);
        exitSpy.mockRestore();
    });

    it('calls program.help() for __help__', async () => {
        mockProgram.help.mockImplementation(() => {
            /* no-op */
        });
        mockSelect.mockResolvedValueOnce('__help__');
        await promptMainMenu(mockProgram as unknown as Command);
        expect(mockProgram.help).toHaveBeenCalled();
    });
});

// ─── promptContainerSelect ────────────────────────────────────────────────────

describe('promptContainerSelect', () => {
    const emptyConfig: ConfigFile = {
        version: 1,
        containers: {},
        settings: { defaultImage: '', defaultTag: '', authMethod: null, currentContainerId: null, gitUserName: null, gitUserEmail: null, cleanupDays: 10, backup: true },
        workspaceSettings: {},
        backupMigrationDone: true,
    };

    beforeEach(() => {
        mockSelect.mockReset();
    });

    it('returns null when CONTAINER_UNSET is chosen', async () => {
        mockSelect.mockResolvedValueOnce(CONTAINER_UNSET);
        expect(await promptContainerSelect(emptyConfig, null)).toBeNull();
    });

    it('returns the chosen container id when a container is selected', async () => {
        mockSelect.mockResolvedValueOnce('abc-123');
        expect(await promptContainerSelect(emptyConfig, null)).toBe('abc-123');
    });
});

// ─── startWizard ─────────────────────────────────────────────────────────────

describe('startWizard', () => {
    const defaultSettings: ConfigFile['settings'] = {
        defaultImage: '',
        defaultTag: '',
        authMethod: null,
        currentContainerId: null,
        gitUserName: null,
        gitUserEmail: null,
        cleanupDays: 10,
        backup: true,
    };

    beforeEach(() => {
        mockSelect.mockReset();
        mockInput.mockReset();
        mockConfirm.mockReset();
    });

    it('returns workspace, image, tag, and backup for latest selection', async () => {
        mockInput.mockResolvedValueOnce('/tmp'); // workspace
        mockSelect.mockResolvedValueOnce('latest'); // image tag
        mockConfirm.mockResolvedValueOnce(true); // backup
        mockConfirm.mockResolvedValueOnce(true); // deploy confirm

        const result = await startWizard('/tmp', defaultSettings, {});
        expect(result).toEqual({
            workspace: '/tmp',
            image: 'spiriyu/claude-code-sandbox',
            tag: 'latest',
            backup: true,
        });
    });

    it('returns custom tag with node and python selections', async () => {
        mockInput.mockResolvedValueOnce('/tmp'); // workspace
        mockSelect.mockResolvedValueOnce('__custom__'); // custom image
        mockSelect.mockResolvedValueOnce('22'); // node 22
        mockSelect.mockResolvedValueOnce('3.12'); // python 3.12
        mockConfirm.mockResolvedValueOnce(false); // backup
        mockConfirm.mockResolvedValueOnce(true); // deploy confirm

        const result = await startWizard('/tmp', defaultSettings, {});
        expect(result).not.toBeNull();
        expect(result?.workspace).toBe('/tmp');
        expect(result?.image).toBe('spiriyu/claude-code-sandbox');
        expect(result?.tag).toMatch(/^.+_node22_python3\.12$/);
        expect(result?.backup).toBe(false);
    });

    it('returns null when user declines deploy confirmation', async () => {
        mockInput.mockResolvedValueOnce('/tmp'); // workspace
        mockSelect.mockResolvedValueOnce('latest'); // image tag
        mockConfirm.mockResolvedValueOnce(true); // backup
        mockConfirm.mockResolvedValueOnce(false); // decline deploy

        const result = await startWizard('/tmp', defaultSettings, {});
        expect(result).toBeNull();
    });

    it('returns null when workspace does not exist', async () => {
        mockInput.mockResolvedValueOnce('/nonexistent/path/abc123');

        const result = await startWizard('/tmp', defaultSettings, {});
        expect(result).toBeNull();
    });

    it('shows settings tag when it differs from latest', async () => {
        const settingsWithTag = { ...defaultSettings, defaultTag: 'latest_node22_python3.11' };
        mockInput.mockResolvedValueOnce('/tmp');
        mockSelect.mockResolvedValueOnce('latest_node22_python3.11'); // pick settings tag
        mockConfirm.mockResolvedValueOnce(true); // backup
        mockConfirm.mockResolvedValueOnce(true); // deploy confirm

        const result = await startWizard('/tmp', settingsWithTag, {});
        expect(result).toEqual({
            workspace: '/tmp',
            image: 'spiriyu/claude-code-sandbox',
            tag: 'latest_node22_python3.11',
            backup: true,
        });
    });
});

// ─── runInteractiveMode ───────────────────────────────────────────────────────

describe('runInteractiveMode', () => {
    const mockProgram = { help: vi.fn(), parseAsync: vi.fn(), version: vi.fn().mockReturnValue('0.0.0-test') };

    beforeEach(() => {
        mockSelect.mockReset();
        mockInput.mockReset();
        mockConfirm.mockReset();
        mockCheckbox.mockReset();
        mockCheckbox.mockResolvedValue([]); // migration: no backups selected by default
        mockProgram.help.mockReset();
        mockProgram.parseAsync.mockReset();
    });

    it('calls program.help() and returns early when stdin is not a TTY', async () => {
        const origIsTTY = process.stdin.isTTY;
        Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
        await runInteractiveMode(mockProgram as unknown as Command, { configDir: DEFAULT_CONFIG_DIR });
        expect(mockProgram.help).toHaveBeenCalled();
        expect(mockProgram.parseAsync).not.toHaveBeenCalled();
        Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, configurable: true });
    });

    it('calls process.exit(0) when ExitPromptError is thrown', async () => {
        Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => undefined as never);
        const err = new Error('User force closed the prompt');
        err.name = 'ExitPromptError';
        mockSelect.mockRejectedValueOnce(err);
        await runInteractiveMode(mockProgram as unknown as Command, { configDir: DEFAULT_CONFIG_DIR });
        expect(exitSpy).toHaveBeenCalledWith(0);
        exitSpy.mockRestore();
    });

    it('calls parseAsync once for start then exits on __exit__', async () => {
        Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => undefined as never);
        mockProgram.parseAsync.mockResolvedValue(undefined);
        mockSelect.mockResolvedValueOnce('start').mockResolvedValueOnce('__exit__');
        await runInteractiveMode(mockProgram as unknown as Command, { configDir: DEFAULT_CONFIG_DIR });
        expect(mockProgram.parseAsync).toHaveBeenCalledOnce();
        expect(mockProgram.parseAsync).toHaveBeenCalledWith(['start'], { from: 'user' });
        expect(exitSpy).toHaveBeenCalledWith(0);
        exitSpy.mockRestore();
    });

    it('handles inline container select via "use" menu option', async () => {
        Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => undefined as never);
        mockSelect
            .mockResolvedValueOnce('use') // main menu → select container
            .mockResolvedValueOnce(CONTAINER_UNSET) // container picker → none
            .mockResolvedValueOnce('__exit__'); // main menu → exit
        await runInteractiveMode(mockProgram as unknown as Command, { configDir: DEFAULT_CONFIG_DIR });
        expect(mockProgram.parseAsync).not.toHaveBeenCalled();
        expect(exitSpy).toHaveBeenCalledWith(0);
        exitSpy.mockRestore();
    });

    it('clears container selection via "use-clear" menu option', async () => {
        Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => undefined as never);
        mockSelect
            .mockResolvedValueOnce('use-clear') // main menu → clear selection
            .mockResolvedValueOnce('__exit__'); // main menu → exit
        await runInteractiveMode(mockProgram as unknown as Command, { configDir: DEFAULT_CONFIG_DIR, id: 'some-id' });
        // After clearing, buildGlobalFlags should not include --id
        expect(buildGlobalFlags().includes('--id')).toBe(false);
        expect(exitSpy).toHaveBeenCalledWith(0);
        exitSpy.mockRestore();
    });

    it('shows pressAnyKey and continues when a command fails (CommandExitError)', async () => {
        Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => undefined as never);
        const cmdErr = Object.assign(new Error('Command exited with code 1'), { name: 'CommandExitError' });
        mockProgram.parseAsync.mockRejectedValueOnce(cmdErr);
        mockSelect
            .mockResolvedValueOnce('start') // first pick → command fails
            .mockResolvedValueOnce('__exit__'); // second pick → exit
        await runInteractiveMode(mockProgram as unknown as Command, { configDir: DEFAULT_CONFIG_DIR });
        expect(mockProgram.parseAsync).toHaveBeenCalledOnce();
        expect(exitSpy).toHaveBeenCalledWith(0);
        exitSpy.mockRestore();
    });

    it('redisplays the menu when BackError is thrown (ESC pressed)', async () => {
        Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => undefined as never);
        mockProgram.parseAsync.mockRejectedValueOnce(Object.assign(new Error(), { name: 'BackError' })).mockResolvedValue(undefined);
        mockSelect
            .mockResolvedValueOnce('start') // first menu pick → parseAsync throws BackError
            .mockResolvedValueOnce('start') // second menu pick → parseAsync succeeds
            .mockResolvedValueOnce('__exit__'); // third menu pick → exit
        await runInteractiveMode(mockProgram as unknown as Command, { configDir: DEFAULT_CONFIG_DIR });
        expect(mockProgram.parseAsync).toHaveBeenCalledTimes(2);
        expect(exitSpy).toHaveBeenCalledWith(0);
        exitSpy.mockRestore();
    });
});
