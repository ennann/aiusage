import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_SITE_TITLE = "Joe's AI Usage";
const EXPECTED_SITE_URL = 'https://hubeiqiao.com';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultWorkerDir = path.resolve(scriptDir, '..');
const defaultRepoRoot = path.resolve(defaultWorkerDir, '..', '..');
const defaultDashboardDistDir = path.resolve(defaultWorkerDir, '../dashboard/dist');
const defaultWorkerPublicDir = path.resolve(defaultWorkerDir, 'public');

async function readRequiredFile(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Joe deploy guard failed: cannot read ${filePath}: ${error.message}`);
  }
}

function relativeName(repoRoot, filePath) {
  const relative = path.relative(repoRoot, filePath);
  return relative.startsWith('..') ? filePath : relative;
}

async function assertFileIncludes({ repoRoot, filePath, marker, label }) {
  const content = await readRequiredFile(filePath);
  if (!content.includes(marker)) {
    throw new Error(
      `Joe deploy guard failed: ${relativeName(repoRoot, filePath)} is missing ${label}: ${marker}`,
    );
  }
  return content;
}

export async function assertJoeDeployGuard({
  repoRoot = defaultRepoRoot,
  dashboardDistDir = defaultDashboardDistDir,
  workerPublicDir = defaultWorkerPublicDir,
} = {}) {
  const checks = [
    {
      filePath: path.join(repoRoot, 'packages/dashboard/src/site-config.ts'),
      marker: `SITE_TITLE = "${EXPECTED_SITE_TITLE}"`,
      label: `Joe dashboard title (${EXPECTED_SITE_TITLE})`,
    },
    {
      filePath: path.join(repoRoot, 'packages/dashboard/src/site-config.ts'),
      marker: `SITE_URL = "${EXPECTED_SITE_URL}"`,
      label: `Joe site URL (${EXPECTED_SITE_URL})`,
    },
    {
      filePath: path.join(repoRoot, 'packages/dashboard/index.html'),
      marker: `<title>${EXPECTED_SITE_TITLE}</title>`,
      label: `Joe dashboard HTML title (${EXPECTED_SITE_TITLE})`,
    },
    {
      filePath: path.join(dashboardDistDir, 'index.html'),
      marker: `<title>${EXPECTED_SITE_TITLE}</title>`,
      label: `built Joe dashboard title (${EXPECTED_SITE_TITLE})`,
    },
    {
      filePath: path.join(workerPublicDir, 'index.html'),
      marker: `<title>${EXPECTED_SITE_TITLE}</title>`,
      label: `deployable Joe dashboard title (${EXPECTED_SITE_TITLE})`,
    },
    {
      filePath: path.join(repoRoot, 'packages/shared/src/types.ts'),
      marker: "'kiro'",
      label: 'Kiro product type marker',
    },
    {
      filePath: path.join(repoRoot, 'packages/cli/src/scanners/kiro.ts'),
      marker: 'export async function scanKiroDates',
      label: 'Kiro scanner export',
    },
  ];

  const checkedContents = await Promise.all(
    checks.map((check) => assertFileIncludes({ repoRoot, ...check })),
  );

  for (const content of checkedContents) {
    if (content.includes('<title>Token Usage</title>')) {
      throw new Error('Joe deploy guard failed: upstream Token Usage dashboard assets are present.');
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    await assertJoeDeployGuard();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
