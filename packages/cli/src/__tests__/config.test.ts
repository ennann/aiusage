import { describe, expect, it } from 'vitest';
import { setConfigValue } from '../config.js';

describe('setConfigValue', () => {
  it('sets and clears additional OpenCode database paths', () => {
    const configured = setConfigValue({}, 'scanner.opencodeDbPaths', [
      '/data/opencode-next.db',
      '/data/opencode-stable.db',
      '/data/opencode-next.db',
    ]);
    expect(configured.scanner?.opencodeDbPaths).toEqual([
      '/data/opencode-next.db',
      '/data/opencode-stable.db',
    ]);

    const cleared = setConfigValue(configured, 'scanner.opencodeDbPaths', ['default']);
    expect(cleared.scanner?.opencodeDbPaths).toBeUndefined();
  });
});
