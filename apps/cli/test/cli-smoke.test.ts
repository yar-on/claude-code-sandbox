import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { resolve } from 'path';

const CLI = resolve(import.meta.dirname, '..', 'dist', 'cli.js');

function run(args: string[], env?: Record<string, string>): { stdout: string; stderr: string; exitCode: number } {
    try {
        const stdout = execFileSync('node', [CLI, ...args], {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, ...env },
        });
        return { stdout, stderr: '', exitCode: 0 };
    } catch (e: any) {
        return {
            stdout: (e.stdout as string) ?? '',
            stderr: (e.stderr as string) ?? '',
            exitCode: (e.status as number) ?? 1,
        };
    }
}

describe('CLI binary smoke tests', () => {
    describe('--version', () => {
        it('prints semver version and exits 0', () => {
            const result = run(['--version']);
            expect(result.exitCode).toBe(0);
            expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
        });

        it('-v is an alias for --version', () => {
            const result = run(['-v']);
            expect(result.exitCode).toBe(0);
            expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
        });
    });

    describe('--help', () => {
        it('lists core commands', () => {
            const result = run(['--help']);
            expect(result.exitCode).toBe(0);
            const out = result.stdout;
            expect(out).toContain('start');
            expect(out).toContain('stop');
            expect(out).toContain('ls');
            expect(out).toContain('shell');
            expect(out).toContain('auth');
            expect(out).toContain('config');
        });

        it('does not list the removed "status" command', () => {
            const result = run(['--help']);
            // 'status' was removed; 'ls' replaced it
            // We check that 'status' is not a top-level command (it may appear in descriptions)
            const lines = result.stdout.split('\n').filter((l) => /^\s+(status)\s/.test(l));
            expect(lines).toHaveLength(0);
        });

        it('includes the description', () => {
            const result = run(['--help']);
            expect(result.stdout).toContain('Claude Code sandbox');
        });
    });

    describe('subcommand help', () => {
        const subcommands = ['start', 'stop', 'remove', 'attach', 'shell', 'ls', 'history', 'use', 'start-all', 'stop-all', 'auth', 'config'];

        for (const cmd of subcommands) {
            it(`${cmd} --help exits 0 and shows Usage:`, () => {
                const result = run([cmd, '--help']);
                expect(result.exitCode).toBe(0);
                expect(result.stdout).toMatch(/Usage:/i);
            });
        }

        it('auth setup --help exits 0', () => {
            const result = run(['auth', 'setup', '--help']);
            expect(result.exitCode).toBe(0);
        });

        it('auth status --help exits 0', () => {
            const result = run(['auth', 'status', '--help']);
            expect(result.exitCode).toBe(0);
        });

        it('config list --help exits 0', () => {
            const result = run(['config', 'list', '--help']);
            expect(result.exitCode).toBe(0);
        });

        it('config set --help exits 0', () => {
            const result = run(['config', 'set', '--help']);
            expect(result.exitCode).toBe(0);
        });

        it('config get --help exits 0', () => {
            const result = run(['config', 'get', '--help']);
            expect(result.exitCode).toBe(0);
        });

        it('config reset --help exits 0', () => {
            const result = run(['config', 'reset', '--help']);
            expect(result.exitCode).toBe(0);
        });
    });

    describe('unknown command', () => {
        it('prints error for unknown command', () => {
            const result = run(['nonexistent']);
            expect(result.exitCode).not.toBe(0);
        });
    });

    describe('config commands (non-Docker)', () => {
        it('config list --json returns valid JSON with current settings keys', () => {
            const result = run(['config', 'list', '--json']);
            expect(result.exitCode).toBe(0);
            const parsed = JSON.parse(result.stdout);
            expect(parsed).toHaveProperty('defaultImage');
            expect(parsed).toHaveProperty('defaultTag');
            expect(parsed).toHaveProperty('authMethod');
        });

        it('config get defaultImage returns a value', () => {
            const result = run(['config', 'get', 'defaultImage']);
            expect(result.exitCode).toBe(0);
            expect(result.stdout.trim()).toBeTruthy();
        });

        it('config get defaultTag returns a value', () => {
            const result = run(['config', 'get', 'defaultTag']);
            expect(result.exitCode).toBe(0);
            expect(result.stdout.trim()).toBeTruthy();
        });

        it('config get rejects unknown key', () => {
            const result = run(['config', 'get', 'fakeKey']);
            expect(result.exitCode).not.toBe(0);
        });

        it('config set rejects unknown key', () => {
            const result = run(['config', 'set', 'fakeKey', 'value']);
            expect(result.exitCode).not.toBe(0);
        });
    });

    describe('auth status (non-Docker)', () => {
        it('runs without crashing', () => {
            const result = run(['auth', 'status']);
            expect(result.exitCode).toBe(0);
        });

        it('detects ANTHROPIC_API_KEY from env', () => {
            const result = run(['auth', 'status'], {
                ANTHROPIC_API_KEY: 'sk-ant-api03-testkey1234',
            });
            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('ANTHROPIC_API_KEY');
        });
    });

    describe('start without Docker', () => {
        it('exits with error when Docker is not available', () => {
            const result = run(['start'], { PATH: '/usr/bin:/bin' });
            expect(result.exitCode).not.toBe(0);
        });
    });
});
