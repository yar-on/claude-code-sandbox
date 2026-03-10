import chalk from 'chalk';
import { existsSync, statSync } from 'fs';
import { resolve, join } from 'path';
import { type Command } from 'commander';
import { logger, spinner } from '../utils/logger.js';
import { appLogger } from '../utils/app-logger.js';
import { DEFAULT_CONFIG_DIR, DEFAULT_IMAGE, DEFAULT_IMAGE_TAG, DOCKER_IMAGE_VERSION } from './constants.js';
import { withEscBack } from './prompt-utils.js';
import { loadConfig, saveConfig, type ConfigFile, type WorkspaceSettings } from './config-store.js';
import { findContainerById, findContainersByWorkspace, getAllContainers } from './container-store.js';
import { createBackup, deleteWorkspaceBackups, estimateWorkspaceSize, backupDirForWorkspace, loadBackupIndex } from './backup.js';
import { getStoredAuth } from '../commands/auth.js';
import { resolveWorkspace } from './workspace.js';
import { formatContainerLine } from './selection.js';
import { setSessionContainerId } from './session-store.js';
import { versions } from '@claude-code-sandbox/shared';

// Lazy-load @inquirer/prompts to avoid bundling CJS deps into the ESM top-level scope.
// (Same pattern as selection.ts — resolves the "Dynamic require of tty" esbuild issue.)
const getPrompts = () => import('@inquirer/prompts');

export interface GlobalOpts {
    configDir: string;
    workspace?: string;
    id?: string;
}

const globalOpts: GlobalOpts = {
    configDir: DEFAULT_CONFIG_DIR,
    workspace: undefined,
    id: undefined,
};

export function buildGlobalFlags(): string[] {
    const flags: string[] = [];
    if (globalOpts.configDir !== DEFAULT_CONFIG_DIR) flags.push('--config-dir', globalOpts.configDir);
    if (globalOpts.workspace) flags.push('--workspace', globalOpts.workspace);
    if (globalOpts.id) flags.push('--id', globalOpts.id);
    return flags;
}

export const CONTAINER_UNSET = '__unset__';

const EXCLUDED_STATUSES = new Set(['unknown', 'removed']);

export async function promptContainerSelect(config: ConfigFile, currentId: string | null): Promise<string | null> {
    const { select } = await getPrompts();

    const containers = getAllContainers(config)
        .filter((c) => c.removedAt === null && !EXCLUDED_STATUSES.has(c.lastStatus))
        .sort((a, b) => (a.lastStatus === 'running' ? -1 : b.lastStatus === 'running' ? 1 : 0));

    const choices = [{ name: chalk.dim('None (unset)'), value: CONTAINER_UNSET }, ...containers.map((c) => ({ name: formatContainerLine(c), value: c.id }))];

    const chosen = await withEscBack((s) => select<string>({ message: 'Select container:', choices, default: currentId ?? CONTAINER_UNSET }, { signal: s }));

    return chosen === CONTAINER_UNSET ? null : chosen;
}

const CONFIG_KEYS = [
    { name: 'defaultImage', value: 'defaultImage' },
    { name: 'defaultTag', value: 'defaultTag' },
    { name: 'authMethod', value: 'authMethod' },
    { name: 'gitUserName', value: 'gitUserName' },
    { name: 'gitUserEmail', value: 'gitUserEmail' },
    { name: 'cleanupDays', value: 'cleanupDays' },
    { name: 'backup', value: 'backup' },
];

export async function promptConfigGet(): Promise<string[]> {
    const { select } = await getPrompts();
    const key = await withEscBack((s) => select<string>({ message: 'Select setting key:', choices: CONFIG_KEYS }, { signal: s }));
    return ['config', 'get', key];
}

export async function promptConfigSet(): Promise<string[]> {
    const { select, input } = await getPrompts();
    const key = await withEscBack((s) => select<string>({ message: 'Select setting key:', choices: CONFIG_KEYS }, { signal: s }));
    const value = await withEscBack((s) => input({ message: `New value for ${key}:` }, { signal: s }));
    return ['config', 'set', key, value];
}

