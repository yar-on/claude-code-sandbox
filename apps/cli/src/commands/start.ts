import { Command } from 'commander';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { logger, spinner } from '../utils/logger.js';
import { validateWorkspace, validateImageName, validateTag } from '../utils/validation.js';
import { loadConfig, saveConfig, type ContainerRecord } from '../lib/config-store.js';
import { getAllContainers, addContainer, findContainersByWorkspace, syncContainerStatuses, updateContainer } from '../lib/container-store.js';
import { resolveWorkspace } from '../lib/workspace.js';
import {
    isDockerRunning,
    getContainerStates,
    imageExistsLocally,
    pullImage,
    createAndStartContainer,
    startExistingContainer,
    containerNameFromId,
    shortId,
} from '../lib/docker.js';
import { ENV_VARS, DEFAULT_IMAGE, DEFAULT_IMAGE_TAG } from '../lib/constants.js';
import { getStoredAuth } from './auth.js';

export function makeStartCommand(): Command {
    return new Command('start')
        .description('Start a container for the workspace (creates one if none exists)')
        .option('--pull', 'Force pull image before starting')
        .option('--image <image>', 'Docker image name')
        .option('--tag <tag>', 'Docker image tag')
        .action(async function (this: Command) {
            const g = this.optsWithGlobals();

            const configDir = String(g.configDir);
            const workspace = resolveWorkspace(g.workspace as string | undefined);
            const image = (g.image as string | undefined) ?? process.env[ENV_VARS.IMAGE] ?? DEFAULT_IMAGE;
            const tag = (g.tag as string | undefined) ?? process.env[ENV_VARS.TAG] ?? DEFAULT_IMAGE_TAG;

            // Validate inputs
            const wsErr = validateWorkspace(workspace);
            if (wsErr) {
                logger.error(wsErr);
                process.exit(1);
            }
            const imgErr = validateImageName(image);
            if (imgErr) {
                logger.error(imgErr);
                process.exit(1);
            }
            const tagErr = validateTag(tag);
            if (tagErr) {
                logger.error(tagErr);
                process.exit(1);
            }

            // Check Docker
            if (!(await isDockerRunning())) {
                logger.error('Docker is not running or not accessible.');
                console.log('  On Linux:   sudo systemctl start docker');
                console.log('  On macOS:   open Docker Desktop');
                console.log('  On Windows: Start Docker Desktop from the Start menu');
                process.exit(1);
            }

            // Load config + sync
            const config = loadConfig(configDir);
            const allNames = getAllContainers(config).map((c) => c.name);
            syncContainerStatuses(config, await getContainerStates(allNames));

            // Resolve auth
            const configEnvPath = join(configDir, '.env');
            const auth = getStoredAuth(configEnvPath);
            if (!auth) {
                logger.error('No authentication credentials found.');
                console.log('\n  Set one of:');
                console.log('    ANTHROPIC_API_KEY=sk-ant-api03-...');
                console.log('    CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...');
                console.log('\n  Or run: claude-code-sandbox auth setup');
                process.exit(1);
            }

            // Check if --id points to a specific container
            let target: ContainerRecord | undefined;
            if (g.id) {
                const { findContainerById } = await import('../lib/container-store.js');
                const found = findContainerById(config, String(g.id));
                if (found && found.removedAt === null) target = found;
            }

            // Fall back to workspace match if no --id
            if (!target) {
                const matches = findContainersByWorkspace(config, workspace);
                if (matches.length === 1) target = matches[0];
                else if (matches.length > 1) {
                    const { pickInteractively } = await import('../lib/selection.js');
                    target = (await pickInteractively(matches)) ?? undefined;
                    if (!target) {
                        logger.error('No container selected.');
                        process.exit(1);
                    }
                }
            }

            if (target) {
                if (target.lastStatus === 'running') {
                    logger.info(`Container ${shortId(target.id)} is already running`);
                    console.log(`  Workspace: ${target.workspace}`);
                    return;
                }
                // Resume stopped container
                const spin = spinner(`Resuming container ${shortId(target.id)}...`).start();
                try {
                    await startExistingContainer(target.name);
                    updateContainer(config, target.id, { lastStatus: 'running' });
                    saveConfig(config, configDir);
                    spin.succeed(`Container ${shortId(target.id)} resumed`);
                    console.log(`  Workspace: ${target.workspace}`);
                } catch (err) {
                    spin.fail('Failed to start container');
                    logger.error((err as Error).message);
                    process.exit(1);
                }
                return;
            }

            // Create new container
            const imageRef = `${image}:${tag}`;
            const exists = await imageExistsLocally(image, tag);
            if (!exists || g.pull) {
                const spin = spinner(`Pulling ${imageRef}...`).start();
                try {
                    await pullImage(image, tag, (msg) => {
                        spin.text = msg;
                    });
                    spin.succeed(`Pulled ${imageRef}`);
                } catch (err) {
                    spin.fail(`Failed to pull ${imageRef}`);
                    logger.error((err as Error).message);
                    process.exit(1);
                }
            }

            const id = randomUUID();
            const name = containerNameFromId(id);
            const claudeDir = join(configDir, 'containers', shortId(id), '.claude');

            const spin = spinner('Creating container...').start();
            try {
                await createAndStartContainer({
                    name,
                    image,
                    tag,
                    workspace,
                    claudeDir,
                    authEnv: auth,
                    gitUserName: config.settings.gitUserName,
                    gitUserEmail: config.settings.gitUserEmail,
                });

                const now = new Date().toISOString();
                const record: ContainerRecord = {
                    id,
                    name,
                    workspace,
                    image,
                    tag,
                    createdAt: now,
                    updatedAt: now,
                    lastStatus: 'running',
                    removedAt: null,
                };
                addContainer(config, record);
                saveConfig(config, configDir);

                spin.succeed(`Container ${shortId(id)} started`);
                console.log(`  Workspace: ${workspace}`);
                console.log(`  Image:     ${imageRef}`);
                console.log(`  ID:        ${shortId(id)}`);
            } catch (err) {
                spin.fail('Failed to create container');
                logger.error((err as Error).message);
                process.exit(1);
            }
        });
}
