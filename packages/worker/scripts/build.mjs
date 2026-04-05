import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyDashboardAssets } from './prepare-dashboard-assets.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workerDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(workerDir, '..', '..');
const dashboardDistDir = path.resolve(workerDir, '../dashboard/dist');
const workerPublicDir = path.resolve(workerDir, 'public');

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function ensureDashboardDist() {
  try {
    await fs.access(path.join(dashboardDistDir, 'index.html'));
  } catch {
    run('pnpm', ['--filter', '@aiusage/dashboard', 'build'], repoRoot);
  }
}

await ensureDashboardDist();
run('pnpm', ['exec', 'tsc', '--noEmit'], workerDir);
await copyDashboardAssets({ dashboardDistDir, workerPublicDir });
