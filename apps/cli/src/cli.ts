import { Command } from 'commander';
import { createRequire } from 'module';
import { makeStartCommand } from './commands/start.js';
import { makeStopCommand } from './commands/stop.js';
import { makeStartAllCommand } from './commands/start-all.js';
import { makeStopAllCommand } from './commands/stop-all.js';
import { makeRemoveCommand } from './commands/remove.js';
import { makeRemoveAllCommand } from './commands/remove-all.js';
import { makeCleanupCommand } from './commands/cleanup.js';
import { makeAttachCommand } from './commands/attach.js';
import { makeShellCommand } from './commands/shell.js';
import { makeLsCommand } from './commands/ls.js';
import { makeHistoryCommand } from './commands/history.js';
import { makeUseCommand } from './commands/use.js';
import { makeAuthCommand } from './commands/auth.js';
import { makeConfigCommand } from './commands/config.js';
import { DEFAULT_CONFIG_DIR, ENV_VARS } from './lib/constants.js';
import { runInteractiveMode } from './lib/interactive.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const program = new Command();

program
    .name('claude-code-sandbox')
    .description('Manage Claude Code sandbox Docker containers')
    .version(pkg.version, '-v, --version', 'Print version')
    .helpOption('-h, --help', 'Show help')
    // Global options available to all subcommands via this.optsWithGlobals()
    .option('--config-dir <path>', 'Config directory', process.env[ENV_VARS.CONFIG_DIR] ?? DEFAULT_CONFIG_DIR)
    .option('-w, --workspace <path>', 'Workspace directory (default: cwd)', process.env[ENV_VARS.WORKSPACE])
    .option('--id <id>', 'Target container by ID or short ID');

program.addCommand(makeStartCommand());
program.addCommand(makeStopCommand());
program.addCommand(makeStartAllCommand());
program.addCommand(makeStopAllCommand());
program.addCommand(makeRemoveCommand());
program.addCommand(makeRemoveAllCommand());
program.addCommand(makeAttachCommand());
program.addCommand(makeShellCommand());
program.addCommand(makeLsCommand());
program.addCommand(makeHistoryCommand());
program.addCommand(makeUseCommand());
program.addCommand(makeAuthCommand());
program.addCommand(makeCleanupCommand());
program.addCommand(makeConfigCommand());

program.action(async function (this: Command) {
    if (this.args.length > 0) {
        this.error(`unknown command '${String(this.args[0])}'`);
    }
    await runInteractiveMode(program, this.opts());
});

program.parseAsync(process.argv).catch((err: unknown) => {
    if ((err as Error).name === 'BackError') {
        // ESC pressed during a prompt in direct command mode — exit cleanly
        process.exit(0);
    }
    console.error(err);
    process.exit(1);
});
