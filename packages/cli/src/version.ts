import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: string | undefined;

export function getVersion(): string {
  if (cached !== undefined) return cached;
  try {
    const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    cached = JSON.parse(readFileSync(pkg, 'utf-8')).version;
  } catch {
    cached = 'unknown';
  }
  return cached!;
}
