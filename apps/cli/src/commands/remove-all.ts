import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, saveConfig } from '../lib/config-store.js';
import { getAllContainers, syncContainerStatuses, markContainerRemoved } from '../lib/container-store.js';
import { isDockerRunning, getContainerStates, stopExistingContainer, removeContainerFromDocker, shortId } from '../lib/docker.js';
import { logger } from '../utils/logger.js';

export function makeRemoveAllCommand(): Command {
    return new Command('remove-all')
        .description('Remove all containers from Docker (stop if running, preserve in history)')
        .option('-f, --force', 'Skip confirmation prompt')
        .action(async function (this: Command, opts: { force?: boolean }) {
            const g = this.optsWithGlobals();

            if (!(await isDockerRunning())) {
                logger.error('Docker is not running or not accessible.');
                process.exit(1);
            }

            const config = loadConfig(String(g.configDir));
            const containers = getAllContainers(config, false);

            if (containers.length === 0) {
                logger.info('No containers found.');
                return;
            }

            const names = containers.map((c) => c.name);
            syncContainerStatuses(config, await getContainerStates(names));

            const toRemove = getAllContainers(config, false);

            if (toRemove.length === 0) {
                logger.info('No containers to remove.');
                return;
            }

            if (!opts.force) {
                const { confirm } = await import('@inquirer/prompts');
                console.log(chalk.yellow(`\n  This will permanently remove ${toRemove.length} container(s):`));
                for (const c of toRemove) {
                    console.log(`    ${shortId(c.id)}  ${c.workspace}  [${c.lastStatus}]`);
                }
                console.log('');
                const ok = await confirm({
                    message: `Remove all ${toRemove.length} containers? This cannot be undone.`,
                    default: false,
                });
                if (!ok) {
                    logger.info('Cancelled.');
                    return;
                }
            }

            let removed = 0;
            for (const c of toRemove) {
                process.stdout.write(`  ${shortId(c.id)}  ${c.workspace.slice(-40).padEnd(40)} `);
                try {
                    // Stop first if running
                    if (c.lastStatus === 'running' || c.lastStatus === 'paused') {
                        await stopExistingContainer(c.name);
                    }
                    await removeContainerFromDocker(c.name);
                    markContainerRemoved(config, c.id);
                    process.stdout.write(chalk.green('✓') + '\n');
                    removed++;
                } catch {
                    process.stdout.write(chalk.red('✗') + '\n');
                }
            }

            // Clear selected container
            config.settings.currentContainerId = null;

            saveConfig(config, String(g.configDir));
            logger.success(`Removed ${removed}/${toRemove.length} containers`);
            console.log('  Run `claude-code-sandbox history` to view removed containers.');
        });
}
