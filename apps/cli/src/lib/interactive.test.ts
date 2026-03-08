import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type Command } from 'commander';
import { buildGlobalFlags, promptConfigGet, promptConfigSet, promptConfigReset, promptMainMenu, promptContainerSelect, CONTAINER_UNSET, runInteractiveMode } from './interactive.js';
import { DEFAULT_CONFIG_DIR } from './constants.js';
import { type ConfigFile } from './config-store.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const { mockSelect, mockInput } = vi.hoisted(() => ({
    mockSelect: vi.fn<[], Promise<string>>(),
    mockInput: vi.fn<[], Promise<string>>(),
}));

vi.mock('@inquirer/prompts', () => ({
    select: mockSelect,
    input: mockInput,
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
}));

// ─── buildGlobalFlags ─────────────────────────────────────────────────────────

describe('buildGlobalFlags', () => {
    it('returns [] when all opts are defaults', () => {
        expect(buildGlobalFlags({ configDir: DEFAULT_CONFIG_DIR })).toEqual([]);
    });

    it('returns --config-dir when configDir differs from default', () => {
        expect(buildGlobalFlags({ configDir: '/custom' })).toEqual(['--config-dir', '/custom']);
    });

    it('returns --workspace when workspace is set', () => {
        expect(buildGlobalFlags({ configDir: DEFAULT_CONFIG_DIR, workspace: '/proj' })).toEqual(['--workspace', '/proj']);
    });

    it('returns all three flags when all are non-default', () => {
        expect(buildGlobalFlags({ configDir: '/custom', workspace: '/proj', id: 'abc123' })).toEqual(['--config-dir', '/custom', '--workspace', '/proj', '--id', 'abc123']);
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
    const emptyConfig: ConfigFile = { version: 1, containers: {}, settings: { defaultImage: '', defaultTag: '', authMethod: null, currentContainerId: null, gitUserName: null, gitUserEmail: null } };

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

// ─── runInteractiveMode ───────────────────────────────────────────────────────

describe('runInteractiveMode', () => {
    const mockProgram = { help: vi.fn(), parseAsync: vi.fn(), version: vi.fn().mockReturnValue('0.0.0-test') };

    beforeEach(() => {
        mockSelect.mockReset();
        mockInput.mockReset();
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
            .mockResolvedValueOnce('use')            // main menu → select container
            .mockResolvedValueOnce(CONTAINER_UNSET)  // container picker → none
            .mockResolvedValueOnce('__exit__');       // main menu → exit
        await runInteractiveMode(mockProgram as unknown as Command, { configDir: DEFAULT_CONFIG_DIR });
        expect(mockProgram.parseAsync).not.toHaveBeenCalled();
        expect(exitSpy).toHaveBeenCalledWith(0);
        exitSpy.mockRestore();
    });

    it('clears container selection via "use-clear" menu option', async () => {
        Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => undefined as never);
        const opts = { configDir: DEFAULT_CONFIG_DIR, id: 'some-id' };
        mockSelect
            .mockResolvedValueOnce('use-clear')  // main menu → clear selection
            .mockResolvedValueOnce('__exit__');   // main menu → exit
        await runInteractiveMode(mockProgram as unknown as Command, opts);
        expect(opts.id).toBeUndefined();
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
