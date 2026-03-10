import { Command } from 'commander';
import chalk from 'chalk';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import { loadConfig, saveConfig, DEFAULT_CLEANUP_DAYS, DEFAULT_BACKUP } from '../lib/config-store.js';
import { DEFAULT_IMAGE, DEFAULT_IMAGE_TAG } from '../lib/constants.js';
import { validateImageName, validateTag } from '../utils/validation.js';

type SettingsKey = 'defaultImage' | 'defaultTag' | 'authMethod' | 'gitUserName' | 'gitUserEmail' | 'cleanupDays' | 'backup';

const VALID_KEYS: SettingsKey[] = ['defaultImage', 'defaultTag', 'authMethod', 'gitUserName', 'gitUserEmail', 'cleanupDays', 'backup'];

const DEFAULTS: Record<SettingsKey, string | number | boolean | null> = {
    defaultImage: DEFAULT_IMAGE,
    defaultTag: DEFAULT_IMAGE_TAG,
    authMethod: null,
    gitUserName: null,
    gitUserEmail: null,
    cleanupDays: DEFAULT_CLEANUP_DAYS,
    backup: DEFAULT_BACKUP,
};

function validateValue(key: SettingsKey, value: string): string | null {
    if (key === 'defaultImage') return validateImageName(value);
    if (key === 'defaultTag') return validateTag(value);
    if (key === 'authMethod') {
        if (!['api_key', 'oauth_token', 'null'].includes(value)) {
            return `authMethod must be "api_key", "oauth_token", or "null"`;
        }
    }
    if (key === 'cleanupDays') {
        const n = parseInt(value, 10);
        if (isNaN(n) || n < 0) {
            return `cleanupDays must be a non-negative integer`;
        }
    }
    if (key === 'backup') {
        if (!['true', 'false'].includes(value)) {
            return `backup must be "true" or "false"`;
        }
    }
    return null;
}

export function makeConfigCommand(): Command {
    const cfg = new Command('config').description('Manage persistent CLI settings');

    cfg.command('list')
        .description('Show all settings')
        .option('--json', 'Output as JSON')
        .action(function (this: Command, opts: { json?: boolean }) {
            const g = this.optsWithGlobals();
            const config = loadConfig(String(g.configDir));
            const s = config.settings;
            const display = {
                defaultImage: s.defaultImage,
                defaultTag: s.defaultTag,
                authMethod: s.authMethod,
                gitUserName: s.gitUserName,
                gitUserEmail: s.gitUserEmail,
                cleanupDays: s.cleanupDays,
                backup: s.backup,
            };

            if (opts.json) {
                console.log(JSON.stringify(display, null, 2));
                return;
            }

            logger.blank();
            console.log(chalk.bold('  Settings'));
            logger.line();
            console.log(`  File: ${chalk.gray(join(String(g.configDir), 'config.json'))}`);
            logger.line();

            for (const [key, value] of Object.entries(display)) {
                const def = DEFAULTS[key as SettingsKey];
                const isDefault = value === def || (value === null && def === null);
                const displayVal = value === null ? chalk.gray('(not set)') : chalk.cyan(String(value));
                const tag = isDefault ? chalk.gray('default') : chalk.green('custom');
                console.log(`  ${key.padEnd(16)} ${displayVal.padEnd(40)} ${tag}`);
            }
            console.log(chalk.gray(`\n  Tip: "cleanupDays" controls how long removed containers are kept in history.`));

            logger.line();
            logger.blank();
        });

    cfg.command('get <key>')
        .description('Get a setting value')
        .action(function (this: Command, key: string) {
            const g = this.optsWithGlobals();
            if (!VALID_KEYS.includes(key as SettingsKey)) {
                logger.error(`Unknown key: "${key}". Valid keys: ${VALID_KEYS.join(', ')}`);
                process.exit(1);
            }
            const config = loadConfig(String(g.configDir));
            const value = config.settings[key as keyof typeof config.settings];
            console.log(value === null ? '' : String(value));
        });

    cfg.command('set <key> <value>')
        .description('Set a setting value')
        .action(function (this: Command, key: string, value: string) {
            const g = this.optsWithGlobals();
            if (!VALID_KEYS.includes(key as SettingsKey)) {
                logger.error(`Unknown key: "${key}". Valid keys: ${VALID_KEYS.join(', ')}`);
                process.exit(1);
            }
            const err = validateValue(key as SettingsKey, value);
            if (err) {
                logger.error(err);
                process.exit(1);
            }

            const config = loadConfig(String(g.configDir));
            let parsed: string | number | boolean | null = value === 'null' ? null : value;
            if (key === 'cleanupDays') parsed = parseInt(value, 10);
            if (key === 'backup') parsed = value === 'true';
            (config.settings as unknown as Record<string, string | number | boolean | null>)[key] = parsed;
            saveConfig(config, String(g.configDir));
            logger.success(`Set ${key} = ${value}`);
        });

    cfg.command('reset [key]')
        .description('Reset a key to its default value, or reset all settings')
        .action(async function (this: Command, key?: string) {
            const g = this.optsWithGlobals();

            if (key) {
                if (!VALID_KEYS.includes(key as SettingsKey)) {
                    logger.error(`Unknown key: "${key}". Valid keys: ${VALID_KEYS.join(', ')}`);
                    process.exit(1);
                }
                const config = loadConfig(String(g.configDir));
                (config.settings as unknown as Record<string, string | number | boolean | null>)[key] = DEFAULTS[key as SettingsKey];
                saveConfig(config, String(g.configDir));
                logger.success(`Reset ${key} to default.`);
                return;
            }

            const { confirm } = await import('@inquirer/prompts');
            const ok = await confirm({ message: 'Reset ALL settings to defaults?', default: false });
            if (ok) {
                const config = loadConfig(String(g.configDir));
                config.settings.defaultImage = DEFAULT_IMAGE;
                config.settings.defaultTag = DEFAULT_IMAGE_TAG;
                config.settings.authMethod = null;
                config.settings.gitUserName = null;
                config.settings.gitUserEmail = null;
                config.settings.cleanupDays = DEFAULT_CLEANUP_DAYS;
                config.settings.backup = DEFAULT_BACKUP;
                saveConfig(config, String(g.configDir));
                logger.success('All settings reset to defaults.');
            } else {
                logger.info('Cancelled.');
            }
        });

    return cfg;
}
