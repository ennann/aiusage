import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { copyDashboardAssets } from './prepare-dashboard-assets.mjs';

test('copyDashboardAssets copies dashboard dist into worker public and replaces stale files', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aiusage-worker-assets-'));
  const dashboardDistDir = path.join(tempRoot, 'dashboard-dist');
  const workerPublicDir = path.join(tempRoot, 'worker-public');

  await fs.mkdir(path.join(dashboardDistDir, 'assets'), { recursive: true });
  await fs.writeFile(path.join(dashboardDistDir, 'index.html'), '<html>ok</html>');
  await fs.writeFile(path.join(dashboardDistDir, 'assets', 'index.js'), 'console.log("ok")');

  await fs.mkdir(workerPublicDir, { recursive: true });
  await fs.writeFile(path.join(workerPublicDir, 'stale.txt'), 'stale');

  await copyDashboardAssets({ dashboardDistDir, workerPublicDir });

  await assert.doesNotReject(fs.access(path.join(workerPublicDir, 'index.html')));
  await assert.doesNotReject(fs.access(path.join(workerPublicDir, 'assets', 'index.js')));
  await assert.rejects(fs.access(path.join(workerPublicDir, 'stale.txt')));
});
