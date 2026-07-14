import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { catalog } from '@aiusage/shared';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'catalog.json');

await writeFile(out, `${JSON.stringify(catalog, null, 2)}\n`, 'utf-8');
