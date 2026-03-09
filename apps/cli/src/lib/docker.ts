import Docker from 'dockerode';
import { mkdirSync } from 'fs';
import { type ContainerStatus } from './config-store.js';
import { CONTAINER_NAME_PREFIX, WORKSPACE_MOUNT_PATH, CLAUDE_DIR_CONTAINER_PATH, GIT_ENV_VARS } from './constants.js';

/**
 * Convert a host path to a Docker-compatible bind-mount path.
 * On Windows, backslashes must become forward slashes so the Docker API accepts them
 * (e.g. "C:\Users\foo" → "C:/Users/foo"). No-op on Linux/macOS.
 */
export function toDockerPath(p: string): string {
    return process.platform === 'win32' ? p.replace(/\\/g, '/') : p;
}

/** Returns true if the current stdin supports raw mode (not available on some Windows terminals). */
function hasRawMode(): boolean {
    return process.stdin.isTTY && typeof process.stdin.setRawMode === 'function';
}

let _client: Docker | null = null;

export function getDockerClient(): Docker {
    if (!_client) _client = new Docker();
    return _client;
}

export async function isDockerRunning(): Promise<boolean> {
    try {
        await getDockerClient().ping();
        return true;
    } catch {
        return false;
    }
}

/** Query Docker for the current state of a set of container names. */
export async function getContainerStates(names: string[]): Promise<Map<string, ContainerStatus>> {
    const result = new Map<string, ContainerStatus>();
    if (names.length === 0) return result;

    const list = await getDockerClient().listContainers({ all: true });
    for (const info of list) {
        for (const rawName of info.Names ?? []) {
            const name = rawName.replace(/^\//, '');
            if (names.includes(name)) {
                result.set(name, mapDockerState(info.State));
            }
        }
    }
    return result;
}

export function mapDockerState(state: string): ContainerStatus {
    switch (state) {
        case 'created':
            return 'created';
        case 'running':
            return 'running';
        case 'paused':
            return 'paused';
        case 'exited':
            return 'exited';
        case 'dead':
        case 'removing':
            return 'dead';
        default:
            return 'unknown';
    }
}

export async function imageExistsLocally(image: string, tag: string): Promise<boolean> {
    try {
        await getDockerClient().getImage(`${image}:${tag}`).inspect();
        return true;
    } catch {
        return false;
    }
}

export async function pullImage(image: string, tag: string, onStatus?: (msg: string) => void): Promise<void> {
    const docker = getDockerClient();
    await new Promise<void>((resolve, reject) => {
        void docker.pull(`${image}:${tag}`, (err: Error | null, stream: NodeJS.ReadableStream) => {
            if (err) return reject(err);
            docker.modem.followProgress(
                stream,
                (err: Error | null) => (err ? reject(err) : resolve()),
                (event: { status?: string }) => {
                    if (onStatus && event.status) onStatus(event.status);
                }
            );
        });
    });
}

export interface CreateContainerOptions {
    name: string;
    image: string;
    tag: string;
    workspace: string;
    claudeDir: string; // host path → mounted to /home/dev/.claude
    authEnv: Record<string, string>;
    gitUserName?: string | null;
    gitUserEmail?: string | null;
}

export async function createAndStartContainer(opts: CreateContainerOptions): Promise<void> {
    const docker = getDockerClient();

    // Ensure host .claude dir exists before mounting
    mkdirSync(opts.claudeDir, { recursive: true });

    const container = await docker.createContainer({
        name: opts.name,
        Image: `${opts.image}:${opts.tag}`,
        Tty: true,
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        OpenStdin: true,
        StdinOnce: false,
        Env: [
            ...Object.entries(opts.authEnv).map(([k, v]) => `${k}=${v}`),
            ...(opts.gitUserName ? [`${GIT_ENV_VARS.USER_NAME}=${opts.gitUserName}`] : []),
            ...(opts.gitUserEmail ? [`${GIT_ENV_VARS.USER_EMAIL}=${opts.gitUserEmail}`] : []),
        ],
        HostConfig: {
            Binds: [`${toDockerPath(opts.workspace)}:${WORKSPACE_MOUNT_PATH}`, `${toDockerPath(opts.claudeDir)}:${CLAUDE_DIR_CONTAINER_PATH}`],
            AutoRemove: false,
        },
    });

    await container.start();
}

export async function startExistingContainer(name: string): Promise<void> {
    await getDockerClient().getContainer(name).start();
}

export async function stopExistingContainer(name: string, timeoutSecs = 10): Promise<void> {
    await getDockerClient().getContainer(name).stop({ t: timeoutSecs });
}

export async function removeContainerFromDocker(name: string): Promise<void> {
    await getDockerClient().getContainer(name).remove({ force: true });
}

/** Attach terminal to container's main process (Tty=true raw stream). */
export async function attachToContainer(name: string): Promise<void> {
    const docker = getDockerClient();
    const container = docker.getContainer(name);

    const stream = await new Promise<NodeJS.ReadWriteStream>((resolve, reject) => {
        container.attach({ stream: true, stdin: true, stdout: true, stderr: true, hijack: true }, (err: Error | null, s?: NodeJS.ReadWriteStream) => {
            if (err) return reject(err);
            if (!s) return reject(new Error('attach returned no stream'));
            resolve(s);
        });
    });

    const rawMode = hasRawMode();
    if (rawMode) {
        process.stdin.setRawMode(true);
        // Forward terminal resize events
        const resizeHandler = () => {
            container.resize({ h: process.stdout.rows, w: process.stdout.columns }).catch(() => {});
        };
        process.stdout.on('resize', resizeHandler);
        stream.once('end', () => {
            process.stdout.off('resize', resizeHandler);
        });
        // Trigger immediate repaint by signalling current size
        container.resize({ h: process.stdout.rows, w: process.stdout.columns }).catch(() => {});
    }

    process.stdin.resume();
    process.stdin.pipe(stream);
    stream.pipe(process.stdout);

    await new Promise<void>((resolve) => stream.once('end', resolve));

    process.stdin.unpipe(stream);
    if (rawMode) process.stdin.setRawMode(false);
}

/** Open a new login bash session in a running container via exec. */
export async function execShellInContainer(name: string): Promise<void> {
    const docker = getDockerClient();
    const container = docker.getContainer(name);

    const exec = await container.exec({
        Cmd: ['bash', '-l'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
    });

    const stream = await exec.start({ hijack: true, stdin: true });

    const rawMode = hasRawMode();
    if (rawMode) {
        process.stdin.setRawMode(true);
        const resizeHandler = () => {
            exec.resize({ h: process.stdout.rows, w: process.stdout.columns }).catch(() => {});
        };
        process.stdout.on('resize', resizeHandler);
        stream.once('end', () => process.stdout.off('resize', resizeHandler));
    }

    process.stdin.resume();
    process.stdin.pipe(stream);
    stream.pipe(process.stdout);

    await new Promise<void>((resolve) => stream.once('end', resolve));

    process.stdin.unpipe(stream);
    if (rawMode) process.stdin.setRawMode(false);
}

/** Derive the short ID (first 8 hex chars) from a UUID. */
export function shortId(uuid: string): string {
    return uuid.replace(/-/g, '').slice(0, 8);
}

/** Generate the Docker container name for a given UUID. */
export function containerNameFromId(uuid: string): string {
    return CONTAINER_NAME_PREFIX + shortId(uuid);
}

export function formatRelativeTime(date: Date): string {
    const secs = Math.floor((Date.now() - date.getTime()) / 1000);
    if (secs < 60) return `${secs}s ago`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
    if (secs < 86400 * 30) return `${Math.floor(secs / 86400)}d ago`;
    return date.toLocaleDateString();
}
