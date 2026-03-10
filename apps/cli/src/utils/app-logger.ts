import { createLogger, format } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { DEFAULT_CONFIG_DIR } from '../lib/constants.js';
import { getSession } from '../lib/session-store.js';

const { combine, timestamp, json } = format;

// Inject sessionId and mode from the session store into every log entry.
const sessionFormat = format((info) => {
    const session = getSession();
    if (session.sessionId) info['sessionId'] = session.sessionId;
    if (session.mode) info['mode'] = session.mode;
    return info;
});

function buildFileTransport(logDir: string): DailyRotateFile {
    mkdirSync(logDir, { recursive: true });
    return new DailyRotateFile({
        filename: join(logDir, 'cli-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxFiles: '10d',
        maxSize: '20m',
        zippedArchive: false,
        format: combine(sessionFormat(), timestamp(), json()),
    });
}

// Lazily initialised — first call to any log method triggers setup.
let _logger: ReturnType<typeof createLogger> | null = null;

function getLogger() {
    if (!_logger) {
        const session = getSession();
        const logDir = join(session.configDir ?? DEFAULT_CONFIG_DIR, 'logs');
        const transport = buildFileTransport(logDir);
        _logger = createLogger({
            level: 'debug',
            transports: [transport],
            // Never write to stdout/stderr — terminal output stays in logger.ts.
            silent: false,
        });
    }
    return _logger;
}

export const appLogger = {
    debug: (msg: string, meta?: Record<string, unknown>) => getLogger().debug(msg, meta ?? {}),
    info: (msg: string, meta?: Record<string, unknown>) => getLogger().info(msg, meta ?? {}),
    warn: (msg: string, meta?: Record<string, unknown>) => getLogger().warn(msg, meta ?? {}),
    error: (msg: string, meta?: Record<string, unknown>) => getLogger().error(msg, meta ?? {}),
};
