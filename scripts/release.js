#!/usr/bin/env node
// Interactive release script for claude-code-sandbox monorepo.
// Usage: node scripts/release.js [--dry-run]
//
// Prompts for target:
//   1. Docker only          — bump docker version, push docker-v<version> tag
//   2. CLI only             — bump cli version, push cli-v<version> tag
//   3. Both                 — bump both, push both tags (Docker first)
//   4. Update versions      — versions.json was updated; rebuild Docker images
//                             under the current version + auto-patch CLI
//
// Tag format:
//   docker-v<version>                → triggers docker-publish.yml (version release)
//   docker-v<version>-rebuild<ts>    → triggers docker-publish.yml (versions.json rebuild)
//   cli-v<version>                   → triggers cli-publish.yml

'use strict';

const readline = require('readline');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_CHECKS = process.argv.includes('--skip-checks');
const GENERATE_README = path.join(ROOT, 'apps', 'docker', 'scripts', 'generate-readme.js');
const DOCKER_CHANGELOG = path.join(ROOT, 'apps', 'docker', 'CHANGELOG.md');
const CLI_CHANGELOG = path.join(ROOT, 'apps', 'cli', 'CHANGELOG.md');
const GITHUB_REPO = 'https://github.com/spiriyu/claude-code-sandbox';

// ── helpers ──────────────────────────────────────────────────────────────────

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4) + '\n', 'utf8');
}

function bumpVersion(version, type) {
    const parts = version.split('.').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) {
        throw new Error(`Invalid semver: ${version}`);
    }
    const [major, minor, patch] = parts;
    switch (type) {
        case 'major':
            return `${major + 1}.0.0`;
        case 'minor':
            return `${major}.${minor + 1}.0`;
        case 'patch':
            return `${major}.${minor}.${patch + 1}`;
        default:
            throw new Error(`Unknown bump type: ${type}`);
    }
}

function validateSemver(v) {
    return /^\d+\.\d+\.\d+$/.test(v);
}

// YYYYMMDDHHmm — precise enough to avoid collisions, short enough to read
function buildTimestamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}` + `${pad(now.getMonth() + 1)}` + `${pad(now.getDate())}` + `${pad(now.getHours())}` + `${pad(now.getMinutes())}`;
}

function run(cmd, opts = {}) {
    console.log(`  $ ${cmd}`);
    if (!DRY_RUN) {
        execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts });
    }
}

// ── changelog helpers ─────────────────────────────────────────────────────────

function todayISO() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Promotes [Unreleased] to [newVersion] in a Keep-a-Changelog file:
 *   - Moves [Unreleased] content into a dated version section
 *   - Resets [Unreleased] to empty
 *   - Updates/inserts the comparison links at the bottom
 *
 * @param {string} changelogPath  Absolute path to CHANGELOG.md
 * @param {string} newVersion     The version being released (e.g. "0.6.0")
 * @param {string} prevVersion    The previous version (for comparison links)
 * @param {string} [defaultBody]  Fallback body if [Unreleased] is empty
 */
function updateChangelog(changelogPath, newVersion, prevVersion, defaultBody) {
    if (!fs.existsSync(changelogPath)) return;

    let content = fs.readFileSync(changelogPath, 'utf8');
    const date = todayISO();
    const app = changelogPath.includes(`${path.sep}cli${path.sep}`) ? 'cli' : 'docker';
    const newTag = `${app}-v${newVersion}`;
    const prevTag = `${app}-v${prevVersion}`;

    // Extract body between ## [Unreleased] and the first following ---
    const unreleasedRe = /## \[Unreleased\]\n([\s\S]*?)\n---/;
    const match = content.match(unreleasedRe);
    if (match) {
        const body = match[1].trim() || defaultBody || 'No user-facing changes.';
        const versionSection = `## [${newVersion}] - ${date}\n\n${body}`;
        content = content.replace(unreleasedRe, `## [Unreleased]\n\n---\n\n${versionSection}\n\n---`);
    }

    // Update [unreleased] comparison link to point at new tag
    content = content.replace(/^\[unreleased\]:.*$/im, `[unreleased]: ${GITHUB_REPO}/compare/${newTag}...HEAD`);

    // Insert new version link directly after the [unreleased] line
    const newLink = `[${newVersion}]: ${GITHUB_REPO}/compare/${prevTag}...${newTag}`;
    content = content.replace(/^(\[unreleased\]:.*\n)/im, `$1${newLink}\n`);

    console.log(`  Updated ${path.relative(ROOT, changelogPath)} → [${newVersion}]`);
    if (!DRY_RUN) fs.writeFileSync(changelogPath, content, 'utf8');
}