export async function promptConfigReset(): Promise<string[]> {
    const { select } = await getPrompts();
    const scope = await withEscBack((s) =>
        select<string>(
            {
                message: 'Reset scope:',
                choices: [
                    { name: 'All settings', value: 'all' },
                    { name: 'Specific key', value: 'key' },
                ],
            },
            { signal: s }
        )
    );
    if (scope === 'all') return ['config', 'reset'];
    const key = await withEscBack((s) => select<string>({ message: 'Select setting key:', choices: CONFIG_KEYS }, { signal: s }));
    return ['config', 'reset', key];
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
    return `${(bytes / 1e3).toFixed(0)} KB`;
}

function formatDuration(seconds: number): string {
    if (seconds < 60) return `~${Math.round(seconds)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return s > 0 ? `~${m}m ${s}s` : `~${m}m`;
}

// ── One-time backup migration prompt ─────────────────────────────────────────

/**
 * Shown once when the user first upgrades to a version with per-workspace
 * backup settings. Lists all workspaces that don't have a decision yet and
 * lets the user choose which ones to enable. Never shown again after completion
 * or if the user ESCs out and comes back — ESC defers it to next launch.
 */
export async function promptBackupMigration(configDir: string): Promise<void> {
    const { checkbox } = await getPrompts();

    // No config dir → fresh install, nothing to migrate
    if (!existsSync(configDir)) return;

    const config = loadConfig(configDir);
    if (config.backupMigrationDone) return;

    // Workspaces from non-removed containers that have no decision yet
    const workspaces = [
        ...new Set(
            getAllContainers(config)
                .filter((c) => c.removedAt === null)
                .map((c) => c.workspace)
        ),
    ].filter((ws) => !(ws in config.workspaceSettings) && existsSync(ws) && statSync(ws).isDirectory());

    // Nothing to decide — just mark done silently
    if (workspaces.length === 0) {
        config.backupMigrationDone = true;
        saveConfig(config, configDir);
        return;
    }

    logger.blank();
    console.log(chalk.yellow.bold('  ⚠  One-time backup setup'));
    console.log(chalk.dim('  These workspaces have no backup preference. Choose which to enable.'));
    console.log(chalk.dim('  Selected workspaces will be backed up now before entering the menu.'));
    logger.blank();

    const choices = workspaces.map((ws) => {
        const { bytes, estimatedSeconds } = estimateWorkspaceSize(ws);
        return {
            name: `${ws}  ${chalk.dim(`(${formatBytes(bytes)} · ${formatDuration(estimatedSeconds)})`)}`,
            value: ws,
            checked: true,
        };
    });

    let selected: string[];
    try {
        selected = await withEscBack((s) => checkbox<string>({ message: 'Enable automatic backups for:', choices }, { signal: s }));
    } catch (err) {
        // ESC or Ctrl+C — defer migration to next launch
        if ((err as Error).name === 'BackError' || (err as Error).name === 'ExitPromptError') return;
        throw err;
    }

    const selectedSet = new Set(selected);
    for (const ws of workspaces) {
        config.workspaceSettings[ws] = { backup: selectedSet.has(ws) };
    }
    config.backupMigrationDone = true;
    saveConfig(config, configDir);

    for (const ws of selected) {
        const spin = spinner(`Backing up ${ws}...`).start();
        try {
            await createBackup(configDir, ws, (msg) => {
                spin.text = msg;
            });
            spin.succeed(`Backed up: ${ws}`);
        } catch (err) {
            spin.fail(`Backup failed: ${ws}`);
            appLogger.error('Migration backup failed', { workspace: ws, error: String(err) });
        }
    }
}

// ── Per-workspace backup settings ────────────────────────────────────────────

export async function promptWorkspaceBackupSettings(configDir: string, workspace: string): Promise<void> {
    const { select, confirm } = await getPrompts();

    const config = loadConfig(configDir);
    const current = config.workspaceSettings[workspace]?.backup ?? config.settings.backup;

    logger.blank();
    console.log(chalk.bold('  Workspace Backup Settings'));
    console.log(chalk.gray('  Workspace : ') + chalk.cyan(workspace));
    console.log(chalk.gray('  Current   : ') + (current ? chalk.green('enabled') : chalk.red('disabled')));
    logger.blank();

    const updated = await withEscBack((s) =>
        select<boolean>(
            {
                message: 'Automatic backups for this workspace:',
                choices: [
                    { name: 'Enabled', value: true },
                    { name: 'Disabled', value: false },
                ],
                default: current,
            },
            { signal: s }
        )
    );

    config.workspaceSettings[workspace] = { backup: updated };

    if (current && !updated) {
        const backupDir = backupDirForWorkspace(configDir, workspace);
        const entries = loadBackupIndex(backupDir);
        if (entries.length > 0) {
            const totalBytes = entries.reduce((sum, e) => sum + e.sizeBytes, 0);
            logger.blank();
            const doDelete = await withEscBack((s) =>
                confirm(
                    {
                        message: `Delete ${entries.length} existing backup(s) for this workspace? (${formatBytes(totalBytes)})`,
                        default: false,
                    },
                    { signal: s }
                )
            );
            if (doDelete) {
                deleteWorkspaceBackups(configDir, workspace);
                logger.success('Backups deleted.');
            }
        }
    }

    saveConfig(config, configDir);
    logger.success(`Backup ${updated ? 'enabled' : 'disabled'} for ${workspace}`);
}

export interface StartWizardResult {
    workspace: string;
    image: string;
    tag: string;
    backup: boolean;
}

/**
 * Multi-step wizard for deploying a new container.
 * Returns the workspace, image, and tag if confirmed, or null if cancelled.
 */
export async function startWizard(
    currentWorkspace: string,
    settings: ConfigFile['settings'],
    workspaceSettings: Record<string, WorkspaceSettings>
): Promise<StartWizardResult | null> {
    const { select, input, confirm } = await getPrompts();

    // ── Step 1: Workspace ──
    const rawWorkspace = await withEscBack((s) => input({ message: 'Workspace path (press Enter to keep current):', default: currentWorkspace }, { signal: s }));
    const workspace = resolve(rawWorkspace);
    if (!existsSync(workspace) || !statSync(workspace).isDirectory()) {
        logger.error(`Directory does not exist: ${workspace}`);
        return null;
    }

    // ── Step 2: Image selection ──
    const image = DEFAULT_IMAGE;

    const imageChoices: { name: string; value: string }[] = [{ name: `latest  ${chalk.dim('(default — highest node + python)')}`, value: 'latest' }];

    // Show "default from settings" if it differs from latest
    const settingsTag = settings.defaultTag || DEFAULT_IMAGE_TAG;
    if (settingsTag !== 'latest') {
        imageChoices.push({
            name: `${settingsTag}  ${chalk.dim('(from settings)')}`,
            value: settingsTag,
        });
    }

    imageChoices.push({ name: `Custom  ${chalk.dim('(pick node + python versions)')}`, value: '__custom__' });

    const imageChoice = await withEscBack((s) => select<string>({ message: 'Select image tag:', choices: imageChoices }, { signal: s }));

    let tag: string;
    if (imageChoice === '__custom__') {
        // ── Step 2a: Node version ──
        const nodeMajors = versions.node.map((v) => v.split('.')[0]);
        const nodeChoices = nodeMajors.map((major, i) => ({
            name: `Node ${major}  ${chalk.dim(`(${versions.node[i]})`)}`,
            value: major,
        }));
        const selectedNode = await withEscBack((s) => select<string>({ message: 'Select Node.js version:', choices: nodeChoices }, { signal: s }));

        // ── Step 2b: Python version ──
        const pythonChoices = versions.python.map((ver) => ({
            name: `Python ${ver}`,
            value: ver,
        }));
        const selectedPython = await withEscBack((s) => select<string>({ message: 'Select Python version:', choices: pythonChoices }, { signal: s }));

        tag = `${DOCKER_IMAGE_VERSION}_node${selectedNode}_python${selectedPython}`;
    } else {
        tag = imageChoice;
    }

    // ── Step 3: Backup ──
    const backupDefault = workspaceSettings[workspace]?.backup ?? settings.backup;
    const doBackup = await withEscBack((s) => confirm({ message: 'Backup workspace before starting?', default: backupDefault }, { signal: s }));

    // ── Step 4: Confirmation ──
    const imageRef = `${image}:${tag}`;
    logger.blank();
    console.log(chalk.bold('  Container Summary'));
    console.log(chalk.gray('  Workspace : ') + chalk.cyan(workspace));
    console.log(chalk.gray('  Image     : ') + chalk.cyan(image));
    console.log(chalk.gray('  Tag       : ') + chalk.cyan(tag));
    console.log(chalk.gray('  Full ref  : ') + chalk.cyan(imageRef));
    console.log(chalk.gray('  Backup    : ') + chalk.cyan(doBackup ? 'yes' : 'no'));
    logger.blank();

    const confirmed = await withEscBack((s) => confirm({ message: 'Deploy this container?', default: true }, { signal: s }));

    if (!confirmed) {
        logger.info('Cancelled.');
        return null;
    }

    return { workspace, image, tag, backup: doBackup };
}

/**
 * Show the main interactive menu. Returns the argv fragment to run, or null if
 * exit/help was handled internally (process.exit / program.help called).
 */
export async function promptMainMenu(program: Command): Promise<string[] | null> {
    const { select, Separator } = await getPrompts();

    const choice = await withEscBack((s) => {
        if (!globalOpts.id) {
            return select<string>(
                {
                    message: 'Select an action:',
                    choices: [
                        new Separator('── Container Management ──'),
                        { name: 'Select active container', value: 'use' },
                        { name: 'Deploy new container (wizard)', value: 'start-wizard' },
                        { name: 'List containers', value: 'ls' },
                        { name: 'List all history (including removed)', value: 'history' },
                        new Separator('── Container Bulk Lifecycle ──'),
                        { name: 'Start all stopped containers', value: 'start-all' },
                        { name: 'Stop all running containers', value: 'stop-all' },
                        { name: 'Remove all containers', value: 'remove-all' },
                        { name: 'Cleanup old history', value: 'cleanup' },
                        new Separator('── Authentication ──'),
                        { name: 'Auth setup wizard', value: 'auth-setup' },
                        { name: 'Auth status', value: 'auth-status' },
                        new Separator('── Configuration ──'),
                        { name: 'List settings', value: 'config-list' },
                        { name: 'Get a setting', value: 'config-get' },
                        { name: 'Set a setting', value: 'config-set' },
                        { name: 'Reset settings', value: 'config-reset' },
                        new Separator('──'),
                        { name: 'Show help', value: '__help__' },
                        { name: 'Exit', value: '__exit__' },
                    ],
                },
                { signal: s }
            );
        } else {
            return select<string>(
                {
                    message: 'Select an action:',
                    choices: [
                        new Separator('── Container Management ──'),
                        { name: 'Select active container', value: 'use' },
                        { name: `Start ${globalOpts.id ? 'selected' : 'new'} container`, value: 'start' },
                        { name: 'Stop selected container', value: 'stop' },
                        { name: 'Remove selected container', value: 'remove' },
                        { name: 'Attach to Claude Code process', value: 'attach' },
                        { name: 'Open bash session', value: 'shell' },
                        { name: 'Manage workspace backups', value: 'workspace-backup' },
                        { name: 'List containers', value: 'ls' },
                        { name: 'List all history (including removed)', value: 'history' },
                        new Separator('── Container Bulk Lifecycle ──'),
                        { name: 'Start all stopped containers', value: 'start-all' },
                        { name: 'Stop all running containers', value: 'stop-all' },
                        { name: 'Remove all containers', value: 'remove-all' },
                        { name: 'Cleanup old history', value: 'cleanup' },
                        new Separator('── Authentication ──'),
                        { name: 'Auth setup wizard', value: 'auth-setup' },
                        { name: 'Auth status', value: 'auth-status' },
                        new Separator('── Configuration ──'),
                        { name: 'List settings', value: 'config-list' },
                        { name: 'Get a setting', value: 'config-get' },
                        { name: 'Set a setting', value: 'config-set' },
                        { name: 'Reset settings', value: 'config-reset' },
                        new Separator('──'),
                        { name: 'Show help', value: '__help__' },
                        { name: 'Exit', value: '__exit__' },
                    ],
                },
                { signal: s }
            );
        }
    });

    switch (choice) {
        case '__exit__':
            appLogger.info('Interactive session ended (user exit)');
            process.exit(0);
            return null; // unreachable in production; needed when process.exit is mocked in tests
        case '__help__':
            program.help();
            return null; // program.help() calls process.exit; needed when mocked
        case 'start-wizard':
            return ['__start-wizard__'];
        case 'start':
            return ['start'];
        case 'stop':
            return ['stop'];
        case 'start-all':
            return ['start-all'];
        case 'stop-all':
            return ['stop-all'];
        case 'remove-all':
            return ['__remove-all__'];
        case 'cleanup':
            return ['__cleanup__'];
        case 'remove':
            return ['remove'];
        case 'attach':
            return ['attach'];
        case 'shell':
            return ['shell'];
        case 'workspace-backup':
            return ['__workspace-backup__'];
        case 'ls':
            return ['ls'];
        case 'history':
            return ['history'];
        case 'use':
            return ['use'];
        case 'use-clear':
            return ['use', '--clear'];
        case 'change-workspace':
            return ['__change-workspace__'];
        case 'auth-setup':
            return ['auth', 'setup'];
        case 'auth-status':
            return ['auth', 'status'];
        case 'config-list':
            return ['config', 'list'];
        case 'config-get':
            return promptConfigGet();
        case 'config-set':
            return promptConfigSet();
        case 'config-reset':
            return promptConfigReset();
        default:
            return [];
    }
}

/**
 * Run a command via parseAsync, intercepting process.exit(non-zero) so a
 * single command failure cannot terminate the interactive session.
 * process.exit(0) is still allowed (e.g. --help inside a subcommand).
 */
async function parseAsyncInteractive(program: Command, argv: string[]): Promise<void> {
    const origExit = process.exit.bind(process);
    const proc = process as unknown as Record<string, typeof process.exit>;
    proc['exit'] = (code?: number | string) => {
        const n = code === undefined ? 0 : typeof code === 'number' ? code : parseInt(String(code), 10);
        if (n === 0) origExit(0 as never); // clean exit — let it through
        proc['exit'] = origExit; // restore before throwing
        const err = new Error(`Command exited with code ${n}`);
        err.name = 'CommandExitError';
        throw err;
    };
    try {
        await program.parseAsync(argv, { from: 'user' });
    } finally {
        proc['exit'] = origExit;
    }
}

async function pressAnyKey(): Promise<void> {
    if (typeof process.stdin.setRawMode !== 'function') return;
    process.stdout.write(chalk.gray('\n  Press any key to return to the menu...'));
    await new Promise<void>((resolve) => {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.once('data', (data: Buffer) => {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            if (data[0] === 3) {
                // Ctrl+C
                process.stdout.write('\n');
                process.exit(0);
            }
            resolve();
        });
    });
    process.stdout.write('\n');
}

export async function runInteractiveMode(program: Command, opts: GlobalOpts): Promise<void> {
    if (!process.stdin.isTTY) {
        program.help();
        return;
    }

    globalOpts.id = opts.id;
    globalOpts.workspace = opts.workspace;
    globalOpts.configDir = opts.configDir;

    appLogger.info('Interactive session started', { workspace: opts.workspace, configDir: opts.configDir });

    await promptBackupMigration(globalOpts.configDir);

    while (true) {
        logger.blank();
        const cliVersion = program.version() ?? 'unknown';
        console.log(chalk.bold(`  Claude Code Sandbox CLI (${cliVersion}) — Interactive Mode`));

        const config = loadConfig(globalOpts.configDir);
        const currentId = globalOpts.id ?? null;
        const selectedContainer = currentId ? findContainerById(config, currentId) : null;
        const shortId = selectedContainer ? selectedContainer.id.replace(/-/g, '').slice(0, 8) : null;
        const workspace = selectedContainer ? selectedContainer.workspace : resolveWorkspace(globalOpts.workspace);

        if (!selectedContainer) {
            globalOpts.id = undefined;
        }

        console.log(chalk.gray('  Container : ') + (shortId ? chalk.cyan(shortId) : chalk.dim('none')));
        console.log(chalk.gray('  Workspace : ') + chalk.cyan(workspace));

        const auth = getStoredAuth(join(globalOpts.configDir, '.env'));
        if (!auth) {
            logger.line();
            console.log(chalk.bgRed.white.bold('  ⚠  No authentication configured  '));
            console.log(chalk.red('  Run: select Auth Setup Wizard options from menu'));
            console.log(chalk.dim('  or set ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN env variable'));
        }

        logger.line();

        try {
            const commandArgs = await promptMainMenu(program);
            if (commandArgs === null) break;

            const actionLabel = commandArgs[0] ?? '';
            appLogger.info(`Menu action selected: ${actionLabel}`, { args: commandArgs, containerId: globalOpts.id });

            // Handle container selection inline — no need to shell out to a subcommand
            if (commandArgs[0] === 'use' && commandArgs.length === 1) {
                const chosen = await promptContainerSelect(config, currentId);
                globalOpts.id = chosen ?? undefined;
                setSessionContainerId(chosen);
                if (chosen) {
                    const rec = findContainerById(config, chosen);
                    const label = rec ? rec.id.replace(/-/g, '').slice(0, 8) : chosen;
                    logger.success(`Selected container: ${label}`);
                    appLogger.info('Container selected', { containerId: chosen });
                } else {
                    globalOpts.id = undefined;
                    logger.success('Container selection cleared.');
                    appLogger.info('Container selection cleared');
                }
                // await pressAnyKey();
                continue;
            }
            if (commandArgs[0] === 'use' && commandArgs[1] === '--clear') {
                globalOpts.id = undefined;
                setSessionContainerId(null);
                logger.success('Container selection cleared.');
                appLogger.info('Container selection cleared');
                await pressAnyKey();
                continue;
            }

            // Handle start wizard inline
            if (commandArgs[0] === '__start-wizard__') {
                const wizardAuth = getStoredAuth(join(globalOpts.configDir, '.env'));
                if (!wizardAuth) {
                    logger.blank();
                    logger.error('No authentication credentials found. Cannot create a new instance.');
                    console.log(chalk.dim('  Set one of:'));
                    console.log('    ' + chalk.yellow('ANTHROPIC_API_KEY') + chalk.dim('=sk-ant-api03-...'));
                    console.log('    ' + chalk.yellow('CLAUDE_CODE_OAUTH_TOKEN') + chalk.dim('=sk-ant-oat01-...'));
                    console.log(chalk.dim('  Or run: ') + chalk.cyan('claude-code-sandbox auth setup'));
                    await pressAnyKey();
                    continue;
                }
                const result = await startWizard(workspace, config.settings, config.workspaceSettings);
                if (result) {
                    appLogger.info('Start wizard completed', { workspace: result.workspace, image: result.image, tag: result.tag });
                    globalOpts.workspace = result.workspace;
                    const fullArgv = [...buildGlobalFlags(), 'start', '--image', result.image, '--tag', result.tag, '--backup', String(result.backup)];
                    await parseAsyncInteractive(program, fullArgv);

                    // Persist the backup preference chosen in the wizard
                    const freshConfig = loadConfig(globalOpts.configDir);
                    freshConfig.workspaceSettings[result.workspace] = { backup: result.backup };
                    saveConfig(freshConfig, globalOpts.configDir);
                    const newContainers = findContainersByWorkspace(freshConfig, result.workspace)
                        .filter((c) => c.lastStatus === 'running')
                        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
                    if (newContainers.length > 0) {
                        globalOpts.id = newContainers[0].id;
                        setSessionContainerId(newContainers[0].id);
                        const label = newContainers[0].id.replace(/-/g, '').slice(0, 8);
                        logger.success(`Auto-selected container: ${label}`);
                        appLogger.info('Container auto-selected after deploy', { containerId: newContainers[0].id });
                    }

                    await pressAnyKey();
                } else {
                    appLogger.info('Start wizard cancelled');
                }
                continue;
            }

            // Handle workspace backup settings
            if (commandArgs[0] === '__workspace-backup__') {
                await promptWorkspaceBackupSettings(globalOpts.configDir, workspace);
                await pressAnyKey();
                continue;
            }

            // Handle remove-all: run command then clear selected container
            if (commandArgs[0] === '__remove-all__') {
                const fullArgv = [...buildGlobalFlags(), 'remove-all'];
                await parseAsyncInteractive(program, fullArgv);
                globalOpts.id = undefined;
                setSessionContainerId(null);
                await pressAnyKey();
                continue;
            }

            // Handle cleanup: ask user for days value
            if (commandArgs[0] === '__cleanup__') {
                const { select, input } = await getPrompts();
                const settingsDays = config.settings.cleanupDays;
                const daysChoice = await withEscBack((s) =>
                    select<string>(
                        {
                            message: `Cleanup containers removed more than N days ago:`,
                            choices: [
                                { name: `Use settings value (${settingsDays} days)`, value: 'settings' },
                                { name: 'Enter a different number (one-time)', value: 'custom' },
                            ],
                        },
                        { signal: s }
                    )
                );
                let days: string;
                if (daysChoice === 'custom') {
                    days = await withEscBack((s) => input({ message: 'Number of days:', default: String(settingsDays) }, { signal: s }));
                } else {
                    days = String(settingsDays);
                }
                appLogger.info('Cleanup action', { days });
                const fullArgv = [...buildGlobalFlags(), 'cleanup', '--days', days];
                await parseAsyncInteractive(program, fullArgv);
                await pressAnyKey();
                continue;
            }

            // Handle workspace change inline
            if (commandArgs[0] === '__change-workspace__') {
                const { input } = await getPrompts();
                const raw = await withEscBack((s) => input({ message: 'New workspace path:', default: resolveWorkspace(globalOpts.workspace) }, { signal: s }));
                const abs = resolve(raw);
                if (!existsSync(abs) || !statSync(abs).isDirectory()) {
                    logger.error(`Directory does not exist: ${abs}`);
                    await pressAnyKey();
                } else {
                    globalOpts.workspace = abs;
                    logger.success(`Workspace updated: ${abs}`);
                    appLogger.info('Workspace changed', { workspace: abs });
                }
                continue;
            }

            const fullArgv = [...buildGlobalFlags(), ...commandArgs];
            await parseAsyncInteractive(program, fullArgv);
            appLogger.info(`Menu action completed: ${actionLabel}`);
            await pressAnyKey();
        } catch (err) {
            const name = (err as Error).name;
            if (name === 'ExitPromptError') {
                appLogger.info('Interactive session ended (prompt closed)');
                logger.blank();
                process.exit(0);
                return; // unreachable in production; needed when process.exit is mocked in tests
            }
            if (name === 'BackError') {
                appLogger.debug('ESC pressed — returning to menu');
                continue; // ESC pressed — redisplay the menu
            }
            // CommandExitError (process.exit called by a command) or any unexpected throw:
            // The command has already printed its error. For truly unexpected errors,
            // also print the message so the user isn't left with a blank screen.
            if (name !== 'CommandExitError' && name !== 'CommanderError') {
                appLogger.error((err as Error).message || String(err), { errorName: name });
                logger.error((err as Error).message || String(err));
            } else {
                appLogger.warn(`Command exited with error`, { errorName: name });
            }
            await pressAnyKey();
        }
    }
}
