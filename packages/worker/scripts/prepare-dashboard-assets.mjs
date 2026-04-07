import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function ensureDirRemoved(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

async function copyDir(sourceDir, targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDir(sourcePath, targetPath);
      return;
    }
    await fs.copyFile(sourcePath, targetPath);
  }));
}

export async function copyDashboardAssets({ dashboardDistDir, workerPublicDir }) {
  await fs.access(path.join(dashboardDistDir, 'index.html'));
  await ensureDirRemoved(workerPublicDir);
  await copyDir(dashboardDistDir, workerPublicDir);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultDashboardDistDir = path.resolve(scriptDir, '../../dashboard/dist');
const defaultWorkerPublicDir = path.resolve(scriptDir, '../public');

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await copyDashboardAssets({
    dashboardDistDir: defaultDashboardDistDir,
    workerPublicDir: defaultWorkerPublicDir,
  });
}