// ── prompt helpers ────────────────────────────────────────────────────────────

function createRl() {
    return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl, question) {
    return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

async function pickOption(rl, question, options) {
    const labels = options.map((o, i) => `  ${i + 1}) ${o}`).join('\n');
    while (true) {
        const answer = await ask(rl, `${question}\n${labels}\n> `);
        const idx = parseInt(answer, 10) - 1;
        if (idx >= 0 && idx < options.length) return options[idx];
        console.log(`  Please enter a number between 1 and ${options.length}.`);
    }
}

// ── flows ─────────────────────────────────────────────────────────────────────

async function flowVersionsUpdate(rl) {
    const dockerPkgPath = path.join(ROOT, 'apps', 'docker', 'package.json');
    const cliPkgPath = path.join(ROOT, 'apps', 'cli', 'package.json');

    const currentDockerVersion = readJson(dockerPkgPath).version;
    const currentCliVersion = readJson(cliPkgPath).version;
    const newCliVersion = bumpVersion(currentCliVersion, 'patch');
    const timestamp = buildTimestamp();
    const rebuildTag = `docker-v${currentDockerVersion}-rebuild${timestamp}`;

    console.log(`\n  versions.json rebuild flow:`);
    console.log(`  Docker: keep v${currentDockerVersion}  (tag: ${rebuildTag})`);
    console.log(`  CLI:    ${currentCliVersion} → ${newCliVersion}  (tag: cli-v${newCliVersion})`);
    console.log(`\n  All Docker image aliases (latest, node22, etc.) will be overwritten`);
    console.log(`  to point to the new versions defined in libs/shared/src/versions.json.`);
    if (DRY_RUN) console.log('\n  (dry run — nothing will actually happen)');

    const confirm = await ask(rl, '\n  Proceed? [Y/n] ');
    if (confirm.toLowerCase() === 'n') {
        console.log('\n  Aborted.\n');
        process.exit(0);
    }

    // Bump CLI version
    const cliPkg = readJson(cliPkgPath);
    cliPkg.version = newCliVersion;
    if (!DRY_RUN) writeJson(cliPkgPath, cliPkg);
    console.log(`\n  Updated apps/cli/package.json → ${newCliVersion}`);

    // Update CLI changelog (versions rebuild — use default note if [Unreleased] is empty)
    updateChangelog(CLI_CHANGELOG, newCliVersion, currentCliVersion, 'Updated Node.js and Python runtime versions.');

    // Regenerate Docker README with current version and updated versions.json
    run(`node ${GENERATE_README}`, { env: { ...process.env, RELEASE_VERSION: currentDockerVersion } });

    // Commit (CLI package.json + changelog + regenerated README)
    run('git add apps/cli/package.json apps/cli/CHANGELOG.md apps/docker/README.md');
    run(`git commit -m "release: versions update — rebuild docker v${currentDockerVersion}, cli v${newCliVersion}"`);

    // Push commit, then tags (Docker rebuild tag first)
    run('git push');
    run(`git tag -a ${rebuildTag} -m "Docker rebuild v${currentDockerVersion} (versions.json update)"`);
    run(`git tag -a cli-v${newCliVersion} -m "CLI release v${newCliVersion}"`);
    run(`git push origin ${rebuildTag}`);
    run(`git push origin cli-v${newCliVersion}`);

    console.log('\n  ✔ Done!\n');
    console.log(`  Docker rebuild: https://github.com/spiriyu/claude-code-sandbox/actions`);
    console.log(`  CLI publish:    https://github.com/spiriyu/claude-code-sandbox/actions`);
    console.log('');
}

async function flowVersionBump(rl, target) {
    const releaseDocker = target !== 'CLI only';
    const releaseCli = target !== 'Docker only';

    const dockerPkgPath = path.join(ROOT, 'apps', 'docker', 'package.json');
    const cliPkgPath = path.join(ROOT, 'apps', 'cli', 'package.json');

    // Read current versions before bumping (needed for changelog comparison links)
    const prevDockerVersion = readJson(dockerPkgPath).version;
    const prevCliVersion = readJson(cliPkgPath).version;

    let dockerVersion, cliVersion;

    if (releaseDocker) {
        const currentDockerVersion = readJson(dockerPkgPath).version;
        console.log(`\n  Current Docker version: ${currentDockerVersion}`);
        const bumpType = await pickOption(rl, 'Version bump for Docker?', ['patch', 'minor', 'major', 'custom']);
        if (bumpType === 'custom') {
            while (true) {
                dockerVersion = await ask(rl, '  Enter Docker version (e.g. 1.2.3): ');
                if (validateSemver(dockerVersion)) break;
                console.log('  Invalid version. Use format X.Y.Z');
            }
        } else {
            dockerVersion = bumpVersion(currentDockerVersion, bumpType);
        }
        console.log(`  Docker → ${dockerVersion}`);
    }

    if (releaseCli) {
        // If "both", offer to reuse the Docker version
        if (releaseDocker) {
            const sameVersion = await pickOption(rl, `\nUse same version (${dockerVersion}) for CLI?`, ['Yes', 'No (pick separately)']);
            if (sameVersion === 'Yes') {
                cliVersion = dockerVersion;
                console.log(`  CLI → ${cliVersion}`);
            }
        }

        if (!cliVersion) {
            const currentCliVersion = readJson(cliPkgPath).version;
            console.log(`\n  Current CLI version: ${currentCliVersion}`);
            const bumpType = await pickOption(rl, 'Version bump for CLI?', ['patch', 'minor', 'major', 'custom']);
            if (bumpType === 'custom') {
                while (true) {
                    cliVersion = await ask(rl, '  Enter CLI version (e.g. 1.2.3): ');
                    if (validateSemver(cliVersion)) break;
                    console.log('  Invalid version. Use format X.Y.Z');
                }
            } else {
                cliVersion = bumpVersion(currentCliVersion, bumpType);
            }
            console.log(`  CLI → ${cliVersion}`);
        }
    }

    // Confirm
    console.log('\n  ─────────────────────────────────');
    if (releaseDocker) console.log(`  Docker: apps/docker/package.json → ${dockerVersion}  (tag: docker-v${dockerVersion})`);
    if (releaseCli) console.log(`  CLI:    apps/cli/package.json    → ${cliVersion}  (tag: cli-v${cliVersion})`);
    console.log('  ─────────────────────────────────');
    if (DRY_RUN) console.log('  (dry run — nothing will actually happen)');

    const confirm = await ask(rl, '\n  Proceed? [Y/n] ');
    if (confirm.toLowerCase() === 'n') {
        console.log('\n  Aborted.\n');
        process.exit(0);
    }

    // Apply version bumps
    if (releaseDocker) {
        const pkg = readJson(dockerPkgPath);
        pkg.version = dockerVersion;
        if (!DRY_RUN) writeJson(dockerPkgPath, pkg);
        console.log(`\n  Updated apps/docker/package.json → ${dockerVersion}`);
    }
    if (releaseCli) {
        const pkg = readJson(cliPkgPath);
        pkg.version = cliVersion;
        if (!DRY_RUN) writeJson(cliPkgPath, pkg);
        console.log(`  Updated apps/cli/package.json    → ${cliVersion}`);
    }

    // Update changelogs
    if (releaseDocker) updateChangelog(DOCKER_CHANGELOG, dockerVersion, prevDockerVersion);
    if (releaseCli) updateChangelog(CLI_CHANGELOG, cliVersion, prevCliVersion);

    // Regenerate Docker README if Docker is being released
    if (releaseDocker) {
        run(`node ${GENERATE_README}`, { env: { ...process.env, RELEASE_VERSION: dockerVersion } });
    }

    // Git commit
    const changedFiles = [];
    if (releaseDocker) changedFiles.push('apps/docker/package.json', 'apps/docker/README.md', 'apps/docker/CHANGELOG.md');
    if (releaseCli) changedFiles.push('apps/cli/package.json', 'apps/cli/CHANGELOG.md');

    let commitMsg;
    if (releaseDocker && releaseCli) {
        commitMsg = `release: docker v${dockerVersion} + cli v${cliVersion}`;
    } else if (releaseDocker) {
        commitMsg = `release: docker v${dockerVersion}`;
    } else {
        commitMsg = `release: cli v${cliVersion}`;
    }

    run(`git add ${changedFiles.join(' ')}`);
    run(`git commit -m "${commitMsg}"`);

    // Push commit, then tags (Docker first for "both")
    run('git push');
    if (releaseDocker) run(`git tag -a docker-v${dockerVersion} -m "Docker release v${dockerVersion}"`);
    if (releaseCli) run(`git tag -a cli-v${cliVersion} -m "CLI release v${cliVersion}"`);
    if (releaseDocker) run(`git push origin docker-v${dockerVersion}`);
    if (releaseCli) run(`git push origin cli-v${cliVersion}`);

    console.log('\n  ✔ Done!\n');
    if (releaseDocker) console.log(`  Docker build:  https://github.com/spiriyu/claude-code-sandbox/actions`);
    if (releaseCli) console.log(`  CLI publish:   https://github.com/spiriyu/claude-code-sandbox/actions`);
    console.log('');
}

// ── main ──────────────────────────────────────────────────────────────────────

function runChecks() {
    const checks = [
        { label: 'lint', cmd: 'npm run lint' },
        { label: 'format', cmd: 'npm run format:check' },
        { label: 'test', cmd: 'npm run test' },
    ];
    console.log('\n  Running pre-release checks…\n');
    for (const { label, cmd } of checks) {
        process.stdout.write(`  ▸ ${label}… `);
        try {
            execSync(cmd, { cwd: ROOT, stdio: 'pipe' });
            console.log('✔');
        } catch (err) {
            console.log('✖');
            console.error(`\n  ✖ ${label} failed. Fix the errors above before releasing.\n`);
            if (err.stdout) process.stderr.write(err.stdout);
            if (err.stderr) process.stderr.write(err.stderr);
            process.exit(1);
        }
    }
    console.log('\n  All checks passed.\n');
}

async function main() {
    if (DRY_RUN) console.log('\n  ⚠  DRY RUN — no files will be changed, no git commands run\n');
    if (SKIP_CHECKS) console.log('\n  ⚠  Skipping pre-release checks (--skip-checks)\n');

    if (!SKIP_CHECKS && !DRY_RUN) runChecks();

    // Check working tree is clean
    try {
        const status = execSync('git status --porcelain', { cwd: ROOT }).toString().trim();
        if (status) {
            console.error('\n  ✖ Working tree is not clean. Commit or stash your changes first.\n');
            console.error(status);
            process.exit(1);
        }
    } catch {
        console.error('\n  ✖ Failed to check git status. Are you in a git repo?\n');
        process.exit(1);
    }

    const rl = createRl();
    try {
        const target = await pickOption(rl, '\nWhat do you want to release?', [
            'Docker only',
            'CLI only',
            'Both (Docker first, then CLI)',
            'Update versions (rebuild Docker + patch CLI)',
        ]);

        if (target === 'Update versions (rebuild Docker + patch CLI)') {
            await flowVersionsUpdate(rl);
        } else {
            await flowVersionBump(rl, target);
        }
    } finally {
        rl.close();
    }
}

main().catch((err) => {
    console.error('\n  ✖', err.message);
    process.exit(1);
});
