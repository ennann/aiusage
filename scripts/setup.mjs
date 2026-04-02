#!/usr/bin/env node

/**
 * AIUsage One-Click Deployment
 *
 * Deploys the full stack to Cloudflare:
 * 1. Check prerequisites (Node, pnpm, wrangler)
 * 2. Verify Cloudflare login
 * 3. Collect configuration
 * 4. Generate cryptographic secrets
 * 5. Create D1 database
 * 6. Write wrangler.jsonc
 * 7. Set Worker secrets
 * 8. Run D1 migration
 * 9. Build all packages
 * 10. Deploy Worker + Dashboard
 */

import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const WORKER_DIR = resolve(ROOT, 'packages/worker');
const WRANGLER_JSONC = resolve(WORKER_DIR, 'wrangler.jsonc');
const CREDENTIALS_FILE = resolve(ROOT, '.credentials');

// ── Formatting ──

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;

function ok(msg) { console.log(`  ${green('✓')} ${msg}`); }
function fail(msg) { console.error(`  ${red('✗')} ${msg}`); }
function warn(msg) { console.log(`  ${yellow('!')} ${msg}`); }
function step(n, title) { console.log(`\n${bold(`[${n}/10]`)} ${title}`); }

// ── Utilities ──

function ask(question, defaultValue) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    const hint = defaultValue !== undefined ? dim(` [${defaultValue}]`) : '';
    rl.question(`  ${cyan('?')} ${question}${hint}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || (defaultValue ?? ''));
    });
  });
}

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', cwd: WORKER_DIR, ...opts }).trim();
}

function runVisible(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', cwd: WORKER_DIR, ...opts });
}

function runWithInput(cmd, input, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf-8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: WORKER_DIR,
    ...opts,
  }).trim();
}

function hex(bytes = 16) {
  return randomBytes(bytes).toString('hex');
}

function which(bin) {
  try {
    execSync(`which ${bin}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ── Main ──

async function main() {
  console.log('');
  console.log(bold('  AIUsage — One-Click Deployment'));
  console.log(dim('  Deploy your AI usage tracker to Cloudflare'));
  console.log('');

  // ── Step 1: Prerequisites ──
  step(1, 'Check prerequisites');

  const nodeMajor = parseInt(process.version.slice(1));
  if (nodeMajor < 18) {
    fail(`Node.js >= 18 required, got ${process.version}`);
    process.exit(1);
  }
  ok(`Node.js ${process.version}`);

  try {
    ok(`pnpm ${run('pnpm --version', { cwd: ROOT })}`);
  } catch {
    fail('pnpm not found — https://pnpm.io/installation');
    process.exit(1);
  }

  try {
    const ver = run('npx wrangler --version').replace(/.*?(\d[\d.]+).*/, '$1');
    ok(`wrangler ${ver}`);
  } catch {
    fail('wrangler not available. Run: pnpm install');
    process.exit(1);
  }

  // ── Step 2: Cloudflare auth ──
  step(2, 'Cloudflare authentication');
  try {
    const whoami = run('npx wrangler whoami 2>&1');
    // Extract account name between ── markers
    const m = whoami.match(/──\s+(.+?)\s+──/);
    ok(m ? `Account: ${m[1]}` : 'Logged in');
  } catch {
    fail('Not logged in to Cloudflare');
    console.log(`\n  Run ${cyan('npx wrangler login')} first, then re-run this script.\n`);
    process.exit(1);
  }

  // ── Step 3: Configuration ──
  step(3, 'Configuration');
  const workerName = await ask('Worker name', 'aiusage');
  const dbName = await ask('D1 database name', 'aiusage-db');
  const maxDevices = await ask('Max devices', '10');
  const visibility = await ask('Project visibility (masked / hidden / plain)', 'masked');
  const timezone = await ask('Default timezone', 'Asia/Shanghai');

  // ── Step 4: Generate secrets ──
  step(4, 'Generate secrets');
  const siteId = `site_${hex(8)}`;
  const enrollToken = hex(16);
  const deviceTokenSecret = hex(32);
  const projectNameSalt = hex(16);

  ok(`SITE_ID:              ${siteId}`);
  ok(`ENROLL_TOKEN:         ${enrollToken.slice(0, 8)}${'*'.repeat(8)}`);
  ok(`DEVICE_TOKEN_SECRET:  ${dim('[generated, 64 chars]')}`);
  ok(`PROJECT_NAME_SALT:    ${dim('[generated, 32 chars]')}`);

  // ── Step 5: Create D1 database ──
  step(5, 'Create D1 database');
  let databaseId;

  try {
    const output = run(`npx wrangler d1 create ${dbName} 2>&1`);
    // Try several patterns to extract the database ID
    const patterns = [
      /"uuid"\s*:\s*"([a-f0-9-]{36})"/i,
      /database_id\s*=\s*"([a-f0-9-]{36})"/i,
      /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i,
    ];
    for (const pat of patterns) {
      const m = output.match(pat);
      if (m) { databaseId = m[1]; break; }
    }
    if (!databaseId) {
      fail('Could not parse database_id from wrangler output:');
      console.log(output);
      process.exit(1);
    }
    ok(`Created: ${dbName} (${databaseId})`);
  } catch (e) {
    const msg = (e.stderr || e.stdout || e.message || '').toString();
    if (msg.includes('already exists')) {
      warn(`Database "${dbName}" already exists, looking up ID...`);
      try {
        const list = run('npx wrangler d1 list --json 2>&1');
        const dbs = JSON.parse(list);
        const found = dbs.find((d) => d.name === dbName);
        if (found) {
          databaseId = found.uuid || found.id;
          ok(`Reusing: ${dbName} (${databaseId})`);
        }
      } catch { /* fall through */ }
    }
    if (!databaseId) {
      fail(`Failed to create D1 database`);
      console.error(msg);
      process.exit(1);
    }
  }

  // ── Step 6: Write wrangler.jsonc ──
  step(6, 'Generate wrangler.jsonc');

  const config = `{
    "$schema": "../../node_modules/wrangler/config-schema.json",
    "name": "${workerName}",
    "main": "src/index.ts",
    "compatibility_date": "2026-04-01",
    "compatibility_flags": ["nodejs_compat"],
    "assets": {
        "directory": "../dashboard/dist",
        "html_handling": "auto-trailing-slash",
        "not_found_handling": "single-page-application",
        "run_worker_first": ["/api/*", "/pricing", "/favicon.ico"]
    },
    "d1_databases": [
        {
            "binding": "DB",
            "database_name": "${dbName}",
            "database_id": "${databaseId}"
        }
    ],
    // Secrets (set via wrangler secret put):
    // - SITE_ID
    // - ENROLL_TOKEN
    // - DEVICE_TOKEN_SECRET
    // - PROJECT_NAME_SALT
    "vars": {
        "MAX_DEVICES": "${maxDevices}",
        "PUBLIC_PROJECT_VISIBILITY": "${visibility}",
        "DEFAULT_TIMEZONE": "${timezone}"
    }
}
`;
  writeFileSync(WRANGLER_JSONC, config);
  ok(`Written: packages/worker/wrangler.jsonc`);

  // ── Step 7: Set Worker secrets ──
  step(7, 'Set Worker secrets');
  const secrets = [
    ['SITE_ID', siteId],
    ['ENROLL_TOKEN', enrollToken],
    ['DEVICE_TOKEN_SECRET', deviceTokenSecret],
    ['PROJECT_NAME_SALT', projectNameSalt],
  ];
  for (const [key, value] of secrets) {
    try {
      runWithInput(`npx wrangler secret put ${key}`, value);
      ok(key);
    } catch (e) {
      fail(`${key}: ${(e.stderr || e.message || '').toString().split('\n')[0]}`);
      process.exit(1);
    }
  }

  // ── Step 8: D1 migration ──
  step(8, 'Run D1 migration');
  try {
    const output = run(`npx wrangler d1 migrations apply ${dbName} --remote 2>&1`);
    if (output.includes('Nothing to migrate')) {
      ok('Already up to date');
    } else {
      ok('Migration applied');
    }
  } catch (e) {
    const msg = (e.stderr || e.stdout || '').toString();
    if (msg.includes('Nothing to migrate') || msg.includes('already been applied')) {
      ok('Already up to date');
    } else {
      fail('Migration failed');
      console.error(msg);
      process.exit(1);
    }
  }

  // ── Step 9: Build ──
  step(9, 'Build all packages');
  try {
    runVisible('pnpm build', { cwd: ROOT });
    ok('Build complete');
  } catch {
    fail('Build failed — check output above');
    process.exit(1);
  }

  // ── Step 10: Deploy ──
  step(10, 'Deploy Worker');
  let workerUrl = '';
  try {
    const output = run('npx wrangler deploy 2>&1');
    const urlMatch = output.match(/https:\/\/[^\s]+\.workers\.dev/);
    workerUrl = urlMatch ? urlMatch[0] : '';
    ok(workerUrl ? `Deployed: ${workerUrl}` : 'Deployed');
  } catch (e) {
    fail('Deploy failed');
    console.error((e.stderr || e.stdout || e.message || '').toString());
    process.exit(1);
  }

  // ── Save credentials ──
  const url = workerUrl || `https://${workerName}.<subdomain>.workers.dev`;
  writeFileSync(
    CREDENTIALS_FILE,
    [
      '# AIUsage Deployment Credentials',
      `# Generated: ${new Date().toISOString()}`,
      '# Keep this file safe. Do NOT commit to git.',
      '',
      `WORKER_URL=${url}`,
      `SITE_ID=${siteId}`,
      `ENROLL_TOKEN=${enrollToken}`,
      `DEVICE_TOKEN_SECRET=${deviceTokenSecret}`,
      `PROJECT_NAME_SALT=${projectNameSalt}`,
      '',
    ].join('\n'),
  );

  // ── Summary ──
  console.log('');
  console.log(green('━'.repeat(56)));
  console.log(green(bold('  Setup complete!')));
  console.log(green('━'.repeat(56)));
  console.log('');
  console.log(`  Dashboard:      ${cyan(url)}`);
  console.log(`  SITE_ID:        ${siteId}`);
  console.log(`  ENROLL_TOKEN:   ${enrollToken}`);
  console.log(`  Credentials:    ${dim('.credentials')}`);
  console.log('');
  console.log(bold('  Connect your device:'));
  console.log('');
  console.log(cyan(`  npm i -g @aiusage/cli`));
  console.log(cyan(`  aiusage enroll \\`));
  console.log(cyan(`    --server ${url} \\`));
  console.log(cyan(`    --site-id ${siteId} \\`));
  console.log(cyan(`    --enroll-token ${enrollToken} \\`));
  console.log(cyan(`    --device-name "My MacBook"`));
  console.log(cyan(`  aiusage sync`));
  console.log(cyan(`  aiusage schedule on --every 1h`));
  console.log('');
}

main().catch((err) => {
  console.error(`\n${red('Setup failed:')} ${err.message}\n`);
  process.exit(1);
});
