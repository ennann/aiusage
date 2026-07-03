import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertJoeDeployGuard } from './guard-joe-deploy.mjs';

async function writeFixture(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

async function createGuardFixture({
  siteConfig = 'export const SITE_TITLE = "Joe\'s AI Usage";\nexport const SITE_URL = "https://hubeiqiao.com";\n',
  dashboardIndex = '<title>Joe\'s AI Usage</title>',
  distIndex = '<title>Joe\'s AI Usage</title>',
  publicIndex = '<title>Joe\'s AI Usage</title>',
  sharedTypes = "export type Product = 'kiro' | (string & {});\n",
  kiroScanner = 'export async function scanKiroDates() {}\n',
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aiusage-joe-guard-'));

  await writeFixture(root, 'packages/dashboard/src/site-config.ts', siteConfig);
  await writeFixture(root, 'packages/dashboard/index.html', dashboardIndex);
  await writeFixture(root, 'packages/dashboard/dist/index.html', distIndex);
  await writeFixture(root, 'packages/worker/public/index.html', publicIndex);
  await writeFixture(root, 'packages/shared/src/types.ts', sharedTypes);
  await writeFixture(root, 'packages/cli/src/scanners/kiro.ts', kiroScanner);

  return root;
}

test('assertJoeDeployGuard accepts Joe branded dashboard with Kiro support markers', async () => {
  const repoRoot = await createGuardFixture();

  await assert.doesNotReject(assertJoeDeployGuard({
    repoRoot,
    dashboardDistDir: path.join(repoRoot, 'packages/dashboard/dist'),
    workerPublicDir: path.join(repoRoot, 'packages/worker/public'),
  }));
});

test('assertJoeDeployGuard rejects upstream Token Usage dashboard assets', async () => {
  const repoRoot = await createGuardFixture({
    siteConfig: 'export const SITE_TITLE = "Token Usage";\nexport const SITE_URL = "https://example.com";\n',
    dashboardIndex: '<title>Token Usage</title>',
    distIndex: '<title>Token Usage</title>',
    publicIndex: '<title>Token Usage</title>',
  });

  await assert.rejects(
    assertJoeDeployGuard({
      repoRoot,
      dashboardDistDir: path.join(repoRoot, 'packages/dashboard/dist'),
      workerPublicDir: path.join(repoRoot, 'packages/worker/public'),
    }),
    /Joe's AI Usage/,
  );
});

test('assertJoeDeployGuard rejects builds missing Kiro source markers', async () => {
  const repoRoot = await createGuardFixture({
    sharedTypes: "export type Product = 'codex' | (string & {});\n",
    kiroScanner: 'export async function scanCodexDates() {}\n',
  });

  await assert.rejects(
    assertJoeDeployGuard({
      repoRoot,
      dashboardDistDir: path.join(repoRoot, 'packages/dashboard/dist'),
      workerPublicDir: path.join(repoRoot, 'packages/worker/public'),
    }),
    /Kiro/,
  );
});
