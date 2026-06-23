const mockIsPackageWebContents = jest.fn();

jest.mock('./shell-api', () => ({
  isPackageWebContents: (...args) => mockIsPackageWebContents(...args),
}));

const {
  SWARM_PUBLISH_UNAVAILABLE,
  isPackageHostedInternalPage,
  packageHostedSwarmPublishUnavailable,
} = require('./package-hosted-internal-page');

describe('package-hosted-internal-page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('does not treat unhosted main-renderer IPC as package-hosted', () => {
    expect(isPackageHostedInternalPage({ sender: {} })).toBe(false);
    expect(mockIsPackageWebContents).not.toHaveBeenCalled();
  });

  test('detects an internal page hosted by package chrome', () => {
    const hostWebContents = { id: 42 };
    mockIsPackageWebContents.mockReturnValue(true);

    expect(
      isPackageHostedInternalPage({
        sender: {
          hostWebContents,
        },
      })
    ).toBe(true);
    expect(mockIsPackageWebContents).toHaveBeenCalledWith(hostWebContents);
  });

  test('returns a structured Swarm publish unavailable result', () => {
    expect(packageHostedSwarmPublishUnavailable()).toEqual({
      success: false,
      error: SWARM_PUBLISH_UNAVAILABLE,
    });
  });
});
