jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

const fs = require('fs');
const packageJson = require('../package.json');
const { checkBinaries } = require('./check-binaries');

describe('Radicle build inputs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('requires only the embedded addon for Radicle', () => {
    fs.existsSync.mockImplementation((target) => !target.endsWith('libradicle.node'));

    expect(checkBinaries([{ os: 'mac', arch: 'arm64' }])).toEqual([
      expect.stringContaining('libradicle embedded addon for mac-arm64'),
    ]);
  });

  test('the standard download installs the addon only', () => {
    expect(packageJson.scripts['radicle:download']).toBe('node scripts/fetch-radicle-addon.js');
    expect(packageJson.scripts['radicle:download-addon']).toBeUndefined();
  });
});
