import { Command } from 'commander';
import chalk from 'chalk';
import { logger } from '../utils/logger.js';
import { loadConfig, saveConfig } from '../lib/config-store.js';
import { getAllContainers, syncContainerStatuses } from '../lib/container-store.js';
import { resolveContainer } from '../lib/selection.js';
import { isDockerRunning, getContainerStates, attachToContainer, shortId } from '../lib/docker.js';

export function makeAttachCommand(): Command {
    return new Command('attach').description("Attach terminal to the container's main process (Claude Code)").action(async function (this: Command) {
        const g = this.optsWithGlobals();

        if (!(await isDockerRunning())) {
            logger.error('Docker is not running or not accessible.');
            process.exit(1);
        }

        const config = loadConfig(String(g.configDir));
        const allNames = getAllContainers(config).map((c) => c.name);
        syncContainerStatuses(config, await getContainerStates(allNames));
        saveConfig(config, String(g.configDir));

        const container = await resolveContainer(config, { id: g.id as string | undefined, workspace: g.workspace as string | undefined });
        if (!container) {
            logger.error('No container found. Run `claude-code-sandbox ls` to see available containers.');
            process.exit(1);
        }

        if (container.lastStatus !== 'running') {
            logger.error(`Container ${shortId(container.id)} is not running (status: ${container.lastStatus}).`);
            console.log('  Run `claude-code-sandbox start` to start it first.');
            process.exit(1);
        }

        // eslint-disable-next-line no-console
        console.clear();
        console.log(chalk.gray(`[Attached to ${container.name}]`));
        console.log(chalk.gray('[Ctrl+C to exit]'));

        try {
            await attachToContainer(container.name);
        } catch (err) {
            logger.error((err as Error).message);
            process.exit(1);
        }
    });
}
