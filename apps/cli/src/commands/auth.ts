import { Command } from 'commander';
import chalk from 'chalk';
import { writeFileSync, chmodSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { logger } from '../utils/logger.js';
import { loadConfig, saveConfig } from '../lib/config-store.js';
import { TOKEN_PREFIXES, AUTH_METHODS, DEFAULT_CONFIG_DIR, type AuthMethod } from '../lib/constants.js';
import { withEscBack } from '../lib/prompt-utils.js';

export function maskToken(token: string): string {
    if (token.length <= 12) return '***';
    return token.slice(0, 10) + '***' + token.slice(-4);
}

export function validateToken(token: string, method: AuthMethod): boolean {
    return token.startsWith(TOKEN_PREFIXES[method]);
}

/**
 * Resolve stored auth credentials.
 * @param envFilePath Path to the .env file (defaults to ~/.claude-code-sandbox/.env)
 */
export function getStoredAuth(envFilePath?: string): Record<string, string> | null {
    // 1. Check environment variables
    if (process.env.ANTHROPIC_API_KEY) {
        return { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };
    }
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
        return { CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN };
    }

    // 2. Check .env file
    const file = envFilePath ?? join(DEFAULT_CONFIG_DIR, '.env');
    if (existsSync(file)) {
        const env: Record<string, string> = {};
        for (const line of readFileSync(file, 'utf-8').split('\n')) {
            const [key, ...rest] = line.split('=');
            if (key?.trim() && rest.length) env[key.trim()] = rest.join('=').trim();
        }
        if (env.ANTHROPIC_API_KEY) return { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY };
        if (env.CLAUDE_CODE_OAUTH_TOKEN) return { CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN };
    }

    return null;
}

async function runAuthWizard(configDir: string): Promise<void> {
    const { select, password } = await import('@inquirer/prompts');
    const envFilePath = join(configDir, '.env');

    logger.blank();
    console.log(chalk.bold.cyan('  Claude Sandbox — Auth Setup'));
    logger.line();
    console.log();
    console.log('  Claude Code needs credentials to operate.');
    console.log('  You can use either an API Key or an OAuth Token.');
    console.log();

    const method = await withEscBack((s) =>
        select<AuthMethod>(
            {
                message: 'Which authentication method?',
                choices: [
                    { name: 'API Key  (from console.anthropic.com — pay per token)', value: AUTH_METHODS.API_KEY },
                    { name: 'OAuth Token  (from Claude Pro/Max — run: claude setup-token)', value: AUTH_METHODS.OAUTH_TOKEN },
                ],
            },
            { signal: s }
        )
    );

    logger.blank();

    if (method === AUTH_METHODS.API_KEY) {
        console.log(chalk.bold('  How to get an API Key:'));
        console.log('  1. Go to ' + chalk.underline('https://console.anthropic.com/settings/keys'));
        console.log('  2. Click "Create Key" — it starts with ' + chalk.cyan('sk-ant-api03-'));
    } else {
        console.log(chalk.bold('  How to get an OAuth Token:'));
        console.log('  1. Install Claude Code: ' + chalk.cyan('npm install -g @anthropic-ai/claude-code'));
        console.log('  2. Run: ' + chalk.cyan('claude setup-token'));
        console.log('  3. Follow the steps in the Claude app (login + allow access)');
        console.log('  4. Token starts with ' + chalk.cyan('sk-ant-oat01-'));
    }
    console.log();

    const envKey = method === AUTH_METHODS.API_KEY ? 'ANTHROPIC_API_KEY' : 'CLAUDE_CODE_OAUTH_TOKEN';
    const token = await withEscBack((s) => password({ message: `Paste your ${envKey}:`, mask: '*' }, { signal: s }));

    if (!token) {
        logger.error('No token provided.');
        process.exit(1);
    }

    if (!validateToken(token, method)) {
        logger.warn(`Token doesn't look right. Expected prefix: ${TOKEN_PREFIXES[method]}`);
        logger.warn('Saving anyway — verify it works with `claude-code-sandbox start`.');
    }

    logger.blank();

    const storage = await withEscBack((s) =>
        select(
            {
                message: 'How should the credential be stored?',
                choices: [
                    { name: `Save to ${envFilePath}  (persistent, recommended)`, value: 'file' },
                    { name: 'Show export command only  (you handle storage)', value: 'show' },
                ],
            },
            { signal: s }
        )
    );

    if (storage === 'file') {
        mkdirSync(dirname(envFilePath), { recursive: true });
        writeFileSync(envFilePath, `${envKey}=${token}\n`, { mode: 0o600 });
        if (process.platform !== 'win32') {
            chmodSync(envFilePath, 0o600);
        }

        const config = loadConfig(configDir);
        config.settings.authMethod = method;
        saveConfig(config, configDir);

        logger.success(`Credentials saved to ${envFilePath}`);
        if (process.platform === 'win32') {
            logger.info('On Windows, restrict access to this file via its Properties > Security settings.');
        } else {
            logger.info('The file is only readable by you (chmod 600).');
        }
    } else {
        logger.blank();
        if (process.platform === 'win32') {
            console.log('  Add this to your PowerShell profile ($PROFILE):');
            console.log();
            console.log(chalk.cyan(`  $env:${envKey} = "your-token-here"`));
            console.log();
            console.log('  Or set it permanently for all sessions:');
            console.log(chalk.cyan(`  setx ${envKey} "your-token-here"`));
        } else {
            console.log('  Add this to your shell profile (~/.bashrc or ~/.zshrc):');
            console.log();
            console.log(chalk.cyan(`  export ${envKey}=${maskToken(token)}`));
        }
        console.log();
        logger.warn('The token above is masked — paste your actual token.');
    }

    logger.blank();
    logger.success('Auth setup complete. Run `claude-code-sandbox start` to launch the sandbox.');
    logger.blank();
}

async function showAuthStatus(configDir: string): Promise<void> {
    const envFilePath = join(configDir, '.env');
    const stored = getStoredAuth(envFilePath);

    logger.blank();
    console.log(chalk.bold('  Auth Status'));
    logger.line();

    if (!stored) {
        console.log(`  ${chalk.red('No credentials found.')}`);
        console.log();
        console.log('  Run ' + chalk.cyan('claude-code-sandbox auth setup') + ' to configure credentials.');
    } else {
        const key = Object.keys(stored)[0];
        const value = stored[key];
        const source = process.env[key] ? 'environment variable' : envFilePath;
        console.log(`  Method  : ${chalk.green(key)}`);
        console.log(`  Token   : ${chalk.yellow(maskToken(value))}`);
        console.log(`  Source  : ${source}`);
    }

    logger.line();
    logger.blank();
}

export function makeAuthCommand(): Command {
    const auth = new Command('auth').description('Configure Claude credentials for the sandbox').action(async function (this: Command) {
        const g = this.optsWithGlobals();
        await runAuthWizard(String(g.configDir));
    });

    auth.command('setup')
        .description('Interactive credential setup wizard')
        .action(async function (this: Command) {
            const g = this.optsWithGlobals();
            await runAuthWizard(String(g.configDir));
        });

    auth.command('status')
        .description('Show current authentication status')
        .action(async function (this: Command) {
            const g = this.optsWithGlobals();
            await showAuthStatus(String(g.configDir));
        });

    return auth;
}
