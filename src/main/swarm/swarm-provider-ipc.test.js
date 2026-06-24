const ipcHandlers = {};
const mockShowMessageBox = jest.fn();
jest.mock('electron', () => ({
  dialog: {
    showMessageBox: mockShowMessageBox,
  },
  ipcMain: {
    handle: (channel, handler) => {
      ipcHandlers[channel] = handler;
    },
    removeHandler: () => {},
  },
}));

jest.mock('electron-log', () => ({
  info: jest.fn(),
  error: jest.fn(),
}));

const mockGetPermission = jest.fn();
const mockGrantPermission = jest.fn();
const mockUpdateLastUsed = jest.fn();
jest.mock('./swarm-permissions', () => ({
  getPermission: mockGetPermission,
  grantPermission: mockGrantPermission,
  updateLastUsed: mockUpdateLastUsed,
}));

const mockGetBeeApiUrl = jest.fn();
jest.mock('../service-registry', () => ({
  getAntApiUrl: mockGetBeeApiUrl,
}));

const mockIsPackageWebContents = jest.fn();
const mockGetPackageWebContentsIdentity = jest.fn();
jest.mock('../shell-api', () => ({
  isPackageWebContents: mockIsPackageWebContents,
  getPackageWebContentsIdentity: mockGetPackageWebContentsIdentity,
}));

const mockPublishData = jest.fn();
const mockPublishFilesFromContent = jest.fn();
const mockGetUploadStatus = jest.fn();
jest.mock('./publish-service', () => ({
  publishData: mockPublishData,
  publishFilesFromContent: mockPublishFilesFromContent,
  getUploadStatus: mockGetUploadStatus,
}));

const mockCreateFeed = jest.fn();
const mockUpdateFeed = jest.fn();
const mockWriteFeedPayload = jest.fn();
const mockReadFeedPayload = jest.fn();
const mockBuildTopicString = jest.fn((origin, name) => `${origin}/${name}`);
jest.mock('./feed-service', () => ({
  createFeed: mockCreateFeed,
  updateFeed: mockUpdateFeed,
  writeFeedPayload: mockWriteFeedPayload,
  readFeedPayload: mockReadFeedPayload,
  buildTopicString: mockBuildTopicString,
}));

const mockPublishChunk = jest.fn();
const mockReadChunk = jest.fn();
const mockWriteSingleOwnerChunk = jest.fn();
const mockReadSingleOwnerChunk = jest.fn();
const mockGetSignerAddress = jest.fn();
jest.mock('./chunk-service', () => ({
  publishChunk: mockPublishChunk,
  readChunk: mockReadChunk,
  writeSingleOwnerChunk: mockWriteSingleOwnerChunk,
  readSingleOwnerChunk: mockReadSingleOwnerChunk,
  getSignerAddress: mockGetSignerAddress,
}));

// Mock bee-js Topic for readFeedEntry topic resolution
class MockTopic {
  constructor(hex) { this._hex = hex; }
  toHex() { return this._hex; }
  static fromString(s) { return new MockTopic(s.slice(0, 64).padEnd(64, '0')); }
}
jest.mock('@ethersphere/bee-js', () => ({
  Topic: MockTopic,
}));

const mockGetOriginEntry = jest.fn();
const mockSetOriginEntry = jest.fn();
const mockGetFeed = jest.fn();
const mockSetFeed = jest.fn();
const mockUpdateFeedReference = jest.fn();
const mockHasFeedGrant = jest.fn();
const mockGrantFeedAccess = jest.fn();
const mockGetAllFeeds = jest.fn();
jest.mock('./feed-store', () => ({
  getOriginEntry: mockGetOriginEntry,
  setOriginEntry: mockSetOriginEntry,
  getFeed: mockGetFeed,
  setFeed: mockSetFeed,
  updateFeedReference: mockUpdateFeedReference,
  hasFeedGrant: mockHasFeedGrant,
  grantFeedAccess: mockGrantFeedAccess,
  getAllFeeds: mockGetAllFeeds,
}));

const mockGetDerivedKeys = jest.fn();
const mockGetPublisherKey = jest.fn();
const mockGetUserWalletKey = jest.fn();
jest.mock('../identity-manager', () => ({
  getDerivedKeys: mockGetDerivedKeys,
  getPublisherKey: mockGetPublisherKey,
  getUserWalletKey: mockGetUserWalletKey,
}));

const mockAddEntry = jest.fn().mockReturnValue({ id: 'test-id' });
const mockUpdateEntry = jest.fn();
jest.mock('./publish-history', () => ({
  addEntry: mockAddEntry,
  updateEntry: mockUpdateEntry,
}));

// Mock global fetch for pre-flight checks
global.fetch = jest.fn();

const {
  registerSwarmProviderIpc,
  handleReadonlyProviderRequest,
  handleProviderHostContext,
  handleProviderTrustedPromptRequest,
  checkSwarmPreFlight,
  checkBeeReachable,
  validateVirtualPath,
  validateFeedName,
  clearTagOwnership,
  clearPermissionFreeReadBudgets,
  LIMITS,
} = require('./swarm-provider-ipc');

registerSwarmProviderIpc();

async function invokeProvider(method, params, origin) {
  const handler = ipcHandlers['swarm:provider-execute'];
  return handler({}, { method, params, origin });
}

  function mockV2FeedCapability(origin, activeIdentityId = 'app-scoped:2') {
    const identities = {
      'app-scoped:1': {
        id: 'app-scoped:1',
        mode: 'app-scoped',
        publisherKeyIndex: 1,
      },
      'app-scoped:2': {
        id: 'app-scoped:2',
        mode: 'app-scoped',
        publisherKeyIndex: 2,
      },
      'ethereum-wallet:2': {
        id: 'ethereum-wallet:2',
        mode: 'ethereum-wallet',
        walletIndex: 2,
      },
    };
  const activeIdentity = identities[activeIdentityId];
  mockGetPermission.mockReturnValue({ origin, connectedAt: 1, lastUsed: 1, autoApprove: { publish: false, feeds: false } });
  mockHasFeedGrant.mockReturnValue(true);
  mockGetOriginEntry.mockReturnValue({
    activeIdentityId,
    identities,
    identityMode: activeIdentity.mode,
    publisherKeyIndex: activeIdentity.publisherKeyIndex,
    feeds: {},
  });
}

describe('swarm-provider-ipc', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearPermissionFreeReadBudgets();
  });

  test('registers swarm:provider-execute handler', () => {
    expect(ipcHandlers['swarm:provider-execute']).toBeDefined();
  });

  test('registers swarm:provider-readonly-request handler', () => {
    expect(ipcHandlers['swarm:provider-readonly-request']).toBeDefined();
  });

  test('registers swarm:provider-host-context handler', () => {
    expect(ipcHandlers['swarm:provider-host-context']).toBeDefined();
  });

  test('registers swarm:provider-trusted-prompt-request handler', () => {
    expect(ipcHandlers['swarm:provider-trusted-prompt-request']).toBeDefined();
  });

  describe('provider host context handler', () => {
    test('reports package-hosted guest webviews from the main-owned host sender', () => {
      const hostWebContents = { id: 20 };
      mockIsPackageWebContents.mockReturnValue(true);

      expect(handleProviderHostContext({ sender: { hostWebContents } })).toEqual({
        packageHosted: true,
      });
      expect(mockIsPackageWebContents).toHaveBeenCalledWith(hostWebContents);
    });

    test('reports false when a provider request has no package host', () => {
      expect(handleProviderHostContext({ sender: {} })).toEqual({
        packageHosted: false,
      });
      expect(mockIsPackageWebContents).not.toHaveBeenCalled();
    });
  });

  describe('readonly provider handler', () => {
    test('supports swarm_getCapabilities without a renderer permission broker', async () => {
      mockGetPermission.mockReturnValue(null);
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ beeMode: 'light' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ready' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ stamps: [{ usable: true }] }) });

      const result = await handleReadonlyProviderRequest(
        { senderFrame: { url: 'https://app.example/page' } },
        { method: 'swarm_getCapabilities', params: {} }
      );

      expect(mockGetPermission).toHaveBeenCalledWith('https://app.example');
      expect(result.result).toMatchObject({
        canPublish: false,
        reason: 'not-connected',
      });
    });

    test('rejects privileged swarm methods on the readonly path', async () => {
      const result = await handleReadonlyProviderRequest(
        { senderFrame: { url: 'https://app.example/page' } },
        { method: 'swarm_publishData', params: { data: 'hello' } }
      );

      expect(result).toEqual({
        result: null,
        error: {
          code: 4200,
          message: 'Method not supported: swarm_publishData',
        },
      });
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('trusted prompt provider handler', () => {
    function buildPackageHostedEvent(url = 'ipfs://bafyfixture/') {
      return {
        sender: {
          id: 42,
          hostWebContents: {
            id: 20,
            getOwnerBrowserWindow: jest.fn(() => ({ id: 5 })),
          },
          getURL: jest.fn(() => url),
        },
      };
    }

    function mockPreFlightOk() {
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ beeMode: 'light' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ready' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ stamps: [{ usable: true }] }) });
    }

    function mockPackageIdentity() {
      mockGetPackageWebContentsIdentity.mockReturnValue({
        runtimeMode: 'local-package',
        source: 'local',
        packageId: 'baby.freedom.chrome.official',
        packageType: 'browser-chrome',
        name: 'Freedom Official Chrome',
        version: '0.7.5',
      });
    }

    test('returns existing package-hosted swarm_requestAccess grant without prompting', async () => {
      const event = buildPackageHostedEvent();
      mockIsPackageWebContents.mockReturnValue(true);
      mockGetPermission.mockReturnValue({
        origin: 'ipfs://bafyfixture',
        connectedAt: 1,
        lastUsed: 1,
        autoApprove: { publish: false, feeds: false },
      });

      const result = await handleProviderTrustedPromptRequest(event, {
        method: 'swarm_requestAccess',
        origin: 'https://spoofed.example',
      });

      expect(result).toEqual({
        result: {
          connected: true,
          origin: 'ipfs://bafyfixture',
          capabilities: ['publish'],
        },
      });
      expect(mockGetPermission).toHaveBeenCalledWith('ipfs://bafyfixture');
      expect(mockUpdateLastUsed).toHaveBeenCalledWith('ipfs://bafyfixture');
      expect(mockGrantPermission).not.toHaveBeenCalled();
      expect(mockShowMessageBox).not.toHaveBeenCalled();
    });

    test('fails package-hosted swarm_requestAccess when main cannot derive the guest origin', async () => {
      const event = buildPackageHostedEvent('');
      mockIsPackageWebContents.mockReturnValue(true);

      const result = await handleProviderTrustedPromptRequest(event, {
        method: 'swarm_requestAccess',
        origin: 'https://spoofed.example',
      });

      expect(result).toEqual({
        result: null,
        error: {
          code: 4100,
          message: 'Unable to derive Swarm provider origin',
          data: { reason: 'origin_unavailable' },
        },
      });
      expect(mockGetPermission).not.toHaveBeenCalled();
      expect(mockGrantPermission).not.toHaveBeenCalled();
      expect(mockShowMessageBox).not.toHaveBeenCalled();
    });

    test('routes rejected package-hosted swarm_requestAccess through a shell-owned prompt', async () => {
      const event = buildPackageHostedEvent();
      mockIsPackageWebContents.mockReturnValue(true);
      mockPackageIdentity();
      mockGetPermission.mockReturnValue(null);
      mockShowMessageBox.mockResolvedValue({ response: 1 });

      const result = await handleProviderTrustedPromptRequest(event, {
        method: 'swarm_requestAccess',
        origin: 'https://spoofed.example',
      });

      expect(mockGrantPermission).not.toHaveBeenCalled();
      expect(mockGetPackageWebContentsIdentity).toHaveBeenCalledWith(event.sender.hostWebContents);
      expect(mockShowMessageBox).toHaveBeenCalledWith(
        { id: 5 },
        expect.objectContaining({
          type: 'info',
          title: 'Freedom Swarm Connection',
          message: 'Swarm connection request',
          detail:
            'ipfs://bafyfixture requested Swarm publishing access. ' +
            'Choose Allow to let this site publish data through the shell-owned Swarm provider broker.',
          buttons: ['Allow', 'Reject'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        })
      );
      expect(result).toMatchObject({
        result: null,
        error: {
          code: 4001,
          message: 'User rejected the request',
          data: {
            reason: 'shell_trusted_prompt_rejected',
            prompt: {
              kind: 'swarm.connect',
              renderedBy: 'shell-native-dialog',
              surfaceOwner: 'shell',
              origin: 'ipfs://bafyfixture',
              webContentsId: 42,
            },
          },
        },
        trustedPrompt: {
          ok: true,
          kind: 'swarm.connect',
          renderedBy: 'shell-native-dialog',
          context: {
            origin: 'ipfs://bafyfixture',
            webContentsId: 42,
            caller: {
              packageId: 'baby.freedom.chrome.official',
            },
          },
        },
      });
    });

    test('grants package-hosted swarm_requestAccess after shell-owned approval', async () => {
      const event = buildPackageHostedEvent();
      mockIsPackageWebContents.mockReturnValue(true);
      mockPackageIdentity();
      mockGetPermission.mockReturnValue(null);
      mockGrantPermission.mockReturnValue({
        origin: 'ipfs://bafyfixture',
        connectedAt: 2,
        lastUsed: 2,
        autoApprove: { publish: false, feeds: false },
      });
      mockShowMessageBox.mockResolvedValue({ response: 0 });

      const result = await handleProviderTrustedPromptRequest(event, {
        method: 'swarm_requestAccess',
        origin: 'https://spoofed.example',
      });

      expect(mockGrantPermission).toHaveBeenCalledWith('ipfs://bafyfixture');
      expect(result).toMatchObject({
        result: {
          connected: true,
          origin: 'ipfs://bafyfixture',
          capabilities: ['publish'],
        },
        trustedPrompt: {
          ok: true,
          kind: 'swarm.connect',
          result: {
            outcome: 'accepted',
            source: 'shell-native-dialog',
            response: 0,
          },
          context: {
            origin: 'ipfs://bafyfixture',
            webContentsId: 42,
            caller: {
              packageId: 'baby.freedom.chrome.official',
            },
          },
        },
      });
    });

    test('rejects invalid package-hosted swarm_publishData before opening a prompt', async () => {
      const event = buildPackageHostedEvent();
      mockIsPackageWebContents.mockReturnValue(true);

      const result = await handleProviderTrustedPromptRequest(event, {
        method: 'swarm_publishData',
        params: { data: 'hello' },
        origin: 'https://spoofed.example',
      });

      expect(result).toEqual({
        result: null,
        error: {
          code: -32602,
          message: 'contentType is required',
          data: { reason: 'missing_content_type' },
        },
      });
      expect(mockShowMessageBox).not.toHaveBeenCalled();
      expect(mockPublishData).not.toHaveBeenCalled();
    });

    test('fails package-hosted swarm_publishData when main cannot derive the guest origin', async () => {
      const event = buildPackageHostedEvent('');
      mockIsPackageWebContents.mockReturnValue(true);

      const result = await handleProviderTrustedPromptRequest(event, {
        method: 'swarm_publishData',
        params: { data: 'hello', contentType: 'text/plain' },
        origin: 'https://spoofed.example',
      });

      expect(result).toEqual({
        result: null,
        error: {
          code: 4100,
          message: 'Unable to derive Swarm provider origin',
          data: { reason: 'origin_unavailable' },
        },
      });
      expect(mockShowMessageBox).not.toHaveBeenCalled();
      expect(mockPublishData).not.toHaveBeenCalled();
    });

    test('routes rejected package-hosted swarm_publishData through a shell-owned prompt', async () => {
      const event = buildPackageHostedEvent();
      mockIsPackageWebContents.mockReturnValue(true);
      mockPackageIdentity();
      mockShowMessageBox.mockResolvedValue({ response: 1 });

      const result = await handleProviderTrustedPromptRequest(event, {
        method: 'swarm_publishData',
        params: { data: 'hello', contentType: 'text/plain' },
        origin: 'https://spoofed.example',
      });

      expect(mockPublishData).not.toHaveBeenCalled();
      expect(mockGetPackageWebContentsIdentity).toHaveBeenCalledWith(event.sender.hostWebContents);
      expect(mockShowMessageBox).toHaveBeenCalledWith(
        { id: 5 },
        expect.objectContaining({
          type: 'info',
          title: 'Freedom Swarm Publish',
          message: 'Swarm publish request',
          detail:
            'ipfs://bafyfixture requested to publish data to Swarm. ' +
            'Type: text/plain. ' +
            'Size: 5 bytes. ' +
            'Choose Publish only if you trust this request.',
          buttons: ['Publish', 'Reject'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        })
      );
      expect(result).toMatchObject({
        result: null,
        error: {
          code: 4001,
          message: 'User rejected the request',
          data: {
            reason: 'shell_trusted_prompt_rejected',
            prompt: {
              kind: 'swarm.publish',
              renderedBy: 'shell-native-dialog',
              surfaceOwner: 'shell',
              origin: 'ipfs://bafyfixture',
              webContentsId: 42,
            },
          },
        },
        trustedPrompt: {
          ok: true,
          kind: 'swarm.publish',
          renderedBy: 'shell-native-dialog',
          context: {
            origin: 'ipfs://bafyfixture',
            webContentsId: 42,
            caller: {
              packageId: 'baby.freedom.chrome.official',
            },
          },
        },
      });
    });

    test('publishes package-hosted swarm_publishData after shell-owned approval', async () => {
      const event = buildPackageHostedEvent();
      mockIsPackageWebContents.mockReturnValue(true);
      mockPackageIdentity();
      mockShowMessageBox.mockResolvedValue({ response: 0 });
      mockPreFlightOk();
      mockPublishData.mockResolvedValue({
        reference: 'abc123',
        bzzUrl: 'bzz://abc123',
        tagUid: null,
        batchIdUsed: 'batch1',
      });

      const result = await handleProviderTrustedPromptRequest(event, {
        method: 'swarm_publishData',
        params: { data: 'hello', contentType: 'text/plain', name: 'note.txt' },
        origin: 'https://spoofed.example',
      });

      expect(mockGetPermission).not.toHaveBeenCalled();
      expect(mockPublishData).toHaveBeenCalledWith('hello', {
        contentType: 'text/plain',
        name: 'note.txt',
      });
      expect(mockAddEntry).toHaveBeenCalledWith({
        type: 'data',
        name: 'note.txt',
        status: 'uploading',
        origin: 'ipfs://bafyfixture',
        bytesSize: 5,
      });
      expect(mockUpdateEntry).toHaveBeenCalledWith(
        'test-id',
        expect.objectContaining({ status: 'completed', reference: 'abc123' })
      );
      expect(result).toMatchObject({
        result: { reference: 'abc123', bzzUrl: 'bzz://abc123' },
        trustedPrompt: {
          ok: true,
          kind: 'swarm.publish',
          result: {
            outcome: 'accepted',
            source: 'shell-native-dialog',
            response: 0,
          },
          request: {
            details: {
              contentType: 'text/plain',
              sizeBytes: 5,
              name: 'note.txt',
            },
          },
          context: {
            origin: 'ipfs://bafyfixture',
            webContentsId: 42,
            caller: {
              packageId: 'baby.freedom.chrome.official',
            },
          },
        },
      });
    });

    test('rejects invalid package-hosted swarm_publishFiles before opening a prompt', async () => {
      const event = buildPackageHostedEvent();
      mockIsPackageWebContents.mockReturnValue(true);

      const result = await handleProviderTrustedPromptRequest(event, {
        method: 'swarm_publishFiles',
        params: {
          files: [{ path: '../secret.txt', bytes: Buffer.from('secret') }],
          indexDocument: '../secret.txt',
        },
        origin: 'https://spoofed.example',
      });

      expect(result).toEqual({
        result: null,
        error: {
          code: -32602,
          message: 'files[0].path: "." and ".." segments are not allowed',
          data: { reason: 'invalid_path' },
        },
      });
      expect(mockShowMessageBox).not.toHaveBeenCalled();
      expect(mockPublishFilesFromContent).not.toHaveBeenCalled();
    });

    test('routes rejected package-hosted swarm_publishFiles through a shell-owned prompt', async () => {
      const event = buildPackageHostedEvent();
      mockIsPackageWebContents.mockReturnValue(true);
      mockPackageIdentity();
      mockShowMessageBox.mockResolvedValue({ response: 1 });

      const result = await handleProviderTrustedPromptRequest(event, {
        method: 'swarm_publishFiles',
        params: {
          files: [
            { path: 'index.html', bytes: Buffer.from('home') },
            { path: 'style.css', bytes: Buffer.from('body') },
          ],
          indexDocument: 'index.html',
        },
        origin: 'https://spoofed.example',
      });

      expect(mockPublishFilesFromContent).not.toHaveBeenCalled();
      expect(mockGetPackageWebContentsIdentity).toHaveBeenCalledWith(event.sender.hostWebContents);
      expect(mockShowMessageBox).toHaveBeenCalledWith(
        { id: 5 },
        expect.objectContaining({
          type: 'info',
          title: 'Freedom Swarm Publish',
          message: 'Swarm publish request',
          detail:
            'ipfs://bafyfixture requested to publish files to Swarm. ' +
            'Files: 2. ' +
            'Size: 8 bytes. ' +
            'Index: index.html. ' +
            'Choose Publish only if you trust this request.',
          buttons: ['Publish', 'Reject'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        })
      );
      expect(result).toMatchObject({
        result: null,
        error: {
          code: 4001,
          message: 'User rejected the request',
          data: {
            reason: 'shell_trusted_prompt_rejected',
            prompt: {
              kind: 'swarm.publish',
              renderedBy: 'shell-native-dialog',
              surfaceOwner: 'shell',
              origin: 'ipfs://bafyfixture',
              webContentsId: 42,
            },
          },
        },
        trustedPrompt: {
          ok: true,
          kind: 'swarm.publish',
          renderedBy: 'shell-native-dialog',
          request: {
            method: 'swarm_publishFiles',
            details: {
              fileCount: 2,
              sizeBytes: 8,
              indexDocument: 'index.html',
            },
          },
          context: {
            origin: 'ipfs://bafyfixture',
            webContentsId: 42,
            caller: {
              packageId: 'baby.freedom.chrome.official',
            },
          },
        },
      });
    });

    test('publishes package-hosted swarm_publishFiles after shell-owned approval', async () => {
      const event = buildPackageHostedEvent();
      mockIsPackageWebContents.mockReturnValue(true);
      mockPackageIdentity();
      mockShowMessageBox.mockResolvedValue({ response: 0 });
      mockPreFlightOk();
      mockPublishFilesFromContent.mockResolvedValue({
        reference: 'site123',
        bzzUrl: 'bzz://site123',
        tagUid: 42,
        batchIdUsed: 'batch1',
      });

      const result = await handleProviderTrustedPromptRequest(event, {
        method: 'swarm_publishFiles',
        params: {
          files: [
            { path: 'index.html', bytes: Buffer.from('home'), contentType: 'text/html' },
            { path: 'style.css', bytes: Buffer.from('body'), contentType: 'text/css' },
          ],
          indexDocument: 'index.html',
        },
        origin: 'https://spoofed.example',
      });

      expect(mockPublishFilesFromContent).toHaveBeenCalledWith(
        [
          { path: 'index.html', bytes: Buffer.from('home'), contentType: 'text/html' },
          { path: 'style.css', bytes: Buffer.from('body'), contentType: 'text/css' },
        ],
        { indexDocument: 'index.html' }
      );
      expect(mockAddEntry).toHaveBeenCalledWith({
        type: 'directory',
        name: 'index.html',
        status: 'uploading',
        origin: 'ipfs://bafyfixture',
        bytesSize: 8,
      });
      expect(mockUpdateEntry).toHaveBeenCalledWith(
        'test-id',
        expect.objectContaining({ status: 'completed', reference: 'site123' })
      );
      expect(result).toMatchObject({
        result: { reference: 'site123', bzzUrl: 'bzz://site123', tagUid: 42 },
        trustedPrompt: {
          ok: true,
          kind: 'swarm.publish',
          result: {
            outcome: 'accepted',
            source: 'shell-native-dialog',
            response: 0,
          },
          request: {
            method: 'swarm_publishFiles',
            details: {
              fileCount: 2,
              sizeBytes: 8,
              indexDocument: 'index.html',
            },
          },
          context: {
            origin: 'ipfs://bafyfixture',
            webContentsId: 42,
            caller: {
              packageId: 'baby.freedom.chrome.official',
            },
          },
        },
      });
    });

    test('rejects invalid package-hosted swarm_createFeed before opening a prompt', async () => {
      const event = buildPackageHostedEvent();
      mockIsPackageWebContents.mockReturnValue(true);
      mockGetPermission.mockReturnValue({ origin: 'ipfs://bafyfixture' });

      const result = await handleProviderTrustedPromptRequest(event, {
        method: 'swarm_createFeed',
        params: { name: 'bad/name' },
        origin: 'https://spoofed.example',
      });

      expect(result).toEqual({
        result: null,
        error: {
          code: -32602,
          message: 'Feed name must not contain "/"',
          data: { reason: 'invalid_feed_name' },
        },
      });
      expect(mockShowMessageBox).not.toHaveBeenCalled();
      expect(mockSetOriginEntry).not.toHaveBeenCalled();
      expect(mockCreateFeed).not.toHaveBeenCalled();
    });

    test('rejects package-hosted swarm_createFeed without a Swarm connection grant', async () => {
      const event = buildPackageHostedEvent();
      mockIsPackageWebContents.mockReturnValue(true);
      mockGetPermission.mockReturnValue(null);

      const result = await handleProviderTrustedPromptRequest(event, {
        method: 'swarm_createFeed',
        params: { name: 'blog' },
        origin: 'https://spoofed.example',
      });

      expect(result).toEqual({
        result: null,
        error: {
          code: 4100,
          message: 'The origin is not authorized for this operation',
          data: { reason: 'not_connected' },
        },
      });
      expect(mockShowMessageBox).not.toHaveBeenCalled();
      expect(mockSetOriginEntry).not.toHaveBeenCalled();
      expect(mockCreateFeed).not.toHaveBeenCalled();
    });

    test('routes rejected package-hosted swarm_createFeed through a shell-owned prompt', async () => {
      const event = buildPackageHostedEvent();
      mockIsPackageWebContents.mockReturnValue(true);
      mockPackageIdentity();
      mockGetPermission.mockReturnValue({
        origin: 'ipfs://bafyfixture',
        connectedAt: 1,
        lastUsed: 1,
        autoApprove: { publish: false, feeds: false },
      });
      mockShowMessageBox.mockResolvedValue({ response: 1 });

      const result = await handleProviderTrustedPromptRequest(event, {
        method: 'swarm_createFeed',
        params: { name: 'blog' },
        origin: 'https://spoofed.example',
      });

      expect(mockSetOriginEntry).not.toHaveBeenCalled();
      expect(mockGrantFeedAccess).not.toHaveBeenCalled();
      expect(mockCreateFeed).not.toHaveBeenCalled();
      expect(mockGetPackageWebContentsIdentity).toHaveBeenCalledWith(event.sender.hostWebContents);
      expect(mockShowMessageBox).toHaveBeenCalledWith(
        { id: 5 },
        expect.objectContaining({
          type: 'info',
          title: 'Freedom Swarm Feed',
          message: 'Swarm feed request',
          detail:
            'ipfs://bafyfixture requested to create a Swarm feed. ' +
            'Feed: blog. ' +
            'Choose Allow only if you trust this request.',
          buttons: ['Allow', 'Reject'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        })
      );
      expect(result).toMatchObject({
        result: null,
        error: {
          code: 4001,
          message: 'User rejected the request',
          data: {
            reason: 'shell_trusted_prompt_rejected',
            prompt: {
              kind: 'swarm.feed',
              renderedBy: 'shell-native-dialog',
              surfaceOwner: 'shell',
              origin: 'ipfs://bafyfixture',
              webContentsId: 42,
            },
          },
        },
        trustedPrompt: {
          ok: true,
          kind: 'swarm.feed',
          renderedBy: 'shell-native-dialog',
          request: {
            method: 'swarm_createFeed',
            details: {
              feedName: 'blog',
              identityMode: 'app-scoped',
            },
          },
          context: {
            origin: 'ipfs://bafyfixture',
            webContentsId: 42,
            caller: {
              packageId: 'baby.freedom.chrome.official',
            },
          },
        },
      });
    });

    test('creates package-hosted swarm_createFeed after shell-owned approval', async () => {
      const event = buildPackageHostedEvent();
      const origin = 'ipfs://bafyfixture';
      const feedEntry = {
        activeIdentityId: 'app-scoped:0',
        identities: {
          'app-scoped:0': {
            id: 'app-scoped:0',
            mode: 'app-scoped',
            publisherKeyIndex: 0,
          },
        },
        identityMode: 'app-scoped',
        publisherKeyIndex: 0,
        feeds: {},
      };
      mockIsPackageWebContents.mockReturnValue(true);
      mockPackageIdentity();
      mockGetPermission.mockReturnValue({
        origin,
        connectedAt: 1,
        lastUsed: 1,
        autoApprove: { publish: false, feeds: false },
      });
      mockGetOriginEntry
        .mockReturnValueOnce(null)
        .mockReturnValue(feedEntry);
      mockSetOriginEntry.mockReturnValue(feedEntry);
      mockHasFeedGrant.mockReturnValue(true);
      mockGetFeed.mockReturnValue(null);
      mockShowMessageBox.mockResolvedValue({ response: 0 });
      mockPreFlightOk();
      mockGetPublisherKey.mockResolvedValue({ privateKey: '0xpublisherkey' });
      mockCreateFeed.mockResolvedValue({
        topic: 'topichex',
        owner: '0xOwnerAddr',
        manifestReference: 'manifesthex',
        bzzUrl: 'bzz://manifesthex',
      });

      const result = await handleProviderTrustedPromptRequest(event, {
        method: 'swarm_createFeed',
        params: { name: 'blog' },
        origin: 'https://spoofed.example',
      });

      expect(mockSetOriginEntry).toHaveBeenCalledWith(origin, {
        identityMode: 'app-scoped',
        feedGranted: true,
      });
      expect(mockUpdateLastUsed).toHaveBeenCalledWith(origin);
      expect(mockCreateFeed).toHaveBeenCalledWith('0xpublisherkey', `${origin}/blog`);
      expect(mockSetFeed).toHaveBeenCalledWith(origin, 'blog', expect.objectContaining({
        topic: 'topichex',
        owner: '0xOwnerAddr',
        identityId: 'app-scoped:0',
      }));
      expect(result).toMatchObject({
        result: {
          feedId: 'blog',
          owner: '0xOwnerAddr',
          manifestReference: 'manifesthex',
          bzzUrl: 'bzz://manifesthex',
          identityMode: 'app-scoped',
        },
        trustedPrompt: {
          ok: true,
          kind: 'swarm.feed',
          result: {
            outcome: 'accepted',
            source: 'shell-native-dialog',
            response: 0,
          },
          request: {
            method: 'swarm_createFeed',
            details: {
              feedName: 'blog',
              identityMode: 'app-scoped',
            },
          },
          context: {
            origin,
            webContentsId: 42,
            caller: {
              packageId: 'baby.freedom.chrome.official',
            },
          },
        },
      });
    });

    test('rejects package-hosted swarm_updateFeed without a feed grant before opening a prompt', async () => {
      const event = buildPackageHostedEvent();
      mockIsPackageWebContents.mockReturnValue(true);
      mockGetPermission.mockReturnValue({
        origin: 'ipfs://bafyfixture',
        connectedAt: 1,
        lastUsed: 1,
        autoApprove: { publish: false, feeds: false },
      });
      mockHasFeedGrant.mockReturnValue(false);

      const result = await handleProviderTrustedPromptRequest(event, {
        method: 'swarm_updateFeed',
        params: { feedId: 'blog', reference: 'aa'.repeat(32) },
        origin: 'https://spoofed.example',
      });

      expect(result).toEqual({
        result: null,
        error: {
          code: 4100,
          message: 'The origin is not authorized for this operation',
          data: { reason: 'feed_not_granted' },
        },
      });
      expect(mockShowMessageBox).not.toHaveBeenCalled();
      expect(mockUpdateFeed).not.toHaveBeenCalled();
    });

    test('rejects package-hosted swarm_updateFeed when feed is missing before opening a prompt', async () => {
      const event = buildPackageHostedEvent();
      mockIsPackageWebContents.mockReturnValue(true);
      mockGetPermission.mockReturnValue({
        origin: 'ipfs://bafyfixture',
        connectedAt: 1,
        lastUsed: 1,
        autoApprove: { publish: false, feeds: false },
      });
      mockHasFeedGrant.mockReturnValue(true);
      mockGetFeed.mockReturnValue(null);

      const result = await handleProviderTrustedPromptRequest(event, {
        method: 'swarm_updateFeed',
        params: { feedId: 'blog', reference: 'aa'.repeat(32) },
        origin: 'https://spoofed.example',
      });

      expect(result).toEqual({
        result: null,
        error: {
          code: -32602,
          message: 'Feed not found: blog',
          data: { reason: 'feed_not_found' },
        },
      });
      expect(mockShowMessageBox).not.toHaveBeenCalled();
      expect(mockUpdateFeed).not.toHaveBeenCalled();
    });

    test('routes rejected package-hosted swarm_updateFeed through a shell-owned prompt', async () => {
      const event = buildPackageHostedEvent();
      mockIsPackageWebContents.mockReturnValue(true);
      mockPackageIdentity();
      mockGetPermission.mockReturnValue({
        origin: 'ipfs://bafyfixture',
        connectedAt: 1,
        lastUsed: 1,
        autoApprove: { publish: false, feeds: false },
      });
      mockHasFeedGrant.mockReturnValue(true);
      mockGetFeed.mockReturnValue({
        topic: 'topichex',
        owner: '0xOwnerAddr',
        manifestReference: 'manifesthex',
      });
      mockShowMessageBox.mockResolvedValue({ response: 1 });

      const result = await handleProviderTrustedPromptRequest(event, {
        method: 'swarm_updateFeed',
        params: { feedId: 'blog', reference: 'aa'.repeat(32) },
        origin: 'https://spoofed.example',
      });

      expect(mockUpdateFeed).not.toHaveBeenCalled();
      expect(mockShowMessageBox).toHaveBeenCalledWith(
        { id: 5 },
        expect.objectContaining({
          type: 'info',
          title: 'Freedom Swarm Feed',
          message: 'Swarm feed request',
          detail:
            'ipfs://bafyfixture requested to update a Swarm feed. ' +
            'Feed: blog. ' +
            `Reference: ${'aa'.repeat(32)}. ` +
            'Choose Allow only if you trust this request.',
          buttons: ['Allow', 'Reject'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        })
      );
      expect(result).toMatchObject({
        result: null,
        error: {
          code: 4001,
          message: 'User rejected the request',
          data: {
            reason: 'shell_trusted_prompt_rejected',
            prompt: {
              kind: 'swarm.feed',
              renderedBy: 'shell-native-dialog',
              surfaceOwner: 'shell',
              origin: 'ipfs://bafyfixture',
              webContentsId: 42,
            },
          },
        },
        trustedPrompt: {
          ok: true,
          kind: 'swarm.feed',
          renderedBy: 'shell-native-dialog',
          request: {
            method: 'swarm_updateFeed',
            details: {
              action: 'update',
              feedName: 'blog',
              reference: 'aa'.repeat(32),
            },
          },
        },
      });
    });

    test('updates package-hosted swarm_updateFeed after shell-owned approval', async () => {
      const event = buildPackageHostedEvent();
      const origin = 'ipfs://bafyfixture';
      const reference = 'aa'.repeat(32);
      mockIsPackageWebContents.mockReturnValue(true);
      mockPackageIdentity();
      mockGetPermission.mockReturnValue({
        origin,
        connectedAt: 1,
        lastUsed: 1,
        autoApprove: { publish: false, feeds: false },
      });
      mockHasFeedGrant.mockReturnValue(true);
      mockGetOriginEntry.mockReturnValue({
        activeIdentityId: 'app-scoped:0',
        identities: {
          'app-scoped:0': {
            id: 'app-scoped:0',
            mode: 'app-scoped',
            publisherKeyIndex: 0,
          },
        },
        identityMode: 'app-scoped',
        publisherKeyIndex: 0,
        feeds: {},
      });
      mockGetFeed.mockReturnValue({
        topic: 'topichex',
        owner: '0xOwnerAddr',
        manifestReference: 'manifesthex',
        identityId: 'app-scoped:0',
      });
      mockShowMessageBox.mockResolvedValue({ response: 0 });
      mockPreFlightOk();
      mockGetPublisherKey.mockResolvedValue({ privateKey: '0xpublisherkey' });
      mockUpdateFeed.mockResolvedValue({ index: 9 });

      const result = await handleProviderTrustedPromptRequest(event, {
        method: 'swarm_updateFeed',
        params: { feedId: 'blog', reference },
        origin: 'https://spoofed.example',
      });

      expect(mockUpdateLastUsed).toHaveBeenCalledWith(origin);
      expect(mockUpdateFeed).toHaveBeenCalledWith('0xpublisherkey', `${origin}/blog`, reference);
      expect(mockUpdateFeedReference).toHaveBeenCalledWith(origin, 'blog', reference);
      expect(result).toMatchObject({
        result: {
          feedId: 'blog',
          reference,
          bzzUrl: 'bzz://manifesthex',
          index: 9,
        },
        trustedPrompt: {
          ok: true,
          kind: 'swarm.feed',
          result: {
            outcome: 'accepted',
            source: 'shell-native-dialog',
            response: 0,
          },
          request: {
            method: 'swarm_updateFeed',
            details: {
              action: 'update',
              feedName: 'blog',
              reference,
            },
          },
        },
      });
    });

    test('keeps unsupported package-hosted privileged swarm methods unavailable', async () => {
      const event = buildPackageHostedEvent();
      mockIsPackageWebContents.mockReturnValue(true);

      await expect(
        handleProviderTrustedPromptRequest(event, { method: 'swarm_writeFeedEntry' })
      ).resolves.toEqual({
        result: null,
        error: {
          code: 4200,
          message:
            'Swarm method is unavailable in package mode until a shell-owned trusted prompt exists: swarm_writeFeedEntry',
          data: { reason: 'trusted_prompt_unavailable' },
        },
      });
      expect(mockShowMessageBox).not.toHaveBeenCalled();
    });

    test('rejects trusted prompt requests without a package host', async () => {
      const result = await handleProviderTrustedPromptRequest(
        { sender: { id: 7, getURL: jest.fn(() => 'https://app.example/') } },
        { method: 'swarm_publishData' }
      );

      expect(result).toEqual({
        result: null,
        error: {
          code: 4100,
          message: 'Trusted Swarm provider prompt is only available for package-hosted guests',
          data: { reason: 'not_package_hosted' },
        },
      });
      expect(mockShowMessageBox).not.toHaveBeenCalled();
    });
  });

  describe('method dispatch', () => {
    test('unknown method returns 4200', async () => {
      const result = await invokeProvider('swarm_unknownMethod', {}, 'test.eth');
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe(4200);
      expect(result.error.message).toContain('Unknown method');
    });

    test('missing method returns -32602', async () => {
      const result = await invokeProvider(null, {}, 'test.eth');
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe(-32602);
    });

    test('empty string method returns -32602', async () => {
      const result = await invokeProvider('', {}, 'test.eth');
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe(-32602);
    });
  });

  describe('swarm_requestAccess', () => {
    test('returns connected for authorized origin', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth', connectedAt: 1, lastUsed: 1, autoApprove: { publish: false, feeds: false } });
      const result = await invokeProvider('swarm_requestAccess', {}, 'myapp.eth');
      expect(result.result).toEqual({
        connected: true,
        origin: 'myapp.eth',
        capabilities: ['publish'],
      });
    });

    test('returns 4100 for unauthorized origin', async () => {
      mockGetPermission.mockReturnValue(null);
      const result = await invokeProvider('swarm_requestAccess', {}, 'unknown.eth');
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe(4100);
      expect(result.error.message).toBe('The origin is not authorized for this operation');
      expect(result.error.data.reason).toBe('not_connected');
    });
  });

  describe('swarm_getCapabilities', () => {
    test('returns full capabilities when node is ready', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ beeMode: 'light' }) })      // /node
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ready' }) })         // /readiness
        .mockResolvedValueOnce({ ok: true, json: async () => ({ stamps: [{ usable: true }] }) }); // /stamps

      const result = await invokeProvider('swarm_getCapabilities', {}, 'myapp.eth');
      expect(result.result).toEqual({
        specVersion: '1.0',
        canPublish: true,
        reason: null,
        publisherIdentityModes: ['app-scoped', 'bee-wallet', 'ethereum-wallet'],
        extensions: {
          ethereumWalletPublisherIdentity: true,
          publisherSigning: true,
        },
        limits: {
          maxDataBytes: LIMITS.maxDataBytes,
          maxFilesBytes: LIMITS.maxFilesBytes,
          maxFileCount: LIMITS.maxFileCount,
          maxPathBytes: LIMITS.maxPathBytes,
          maxChunkPayloadBytes: LIMITS.maxChunkPayloadBytes,
        },
      });
    });

    test('returns canPublish false when node is stopped', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockGetBeeApiUrl.mockReturnValue(null);

      const result = await invokeProvider('swarm_getCapabilities', {}, 'myapp.eth');
      expect(result.result.canPublish).toBe(false);
      expect(result.result.reason).toBe('node-stopped');
    });

    test('returns canPublish false in ultra-light mode', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ beeMode: 'ultra-light' }) });

      const result = await invokeProvider('swarm_getCapabilities', {}, 'myapp.eth');
      expect(result.result.canPublish).toBe(false);
      expect(result.result.reason).toBe('ultra-light-mode');
    });

    test('returns canPublish false with no usable stamps', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ beeMode: 'light' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ready' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ stamps: [] }) });

      const result = await invokeProvider('swarm_getCapabilities', {}, 'myapp.eth');
      expect(result.result.canPublish).toBe(false);
      expect(result.result.reason).toBe('no-usable-stamps');
    });

    test('returns not-connected when origin has no permission', async () => {
      mockGetPermission.mockReturnValue(null);
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ beeMode: 'light' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ready' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ stamps: [{ usable: true }] }) });

      const result = await invokeProvider('swarm_getCapabilities', {}, 'unknown.eth');
      expect(result.result.canPublish).toBe(false);
      expect(result.result.reason).toBe('not-connected');
    });

    test('always includes limits', async () => {
      mockGetPermission.mockReturnValue(null);
      mockGetBeeApiUrl.mockReturnValue(null);

      const result = await invokeProvider('swarm_getCapabilities', {}, 'test.eth');
      expect(result.result.limits).toEqual({
        maxDataBytes: LIMITS.maxDataBytes,
        maxFilesBytes: LIMITS.maxFilesBytes,
        maxFileCount: LIMITS.maxFileCount,
        maxPathBytes: LIMITS.maxPathBytes,
        maxChunkPayloadBytes: LIMITS.maxChunkPayloadBytes,
      });
      expect(result.result.specVersion).toBe('1.0');
    });
  });

  describe('swarm_publishData', () => {
    function mockPreFlightOk() {
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ beeMode: 'light' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ready' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ stamps: [{ usable: true }] }) });
    }

    test('publishes data and returns reference + bzzUrl', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockPreFlightOk();
      mockPublishData.mockResolvedValue({
        reference: 'abc123',
        bzzUrl: 'bzz://abc123',
        tagUid: null,
        batchIdUsed: 'batch1',
      });

      const result = await invokeProvider('swarm_publishData', {
        data: 'Hello world',
        contentType: 'text/plain',
        name: 'greeting',
      }, 'myapp.eth');

      expect(result.result).toEqual({ reference: 'abc123', bzzUrl: 'bzz://abc123' });
      expect(mockPublishData).toHaveBeenCalledWith('Hello world', {
        contentType: 'text/plain',
        name: 'greeting',
      });
      expect(mockAddEntry).toHaveBeenCalledWith({
        type: 'data',
        name: 'greeting',
        status: 'uploading',
        origin: 'myapp.eth',
        bytesSize: Buffer.byteLength('Hello world', 'utf-8'),
      });
      expect(mockUpdateEntry).toHaveBeenCalledWith('test-id', expect.objectContaining({ status: 'completed' }));
    });

    test('publishes binary data (Buffer) and returns reference + bzzUrl', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockPreFlightOk();
      mockPublishData.mockResolvedValue({
        reference: 'def456',
        bzzUrl: 'bzz://def456',
        tagUid: null,
        batchIdUsed: 'batch2',
      });

      const binaryData = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header bytes
      const result = await invokeProvider('swarm_publishData', {
        data: binaryData,
        contentType: 'image/png',
        name: 'test.png',
      }, 'myapp.eth');

      expect(result.result).toEqual({ reference: 'def456', bzzUrl: 'bzz://def456' });
      expect(mockPublishData).toHaveBeenCalledWith(binaryData, {
        contentType: 'image/png',
        name: 'test.png',
      });
    });

    test('normalizes ArrayBuffer to Buffer and publishes', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockPreFlightOk();
      mockPublishData.mockResolvedValue({
        reference: 'ghi789',
        bzzUrl: 'bzz://ghi789',
        tagUid: null,
        batchIdUsed: 'batch3',
      });

      const ab = new ArrayBuffer(4);
      new Uint8Array(ab).set([0x47, 0x49, 0x46, 0x38]); // GIF header
      const result = await invokeProvider('swarm_publishData', {
        data: ab,
        contentType: 'image/gif',
      }, 'myapp.eth');

      expect(result.result).toEqual({ reference: 'ghi789', bzzUrl: 'bzz://ghi789' });
      // Should arrive as Buffer (normalized from ArrayBuffer)
      const calledData = mockPublishData.mock.calls[0][0];
      expect(Buffer.isBuffer(calledData)).toBe(true);
      expect(calledData.length).toBe(4);
    });

    test('rejects non-string non-buffer data', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      const result = await invokeProvider('swarm_publishData', {
        data: 12345,
        contentType: 'text/plain',
      }, 'myapp.eth');

      expect(result.error.code).toBe(-32602);
      expect(result.error.message).toContain('string, Uint8Array, or ArrayBuffer');
    });

    test('returns -32602 when contentType is missing', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      const result = await invokeProvider('swarm_publishData', {
        data: 'Hello',
      }, 'myapp.eth');

      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('missing_content_type');
    });

    test('returns -32602 when data is missing', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      const result = await invokeProvider('swarm_publishData', {
        contentType: 'text/plain',
      }, 'myapp.eth');

      expect(result.error.code).toBe(-32602);
    });

    test('returns -32602 when params is null', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      const result = await invokeProvider('swarm_publishData', null, 'myapp.eth');

      expect(result.error.code).toBe(-32602);
    });

    test('returns -32602 payload_too_large when data exceeds limit', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      const bigData = 'x'.repeat(LIMITS.maxDataBytes + 1); // exactly 1 byte over
      const result = await invokeProvider('swarm_publishData', {
        data: bigData,
        contentType: 'text/plain',
      }, 'myapp.eth');

      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('payload_too_large');
      expect(result.error.data.limit).toBe(LIMITS.maxDataBytes);
    });

    test('returns 4900 when node is stopped', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockGetBeeApiUrl.mockReturnValue(null);

      const result = await invokeProvider('swarm_publishData', {
        data: 'Hello',
        contentType: 'text/plain',
      }, 'myapp.eth');

      expect(result.error.code).toBe(4900);
    });

    test('returns 4100 without permission', async () => {
      mockGetPermission.mockReturnValue(null);
      const result = await invokeProvider('swarm_publishData', {
        data: 'Hello',
        contentType: 'text/plain',
      }, 'unauthorized.eth');

      expect(result.error.code).toBe(4100);
      expect(result.error.message).toBe('The origin is not authorized for this operation');
      expect(result.error.data.reason).toBe('not_connected');
    });

    test('records failed history on publish error', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockPreFlightOk();
      mockPublishData.mockRejectedValue(new Error('Bee upload failed'));

      const result = await invokeProvider('swarm_publishData', {
        data: 'Hello',
        contentType: 'text/plain',
      }, 'myapp.eth');

      expect(result.error.code).toBe(-32603);
      expect(mockUpdateEntry).toHaveBeenCalledWith('test-id', {
        status: 'failed',
        errorMessage: 'Bee upload failed',
      });
    });
  });

  describe('swarm_publishFiles', () => {
    function mockPreFlightOk() {
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ beeMode: 'light' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ready' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ stamps: [{ usable: true }] }) });
    }

    function makeFiles(paths) {
      return paths.map((p) => ({ path: p, bytes: Buffer.from('content') }));
    }

    test('publishes files and returns reference + bzzUrl + tagUid', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockPreFlightOk();
      mockPublishFilesFromContent.mockResolvedValue({
        reference: 'site123',
        bzzUrl: 'bzz://site123',
        tagUid: 42,
        batchIdUsed: 'batch1',
      });

      const result = await invokeProvider('swarm_publishFiles', {
        files: makeFiles(['index.html', 'style.css']),
        indexDocument: 'index.html',
      }, 'myapp.eth');

      expect(result.result).toEqual({ reference: 'site123', bzzUrl: 'bzz://site123', tagUid: 42 });
      expect(mockPublishFilesFromContent).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ path: 'index.html' }),
          expect.objectContaining({ path: 'style.css' }),
        ]),
        { indexDocument: 'index.html' }
      );
    });

    test('rejects empty files array', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      const result = await invokeProvider('swarm_publishFiles', { files: [] }, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('empty_files');
    });

    test('rejects too many files', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      const files = Array.from({ length: 101 }, (_, i) => ({ path: `file${i}.txt`, bytes: Buffer.from('x') }));
      const result = await invokeProvider('swarm_publishFiles', { files }, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('too_many_files');
    });

    test('rejects duplicate paths', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      const result = await invokeProvider('swarm_publishFiles', {
        files: makeFiles(['index.html', 'index.html']),
      }, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('duplicate_path');
    });

    test('rejects total size exceeding limit', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      const bigFile = { path: 'big.bin', bytes: Buffer.alloc(LIMITS.maxFilesBytes + 1) };
      const result = await invokeProvider('swarm_publishFiles', { files: [bigFile] }, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('payload_too_large');
    });

    test('rejects invalid indexDocument', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      const result = await invokeProvider('swarm_publishFiles', {
        files: makeFiles(['page.html']),
        indexDocument: 'nonexistent.html',
      }, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('invalid_index_document');
    });

    test('rejects without permission', async () => {
      mockGetPermission.mockReturnValue(null);
      const result = await invokeProvider('swarm_publishFiles', {
        files: makeFiles(['index.html']),
      }, 'unauthorized.eth');
      expect(result.error.code).toBe(4100);
    });

    test('rejects when node is stopped', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockGetBeeApiUrl.mockReturnValue(null);
      const result = await invokeProvider('swarm_publishFiles', {
        files: makeFiles(['index.html']),
      }, 'myapp.eth');
      expect(result.error.code).toBe(4900);
    });

    test('records failed history on publish error', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockPreFlightOk();
      mockPublishFilesFromContent.mockRejectedValue(new Error('Upload failed'));

      const result = await invokeProvider('swarm_publishFiles', {
        files: makeFiles(['index.html']),
      }, 'myapp.eth');
      expect(result.error.code).toBe(-32603);
      expect(mockUpdateEntry).toHaveBeenCalledWith('test-id', {
        status: 'failed',
        errorMessage: 'Upload failed',
      });
    });
  });

  describe('validateVirtualPath', () => {
    test('accepts valid paths', () => {
      expect(validateVirtualPath('index.html').valid).toBe(true);
      expect(validateVirtualPath('assets/style.css').valid).toBe(true);
      expect(validateVirtualPath('deep/nested/path/file.txt').valid).toBe(true);
    });

    test('rejects backslashes', () => {
      expect(validateVirtualPath('path\\file.txt').valid).toBe(false);
    });

    test('rejects .. segments', () => {
      expect(validateVirtualPath('../etc/passwd').valid).toBe(false);
      expect(validateVirtualPath('assets/../secret').valid).toBe(false);
    });

    test('rejects . segments', () => {
      expect(validateVirtualPath('./file.txt').valid).toBe(false);
    });

    test('rejects leading slash', () => {
      expect(validateVirtualPath('/index.html').valid).toBe(false);
    });

    test('rejects empty segments', () => {
      expect(validateVirtualPath('foo//bar.txt').valid).toBe(false);
    });

    test('rejects empty string', () => {
      expect(validateVirtualPath('').valid).toBe(false);
    });

    test('rejects path over maxPathBytes UTF-8 bytes', () => {
      expect(validateVirtualPath('a'.repeat(LIMITS.maxPathBytes + 1)).valid).toBe(false);
      expect(validateVirtualPath('é'.repeat(51)).valid).toBe(false);
    });

    test('rejects null bytes', () => {
      expect(validateVirtualPath('file\x00.txt').valid).toBe(false);
    });

    test('rejects control characters', () => {
      expect(validateVirtualPath('file\x01.txt').valid).toBe(false);
    });
  });

  describe('normalizeBytes via publishFiles', () => {
    function mockPreFlightOk() {
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ beeMode: 'light' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ready' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ stamps: [{ usable: true }] }) });
    }

    test('normalizes JSON-serialized Buffer bytes', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockPreFlightOk();
      mockPublishFilesFromContent.mockResolvedValue({
        reference: 'r1', bzzUrl: 'bzz://r1', tagUid: 1, batchIdUsed: 'b1',
      });

      await invokeProvider('swarm_publishFiles', {
        files: [{ path: 'test.txt', bytes: { type: 'Buffer', data: [104, 105] } }],
      }, 'myapp.eth');

      const calledFiles = mockPublishFilesFromContent.mock.calls[0][0];
      expect(Buffer.isBuffer(calledFiles[0].bytes)).toBe(true);
      expect(calledFiles[0].bytes.toString()).toBe('hi');
    });
  });

  describe('swarm_getUploadStatus', () => {
    beforeEach(() => {
      clearTagOwnership();
    });

    test('returns status for owned tag', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ beeMode: 'light' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ready' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ stamps: [{ usable: true }] }) });
      mockPublishFilesFromContent.mockResolvedValue({
        reference: 'ref1', bzzUrl: 'bzz://ref1', tagUid: 99, batchIdUsed: 'b1',
      });

      // First publish to create tag ownership
      await invokeProvider('swarm_publishFiles', {
        files: [{ path: 'test.txt', bytes: Buffer.from('hi') }],
      }, 'myapp.eth');

      // Now query status
      mockGetUploadStatus.mockResolvedValue({
        tagUid: 99, split: 10, sent: 5, progress: 50, done: false,
      });
      const result = await invokeProvider('swarm_getUploadStatus', { tagUid: 99 }, 'myapp.eth');
      expect(result.result).toEqual({ tagUid: 99, split: 10, sent: 5, progress: 50, done: false });
    });

    test('rejects unowned tag', async () => {
      mockGetPermission.mockReturnValue({ origin: 'other.eth' });
      const result = await invokeProvider('swarm_getUploadStatus', { tagUid: 99 }, 'other.eth');
      expect(result.error.code).toBe(4100);
      expect(result.error.message).toBe('The origin is not authorized for this operation');
      expect(result.error.data.reason).toBe('tag_ownership_mismatch');
    });

    test('rejects invalid tagUid', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      const result = await invokeProvider('swarm_getUploadStatus', { tagUid: 'abc' }, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
    });

    test('rejects negative tagUid', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      const result = await invokeProvider('swarm_getUploadStatus', { tagUid: -1 }, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
    });
  });

  describe('chunk methods', () => {
    const VALID_REF = 'aa'.repeat(32);
    const VALID_IDENTIFIER = 'bb'.repeat(32);
    const VALID_OWNER = '0x' + 'cd'.repeat(20);

    function mockPreFlightOk() {
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ beeMode: 'light' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ready' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ stamps: [{ usable: true }] }) });
    }

    function mockReachable() {
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ beeMode: 'light' }) });
    }

    function mockFeedCapability(origin, mode = 'app-scoped', keyIndex = 0) {
      mockGetPermission.mockReturnValue({ origin, connectedAt: 1, lastUsed: 1, autoApprove: { publish: false, feeds: false } });
      mockHasFeedGrant.mockReturnValue(true);
      mockGetOriginEntry.mockReturnValue({
        identityMode: mode,
        publisherKeyIndex: keyIndex,
        feeds: {},
      });
    }

    test('publishes a CAC chunk and records history', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockPreFlightOk();
      mockPublishChunk.mockResolvedValue({ reference: VALID_REF, batchIdUsed: 'batch1' });

      const result = await invokeProvider('swarm_publishChunk', { data: 'hello' }, 'myapp.eth');

      expect(result.result).toEqual({ reference: VALID_REF });
      expect(mockPublishChunk).toHaveBeenCalledWith(Buffer.from('hello'), { span: undefined });
      expect(mockAddEntry).toHaveBeenCalledWith(expect.objectContaining({
        type: 'chunk',
        name: 'CAC chunk',
        bytesSize: 5,
      }));
      expect(mockUpdateEntry).toHaveBeenCalledWith('test-id', expect.objectContaining({
        status: 'completed',
        reference: VALID_REF,
      }));
    });

    test('rejects empty chunk payload before publishing', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });

      const result = await invokeProvider('swarm_publishChunk', { data: '' }, 'myapp.eth');

      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('invalid_params');
      expect(mockPublishChunk).not.toHaveBeenCalled();
    });

    test('rejects oversized chunk payload', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });

      const result = await invokeProvider('swarm_publishChunk', {
        data: Buffer.alloc(LIMITS.maxChunkPayloadBytes + 1),
      }, 'myapp.eth');

      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('payload_too_large');
    });

    test('rejects unsafe numeric span', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });

      const result = await invokeProvider('swarm_publishChunk', {
        data: 'hello',
        span: Number.MAX_SAFE_INTEGER + 1,
      }, 'myapp.eth');

      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('invalid_span');
    });

    test('rejects unsupported chunk options', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });

      const result = await invokeProvider('swarm_publishChunk', {
        data: 'hello',
        options: { deferred: true },
      }, 'myapp.eth');

      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('unsupported_option');
    });

    test('reads CAC chunks without connection permission', async () => {
      mockGetPermission.mockReturnValue(null);
      mockReachable();
      mockReadChunk.mockResolvedValue({
        data: Buffer.from('hello').toString('base64'),
        encoding: 'base64',
        span: 5,
      });

      const result = await invokeProvider('swarm_readChunk', { reference: VALID_REF }, 'unknown.eth');

      expect(result.result).toEqual({
        data: Buffer.from('hello').toString('base64'),
        encoding: 'base64',
        span: 5,
      });
      expect(mockReadChunk).toHaveBeenCalledWith(VALID_REF);
    });

    test('maps read chunk type mismatch', async () => {
      mockGetPermission.mockReturnValue(null);
      mockReachable();
      const err = new Error('wrong type');
      err.reason = 'chunk_type_mismatch';
      mockReadChunk.mockRejectedValue(err);

      const result = await invokeProvider('swarm_readChunk', { reference: VALID_REF }, 'unknown.eth');

      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('chunk_type_mismatch');
    });

    test('keeps transient chunk read errors internal', async () => {
      mockGetPermission.mockReturnValue(null);
      mockReachable();
      mockReadChunk.mockRejectedValue(new Error('Bee gateway timed out'));

      const result = await invokeProvider('swarm_readChunk', { reference: VALID_REF }, 'unknown.eth');

      expect(result.error.code).toBe(-32603);
      expect(result.error.message).toBe('Bee gateway timed out');
    });

    test('rejects invalid chunk reference', async () => {
      mockGetPermission.mockReturnValue(null);

      const result = await invokeProvider('swarm_readChunk', { reference: 'not-hex' }, 'unknown.eth');

      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('invalid_reference');
    });

    test('writes an SOC with feed signing identity', async () => {
      mockFeedCapability('myapp.eth');
      mockPreFlightOk();
      mockGetPublisherKey.mockResolvedValue({ privateKey: '0xkey' });
      mockWriteSingleOwnerChunk.mockResolvedValue({
        reference: VALID_REF,
        owner: VALID_OWNER,
        identifier: VALID_IDENTIFIER,
        batchIdUsed: 'batch1',
      });

      const result = await invokeProvider('swarm_writeSingleOwnerChunk', {
        identifier: VALID_IDENTIFIER,
        data: 'hello',
      }, 'myapp.eth');

      expect(result.result).toEqual({
        reference: VALID_REF,
        owner: VALID_OWNER,
        identifier: VALID_IDENTIFIER,
      });
      expect(mockWriteSingleOwnerChunk).toHaveBeenCalledWith('0xkey', VALID_IDENTIFIER, Buffer.from('hello'), { span: undefined });
      expect(mockAddEntry).toHaveBeenCalledWith(expect.objectContaining({
        type: 'soc',
        name: 'SOC chunk',
        bytesSize: 5,
      }));
    });

    test('writes an SOC with a browser wallet identity', async () => {
      mockV2FeedCapability('myapp.eth', 'ethereum-wallet:2');
      mockPreFlightOk();
      mockGetUserWalletKey.mockResolvedValue({ privateKey: '0xwalletkey' });
      mockWriteSingleOwnerChunk.mockResolvedValue({
        reference: VALID_REF,
        owner: VALID_OWNER,
        identifier: VALID_IDENTIFIER,
        batchIdUsed: 'batch1',
      });

      const result = await invokeProvider('swarm_writeSingleOwnerChunk', {
        identifier: VALID_IDENTIFIER,
        data: 'hello',
      }, 'myapp.eth');

      expect(result.result.owner).toBe(VALID_OWNER);
      expect(mockGetUserWalletKey).toHaveBeenCalledWith(2);
      expect(mockWriteSingleOwnerChunk).toHaveBeenCalledWith('0xwalletkey', VALID_IDENTIFIER, Buffer.from('hello'), { span: undefined });
    });

    test('rejects SOC writes without feed grant', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockHasFeedGrant.mockReturnValue(false);

      const result = await invokeProvider('swarm_writeSingleOwnerChunk', {
        identifier: VALID_IDENTIFIER,
        data: 'hello',
      }, 'myapp.eth');

      expect(result.error.code).toBe(4100);
      expect(result.error.message).toBe('The origin is not authorized for this operation');
      expect(result.error.data.reason).toBe('feed_not_granted');
    });

    test('reads SOC chunks by owner and identifier without connection permission', async () => {
      mockGetPermission.mockReturnValue(null);
      mockReachable();
      mockReadSingleOwnerChunk.mockResolvedValue({
        data: Buffer.from('hello').toString('base64'),
        encoding: 'base64',
        span: 5,
        reference: VALID_REF,
        owner: VALID_OWNER,
        identifier: VALID_IDENTIFIER,
        signature: 'ee'.repeat(65),
      });

      const result = await invokeProvider('swarm_readSingleOwnerChunk', {
        owner: VALID_OWNER,
        identifier: VALID_IDENTIFIER,
      }, 'unknown.eth');

      expect(result.result.reference).toBe(VALID_REF);
      expect(mockReadSingleOwnerChunk).toHaveBeenCalledWith({
        owner: VALID_OWNER,
        identifier: VALID_IDENTIFIER,
      });
    });

    test('rejects malformed SOC read coordinates', async () => {
      mockGetPermission.mockReturnValue(null);

      const result = await invokeProvider('swarm_readSingleOwnerChunk', {
        owner: VALID_OWNER,
      }, 'unknown.eth');

      expect(result.error.code).toBe(-32602);
    });

    test('returns signing identity after feed grant', async () => {
      mockFeedCapability('myapp.eth', 'bee-wallet');
      mockGetDerivedKeys.mockReturnValue({ beeWallet: { privateKey: '0xbeekey' } });
      mockGetSignerAddress.mockReturnValue(VALID_OWNER);

      const result = await invokeProvider('swarm_getSigningIdentity', {}, 'myapp.eth');

      expect(result.result).toEqual({
        owner: VALID_OWNER,
        identityMode: 'bee-wallet',
      });
      expect(mockGetSignerAddress).toHaveBeenCalledWith('0xbeekey');
    });

    test('returns signing identity for browser wallet identities', async () => {
      mockV2FeedCapability('myapp.eth', 'ethereum-wallet:2');
      mockGetUserWalletKey.mockResolvedValue({ privateKey: '0xwalletkey' });
      mockGetSignerAddress.mockReturnValue(VALID_OWNER);

      const result = await invokeProvider('swarm_getSigningIdentity', {}, 'myapp.eth');

      expect(result.result).toEqual({
        owner: VALID_OWNER,
        identityMode: 'ethereum-wallet',
      });
      expect(mockGetUserWalletKey).toHaveBeenCalledWith(2);
      expect(mockGetSignerAddress).toHaveBeenCalledWith('0xwalletkey');
    });

    test('rejects signing identity without feed grant using spec-shaped 4100', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockHasFeedGrant.mockReturnValue(false);

      const result = await invokeProvider('swarm_getSigningIdentity', {}, 'myapp.eth');

      expect(result.error.code).toBe(4100);
      expect(result.error.message).toBe('The origin is not authorized for this operation');
      expect(result.error.data.reason).toBe('feed_not_granted');
    });
  });

  describe('checkSwarmPreFlight', () => {
    test('returns ok when all checks pass', async () => {
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ beeMode: 'light' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ready' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ stamps: [{ usable: true }] }) });

      const result = await checkSwarmPreFlight();
      expect(result).toEqual({ ok: true });
    });

    test('returns node-stopped when no Bee URL', async () => {
      mockGetBeeApiUrl.mockReturnValue(null);
      const result = await checkSwarmPreFlight();
      expect(result).toEqual({ ok: false, reason: 'node-stopped' });
    });

    test('handles fetch errors gracefully', async () => {
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch.mockRejectedValue(new Error('ECONNREFUSED'));
      const result = await checkSwarmPreFlight();
      expect(result).toEqual({ ok: false, reason: 'node-stopped' });
    });
  });

  describe('validateFeedName', () => {
    test('accepts valid names', () => {
      expect(validateFeedName('blog').valid).toBe(true);
      expect(validateFeedName('my-feed').valid).toBe(true);
      expect(validateFeedName('feed_123').valid).toBe(true);
    });

    test('rejects empty string', () => {
      expect(validateFeedName('').valid).toBe(false);
    });

    test('rejects non-string', () => {
      expect(validateFeedName(123).valid).toBe(false);
      expect(validateFeedName(null).valid).toBe(false);
    });

    test('rejects names longer than 64 chars', () => {
      expect(validateFeedName('a'.repeat(65)).valid).toBe(false);
      expect(validateFeedName('a'.repeat(64)).valid).toBe(true);
    });

    test('rejects names containing /', () => {
      expect(validateFeedName('path/name').valid).toBe(false);
    });

    test('rejects names containing control characters', () => {
      expect(validateFeedName('feed\x00name').valid).toBe(false);
      expect(validateFeedName('feed\nname').valid).toBe(false);
    });
  });

  describe('swarm_createFeed', () => {
    function mockPreFlightOk() {
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ beeMode: 'light' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ready' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ stamps: [{ usable: true }] }) });
    }

    function mockFeedCapability(origin, mode = 'app-scoped', keyIndex = 0) {
      mockGetPermission.mockReturnValue({ origin, connectedAt: 1, lastUsed: 1, autoApprove: { publish: false, feeds: false } });
      mockHasFeedGrant.mockReturnValue(true);
      mockGetOriginEntry.mockReturnValue({
        identityMode: mode,
        publisherKeyIndex: keyIndex,
        feeds: {},
      });
    }

    test('rejects missing name', async () => {
      const result = await invokeProvider('swarm_createFeed', {}, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('invalid_feed_name');
    });

    test('rejects name too long', async () => {
      const result = await invokeProvider('swarm_createFeed', { name: 'a'.repeat(65) }, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('invalid_feed_name');
    });

    test('rejects name with /', async () => {
      const result = await invokeProvider('swarm_createFeed', { name: 'bad/name' }, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('invalid_feed_name');
    });

    test('rejects without connection permission', async () => {
      mockGetPermission.mockReturnValue(null);
      const result = await invokeProvider('swarm_createFeed', { name: 'blog' }, 'myapp.eth');
      expect(result.error.code).toBe(4100);
      expect(result.error.data.reason).toBe('not_connected');
    });

    test('rejects without feed capability (connected but no feed grant)', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockHasFeedGrant.mockReturnValue(false);
      const result = await invokeProvider('swarm_createFeed', { name: 'blog' }, 'myapp.eth');
      expect(result.error.code).toBe(4100);
      expect(result.error.message).toBe('The origin is not authorized for this operation');
      expect(result.error.data.reason).toBe('feed_not_granted');
    });

    test('returns existing feed when idempotent', async () => {
      mockFeedCapability('myapp.eth');
      mockGetFeed.mockReturnValue({
        topic: 'aaa',
        owner: '0xBBB',
        manifestReference: 'ccc',
        createdAt: 1000,
      });

      const result = await invokeProvider('swarm_createFeed', { name: 'blog' }, 'myapp.eth');
      expect(result.result.feedId).toBe('blog');
      expect(result.result.owner).toBe('0xBBB');
      expect(result.result.manifestReference).toBe('ccc');
      expect(result.result.bzzUrl).toBe('bzz://ccc');
      expect(result.result.identityMode).toBe('app-scoped');
      // Should NOT call createFeed
      expect(mockCreateFeed).not.toHaveBeenCalled();
    });

    test('returns 4900 when node is stopped', async () => {
      mockFeedCapability('myapp.eth');
      mockGetFeed.mockReturnValue(null);
      mockGetBeeApiUrl.mockReturnValue(null);

      const result = await invokeProvider('swarm_createFeed', { name: 'blog' }, 'myapp.eth');
      expect(result.error.code).toBe(4900);
    });

    test('creates feed successfully with app-scoped identity', async () => {
      mockFeedCapability('myapp.eth', 'app-scoped', 0);
      mockGetFeed.mockReturnValue(null);
      mockPreFlightOk();
      mockGetPublisherKey.mockResolvedValue({ privateKey: '0xpublisherkey' });
      mockCreateFeed.mockResolvedValue({
        topic: 'topichex',
        owner: '0xOwnerAddr',
        manifestReference: 'manifesthex',
        bzzUrl: 'bzz://manifesthex',
      });

      const result = await invokeProvider('swarm_createFeed', { name: 'blog' }, 'myapp.eth');

      expect(result.result.feedId).toBe('blog');
      expect(result.result.owner).toBe('0xOwnerAddr');
      expect(result.result.bzzUrl).toBe('bzz://manifesthex');
      expect(result.result.identityMode).toBe('app-scoped');
      expect(mockCreateFeed).toHaveBeenCalledWith('0xpublisherkey', 'myapp.eth/blog');
      expect(mockSetFeed).toHaveBeenCalledWith('myapp.eth', 'blog', expect.objectContaining({
        topic: 'topichex',
        owner: '0xOwnerAddr',
      }));
    });

    test('creates feed with bee-wallet identity', async () => {
      mockFeedCapability('myapp.eth', 'bee-wallet');
      mockGetFeed.mockReturnValue(null);
      mockPreFlightOk();
      mockGetDerivedKeys.mockReturnValue({ beeWallet: { privateKey: '0xbeekey' } });
      mockCreateFeed.mockResolvedValue({
        topic: 'topichex',
        owner: '0xBeeOwner',
        manifestReference: 'mref',
        bzzUrl: 'bzz://mref',
      });

      const result = await invokeProvider('swarm_createFeed', { name: 'blog' }, 'myapp.eth');

      expect(result.result.identityMode).toBe('bee-wallet');
      expect(mockCreateFeed).toHaveBeenCalledWith('0xbeekey', 'myapp.eth/blog');
      expect(mockGetPublisherKey).not.toHaveBeenCalled();
    });

    test('creates feed with browser wallet identity', async () => {
      mockV2FeedCapability('myapp.eth', 'ethereum-wallet:2');
      mockGetFeed.mockReturnValue(null);
      mockPreFlightOk();
      mockGetUserWalletKey.mockResolvedValue({ privateKey: '0xwalletkey' });
      mockCreateFeed.mockResolvedValue({
        topic: 'topichex',
        owner: '0xWalletOwner',
        manifestReference: 'mref',
        bzzUrl: 'bzz://mref',
      });

      const result = await invokeProvider('swarm_createFeed', { name: 'blog' }, 'myapp.eth');

      expect(result.result.identityMode).toBe('ethereum-wallet');
      expect(mockGetUserWalletKey).toHaveBeenCalledWith(2);
      expect(mockCreateFeed).toHaveBeenCalledWith('0xwalletkey', 'myapp.eth/blog');
      expect(mockSetFeed).toHaveBeenCalledWith('myapp.eth', 'blog', expect.objectContaining({
        identityId: 'ethereum-wallet:2',
      }));
    });

    test('records publish history on success', async () => {
      mockFeedCapability('myapp.eth');
      mockGetFeed.mockReturnValue(null);
      mockPreFlightOk();
      mockGetPublisherKey.mockResolvedValue({ privateKey: '0xkey' });
      mockCreateFeed.mockResolvedValue({
        topic: 't', owner: 'o', manifestReference: 'm', bzzUrl: 'bzz://m',
      });

      await invokeProvider('swarm_createFeed', { name: 'blog' }, 'myapp.eth');

      expect(mockAddEntry).toHaveBeenCalledWith(expect.objectContaining({
        type: 'feed-create',
        name: 'blog',
        status: 'uploading',
      }));
      expect(mockUpdateEntry).toHaveBeenCalledWith('test-id', expect.objectContaining({
        status: 'completed',
      }));
    });

    test('records failure in publish history', async () => {
      mockFeedCapability('myapp.eth');
      mockGetFeed.mockReturnValue(null);
      mockPreFlightOk();
      mockGetPublisherKey.mockResolvedValue({ privateKey: '0xkey' });
      mockCreateFeed.mockRejectedValue(new Error('bee error'));

      const result = await invokeProvider('swarm_createFeed', { name: 'blog' }, 'myapp.eth');

      expect(result.error.code).toBe(-32603);
      expect(mockUpdateEntry).toHaveBeenCalledWith('test-id', {
        status: 'failed',
        errorMessage: 'bee error',
      });
    });
  });

  describe('swarm_updateFeed', () => {
    const VALID_REF = 'aa'.repeat(32);

    function mockPreFlightOk() {
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ beeMode: 'light' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ready' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ stamps: [{ usable: true }] }) });
    }

    function mockFeedCapability(origin, mode = 'app-scoped', keyIndex = 0) {
      mockGetPermission.mockReturnValue({ origin, connectedAt: 1, lastUsed: 1, autoApprove: { publish: false, feeds: false } });
      mockHasFeedGrant.mockReturnValue(true);
      mockGetOriginEntry.mockReturnValue({
        identityMode: mode,
        publisherKeyIndex: keyIndex,
        feeds: {},
      });
    }

    test('rejects missing feedId', async () => {
      const result = await invokeProvider('swarm_updateFeed', { reference: VALID_REF }, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
    });

    test('rejects missing reference', async () => {
      const result = await invokeProvider('swarm_updateFeed', { feedId: 'blog' }, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('invalid_reference');
    });

    test('rejects invalid reference format', async () => {
      const result = await invokeProvider('swarm_updateFeed', { feedId: 'blog', reference: 'not-hex' }, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('invalid_reference');
    });

    test('rejects without feed capability', async () => {
      mockGetPermission.mockReturnValue(null);
      const result = await invokeProvider('swarm_updateFeed', { feedId: 'blog', reference: VALID_REF }, 'myapp.eth');
      expect(result.error.code).toBe(4100);
    });

    test('rejects when feed not found', async () => {
      mockFeedCapability('myapp.eth');
      mockGetFeed.mockReturnValue(null);
      const result = await invokeProvider('swarm_updateFeed', { feedId: 'nonexistent', reference: VALID_REF }, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('feed_not_found');
    });

    test('updates feed successfully and returns index', async () => {
      mockFeedCapability('myapp.eth', 'app-scoped', 0);
      mockGetFeed.mockReturnValue({
        topic: 'topichex',
        owner: '0xOwner',
        manifestReference: 'mref',
      });
      mockPreFlightOk();
      mockGetPublisherKey.mockResolvedValue({ privateKey: '0xpubkey' });
      mockUpdateFeed.mockResolvedValue({ index: 7 });

      const result = await invokeProvider('swarm_updateFeed', { feedId: 'blog', reference: VALID_REF }, 'myapp.eth');

      expect(result.result.feedId).toBe('blog');
      expect(result.result.reference).toBe(VALID_REF);
      expect(result.result.bzzUrl).toBe('bzz://mref');
      expect(result.result.index).toBe(7);
      expect(mockUpdateFeed).toHaveBeenCalledWith('0xpubkey', 'myapp.eth/blog', VALID_REF);
      expect(mockUpdateFeedReference).toHaveBeenCalledWith('myapp.eth', 'blog', VALID_REF);
    });

    test('updates feed with the identity that created it', async () => {
      mockV2FeedCapability('myapp.eth', 'app-scoped:2');
      mockGetFeed.mockReturnValue({
        topic: 'topichex',
        owner: '0xOwner',
        manifestReference: 'mref',
        identityId: 'app-scoped:1',
      });
      mockPreFlightOk();
      mockGetPublisherKey.mockImplementation(async (index) => ({ privateKey: `0xpubkey${index}` }));
      mockUpdateFeed.mockResolvedValue({ index: 8 });

      const result = await invokeProvider('swarm_updateFeed', { feedId: 'blog', reference: VALID_REF }, 'myapp.eth');

      expect(result.result.index).toBe(8);
      expect(mockGetPublisherKey).toHaveBeenCalledWith(1);
      expect(mockUpdateFeed).toHaveBeenCalledWith('0xpubkey1', 'myapp.eth/blog', VALID_REF);
    });

    test('records publish history as feed-update', async () => {
      mockFeedCapability('myapp.eth');
      mockGetFeed.mockReturnValue({ topic: 't', owner: 'o', manifestReference: 'm' });
      mockPreFlightOk();
      mockGetPublisherKey.mockResolvedValue({ privateKey: '0xkey' });
      mockUpdateFeed.mockResolvedValue({ index: 0 });

      await invokeProvider('swarm_updateFeed', { feedId: 'blog', reference: VALID_REF }, 'myapp.eth');

      expect(mockAddEntry).toHaveBeenCalledWith(expect.objectContaining({
        type: 'feed-update',
        name: 'blog',
      }));
      expect(mockUpdateEntry).toHaveBeenCalledWith('test-id', expect.objectContaining({
        status: 'completed',
      }));
    });

    test('records failure in publish history', async () => {
      mockFeedCapability('myapp.eth');
      mockGetFeed.mockReturnValue({ topic: 't', owner: 'o', manifestReference: 'm' });
      mockPreFlightOk();
      mockGetPublisherKey.mockResolvedValue({ privateKey: '0xkey' });
      mockUpdateFeed.mockRejectedValue(new Error('network error'));

      const result = await invokeProvider('swarm_updateFeed', { feedId: 'blog', reference: VALID_REF }, 'myapp.eth');

      expect(result.error.code).toBe(-32603);
      expect(mockUpdateEntry).toHaveBeenCalledWith('test-id', {
        status: 'failed',
        errorMessage: 'network error',
      });
    });
  });

  describe('swarm_writeFeedEntry', () => {
    function mockPreFlightOk() {
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ beeMode: 'light' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ready' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ stamps: [{ usable: true }] }) });
    }

    function mockFeedCapability(origin, mode = 'app-scoped', keyIndex = 0) {
      mockGetPermission.mockReturnValue({ origin, connectedAt: 1, lastUsed: 1, autoApprove: { publish: false, feeds: false } });
      mockHasFeedGrant.mockReturnValue(true);
      mockGetOriginEntry.mockReturnValue({
        identityMode: mode,
        publisherKeyIndex: keyIndex,
        feeds: {},
      });
    }

    test('rejects missing params', async () => {
      const result = await invokeProvider('swarm_writeFeedEntry', null, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
    });

    test('rejects missing name', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      const result = await invokeProvider('swarm_writeFeedEntry', { data: 'hello' }, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
    });

    test('rejects missing data', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      const result = await invokeProvider('swarm_writeFeedEntry', { name: 'feed' }, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
    });

    test('rejects invalid index (negative)', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      const result = await invokeProvider('swarm_writeFeedEntry', { name: 'feed', data: 'hello', index: -1 }, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
    });

    test('rejects invalid index (non-integer)', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      const result = await invokeProvider('swarm_writeFeedEntry', { name: 'feed', data: 'hello', index: 1.5 }, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
    });

    test('rejects without permission', async () => {
      mockGetPermission.mockReturnValue(null);
      const result = await invokeProvider('swarm_writeFeedEntry', { name: 'feed', data: 'hello' }, 'myapp.eth');
      expect(result.error.code).toBe(4100);
    });

    test('rejects without feed grant', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockHasFeedGrant.mockReturnValue(false);
      const result = await invokeProvider('swarm_writeFeedEntry', { name: 'feed', data: 'hello' }, 'myapp.eth');
      expect(result.error.code).toBe(4100);
      expect(result.error.message).toBe('The origin is not authorized for this operation');
      expect(result.error.data.reason).toBe('feed_not_granted');
    });

    test('rejects when feed does not exist', async () => {
      mockFeedCapability('myapp.eth');
      mockGetFeed.mockReturnValue(null);
      const result = await invokeProvider('swarm_writeFeedEntry', { name: 'nonexistent', data: 'hello' }, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('feed_not_found');
    });

    test('writes feed entry successfully', async () => {
      mockFeedCapability('myapp.eth');
      mockGetFeed.mockReturnValue({ topic: 't', owner: '0xOwner', manifestReference: 'm' });
      mockPreFlightOk();
      mockGetPublisherKey.mockResolvedValue({ privateKey: '0xkey' });
      mockWriteFeedPayload.mockResolvedValue({ index: 0 });

      const result = await invokeProvider('swarm_writeFeedEntry', { name: 'feed', data: 'hello' }, 'myapp.eth');

      expect(result.result).toEqual({ index: 0 });
      expect(mockWriteFeedPayload).toHaveBeenCalledWith('0xkey', 'myapp.eth/feed', 'hello', { index: undefined });
    });

    test('writes feed entry with the identity that created the feed', async () => {
      mockV2FeedCapability('myapp.eth', 'app-scoped:2');
      mockGetFeed.mockReturnValue({
        topic: 't',
        owner: '0xOwner',
        manifestReference: 'm',
        identityId: 'app-scoped:1',
      });
      mockPreFlightOk();
      mockGetPublisherKey.mockImplementation(async (index) => ({ privateKey: `0xkey${index}` }));
      mockWriteFeedPayload.mockResolvedValue({ index: 0 });

      const result = await invokeProvider('swarm_writeFeedEntry', { name: 'feed', data: 'hello' }, 'myapp.eth');

      expect(result.result).toEqual({ index: 0 });
      expect(mockGetPublisherKey).toHaveBeenCalledWith(1);
      expect(mockWriteFeedPayload).toHaveBeenCalledWith('0xkey1', 'myapp.eth/feed', 'hello', { index: undefined });
    });

    test('passes explicit index to writeFeedPayload', async () => {
      mockFeedCapability('myapp.eth');
      mockGetFeed.mockReturnValue({ topic: 't', owner: '0xOwner', manifestReference: 'm' });
      mockPreFlightOk();
      mockGetPublisherKey.mockResolvedValue({ privateKey: '0xkey' });
      mockWriteFeedPayload.mockResolvedValue({ index: 5 });

      const result = await invokeProvider('swarm_writeFeedEntry', { name: 'feed', data: 'hello', index: 5 }, 'myapp.eth');

      expect(result.result).toEqual({ index: 5 });
      expect(mockWriteFeedPayload).toHaveBeenCalledWith('0xkey', 'myapp.eth/feed', 'hello', { index: 5 });
    });

    test('records publish history on success', async () => {
      mockFeedCapability('myapp.eth');
      mockGetFeed.mockReturnValue({ topic: 't', owner: '0xOwner', manifestReference: 'm' });
      mockPreFlightOk();
      mockGetPublisherKey.mockResolvedValue({ privateKey: '0xkey' });
      mockWriteFeedPayload.mockResolvedValue({ index: 0 });

      await invokeProvider('swarm_writeFeedEntry', { name: 'feed', data: 'hello' }, 'myapp.eth');

      expect(mockAddEntry).toHaveBeenCalledWith(expect.objectContaining({
        type: 'feed-entry',
        name: 'feed',
        status: 'uploading',
      }));
      expect(mockUpdateEntry).toHaveBeenCalledWith('test-id', expect.objectContaining({ status: 'completed' }));
    });

    test('records failure in publish history', async () => {
      mockFeedCapability('myapp.eth');
      mockGetFeed.mockReturnValue({ topic: 't', owner: '0xOwner', manifestReference: 'm' });
      mockPreFlightOk();
      mockGetPublisherKey.mockResolvedValue({ privateKey: '0xkey' });
      mockWriteFeedPayload.mockRejectedValue(new Error('upload failed'));

      const result = await invokeProvider('swarm_writeFeedEntry', { name: 'feed', data: 'hello' }, 'myapp.eth');

      expect(result.error.code).toBe(-32603);
      expect(mockUpdateEntry).toHaveBeenCalledWith('test-id', {
        status: 'failed',
        errorMessage: 'upload failed',
      });
    });

    test('translates index_already_exists error', async () => {
      mockFeedCapability('myapp.eth');
      mockGetFeed.mockReturnValue({ topic: 't', owner: '0xOwner', manifestReference: 'm' });
      mockPreFlightOk();
      mockGetPublisherKey.mockResolvedValue({ privateKey: '0xkey' });
      const err = new Error('Feed entry already exists at index 0');
      err.reason = 'index_already_exists';
      mockWriteFeedPayload.mockRejectedValue(err);

      const result = await invokeProvider('swarm_writeFeedEntry', { name: 'feed', data: 'hello', index: 0 }, 'myapp.eth');

      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('index_already_exists');
    });

    test('translates payload too large error', async () => {
      mockFeedCapability('myapp.eth');
      mockGetFeed.mockReturnValue({ topic: 't', owner: '0xOwner', manifestReference: 'm' });
      mockPreFlightOk();
      mockGetPublisherKey.mockResolvedValue({ privateKey: '0xkey' });
      mockWriteFeedPayload.mockRejectedValue(new Error('chunk too large'));

      const result = await invokeProvider('swarm_writeFeedEntry', { name: 'feed', data: 'x'.repeat(10000) }, 'myapp.eth');

      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('payload_too_large');
    });

    test('accepts binary data', async () => {
      mockFeedCapability('myapp.eth');
      mockGetFeed.mockReturnValue({ topic: 't', owner: '0xOwner', manifestReference: 'm' });
      mockPreFlightOk();
      mockGetPublisherKey.mockResolvedValue({ privateKey: '0xkey' });
      mockWriteFeedPayload.mockResolvedValue({ index: 0 });

      const buf = Buffer.from([1, 2, 3]);
      const result = await invokeProvider('swarm_writeFeedEntry', { name: 'feed', data: buf }, 'myapp.eth');

      expect(result.result).toEqual({ index: 0 });
    });
  });

  describe('swarm_readFeedEntry', () => {
    const VALID_TOPIC = 'ab'.repeat(32);
    const VALID_OWNER = '0x' + 'cd'.repeat(20);

    test('rejects missing params', async () => {
      const result = await invokeProvider('swarm_readFeedEntry', null, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
    });

    test('rejects when both topic and name provided', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      const result = await invokeProvider('swarm_readFeedEntry', { topic: VALID_TOPIC, name: 'feed', owner: VALID_OWNER }, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
      expect(result.error.message).toContain('either topic or name');
    });

    test('rejects when neither topic nor name provided', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      const result = await invokeProvider('swarm_readFeedEntry', { owner: VALID_OWNER }, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
      expect(result.error.message).toContain('Either topic or name');
    });

    test('rejects invalid topic hex', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      const result = await invokeProvider('swarm_readFeedEntry', { topic: 'not-hex', owner: VALID_OWNER }, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('invalid_topic');
    });

    test('rejects missing owner with topic', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      const result = await invokeProvider('swarm_readFeedEntry', { topic: VALID_TOPIC }, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('invalid_owner');
    });

    test('rejects invalid owner address', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      const result = await invokeProvider('swarm_readFeedEntry', { topic: VALID_TOPIC, owner: 'bad' }, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('invalid_owner');
    });

    test('rejects invalid index', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      const result = await invokeProvider('swarm_readFeedEntry', { topic: VALID_TOPIC, owner: VALID_OWNER, index: -1 }, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
    });

    test('does NOT require connection permission (public data read)', async () => {
      // Feeds are public Swarm data — readable from any Bee gateway without
      // auth. Gating this behind requestAccess would force prompts for
      // passive use cases like viewing on-chain-discovered profile feeds.
      mockGetPermission.mockReturnValue(null);
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // /node
      mockReadFeedPayload.mockResolvedValue({
        payload: Buffer.from('public data'),
        index: 0,
        nextIndex: 1,
      });

      const result = await invokeProvider('swarm_readFeedEntry', { topic: VALID_TOPIC, owner: VALID_OWNER }, 'unknown.eth');

      expect(result.result).toBeDefined();
      expect(result.result.data).toBeTruthy();
      expect(result.error).toBeUndefined();
    });

    test('does NOT require feed grant', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockHasFeedGrant.mockReturnValue(false); // no feed grant
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // /node
      mockReadFeedPayload.mockResolvedValue({
        payload: Buffer.from('test data'),
        index: 0,
        nextIndex: 1,
      });

      const result = await invokeProvider('swarm_readFeedEntry', { topic: VALID_TOPIC, owner: VALID_OWNER }, 'myapp.eth');

      // Should succeed — no feed grant needed for reads
      expect(result.result).toBeDefined();
      expect(result.result.data).toBeTruthy();
    });

    test('reads entry with topic + owner and returns base64', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      mockReadFeedPayload.mockResolvedValue({
        payload: Buffer.from('hello world'),
        index: 3,
        nextIndex: 4,
      });

      const result = await invokeProvider('swarm_readFeedEntry', { topic: VALID_TOPIC, owner: VALID_OWNER }, 'myapp.eth');

      expect(result.result.data).toBe(Buffer.from('hello world').toString('base64'));
      expect(result.result.encoding).toBe('base64');
      expect(result.result.index).toBe(3);
      expect(result.result.nextIndex).toBe(4);
    });

    test('reads specific index', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      mockReadFeedPayload.mockResolvedValue({
        payload: Buffer.from('index 5 data'),
        index: 5,
        nextIndex: null,
      });

      const result = await invokeProvider('swarm_readFeedEntry', { topic: VALID_TOPIC, owner: VALID_OWNER, index: 5 }, 'myapp.eth');

      expect(result.result.index).toBe(5);
      expect(result.result.nextIndex).toBeNull();
      expect(mockReadFeedPayload).toHaveBeenCalledWith(
        'cd'.repeat(20),
        expect.any(MockTopic),
        5,
      );
    });

    test('reads with name and infers owner from feed store', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockGetFeed.mockReturnValue({ topic: 'topichex', owner: '0x' + 'ee'.repeat(20), manifestReference: 'm' });
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      mockReadFeedPayload.mockResolvedValue({
        payload: Buffer.from('my data'),
        index: 0,
        nextIndex: 1,
      });

      const result = await invokeProvider('swarm_readFeedEntry', { name: 'my-feed' }, 'myapp.eth');

      expect(result.result).toBeDefined();
      expect(mockReadFeedPayload).toHaveBeenCalledWith(
        'ee'.repeat(20),
        expect.any(MockTopic),
        undefined,
      );
    });

    test('rejects name without owner when feed not in store', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockGetFeed.mockReturnValue(null);
      const result = await invokeProvider('swarm_readFeedEntry', { name: 'nonexistent' }, 'myapp.eth');
      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('feed_not_found');
    });

    test('reads with name + explicit owner', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      mockReadFeedPayload.mockResolvedValue({
        payload: Buffer.from('other user data'),
        index: 10,
        nextIndex: 11,
      });

      const result = await invokeProvider('swarm_readFeedEntry', { name: 'feed', owner: VALID_OWNER }, 'myapp.eth');

      expect(result.result.index).toBe(10);
      // Should NOT have looked up feed store — owner was explicit
      expect(mockGetFeed).not.toHaveBeenCalled();
    });

    test('translates feed_empty error', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      const err = new Error('Feed is empty');
      err.reason = 'feed_empty';
      mockReadFeedPayload.mockRejectedValue(err);

      const result = await invokeProvider('swarm_readFeedEntry', { topic: VALID_TOPIC, owner: VALID_OWNER }, 'myapp.eth');

      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('feed_empty');
    });

    test('translates entry_not_found error', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      const err = new Error('Feed entry not found at index 99');
      err.reason = 'entry_not_found';
      mockReadFeedPayload.mockRejectedValue(err);

      const result = await invokeProvider('swarm_readFeedEntry', { topic: VALID_TOPIC, owner: VALID_OWNER, index: 99 }, 'myapp.eth');

      expect(result.error.code).toBe(-32602);
      expect(result.error.data.reason).toBe('entry_not_found');
    });

    test('returns NODE_UNAVAILABLE when Bee is not reachable', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockGetBeeApiUrl.mockReturnValue(null);

      const result = await invokeProvider('swarm_readFeedEntry', { topic: VALID_TOPIC, owner: VALID_OWNER }, 'myapp.eth');

      expect(result.error.code).toBe(4900);
    });

    test('uses checkBeeReachable (not full pre-flight)', async () => {
      mockGetPermission.mockReturnValue({ origin: 'myapp.eth' });
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      // Only mock /node — no /readiness or /stamps needed
      global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ beeMode: 'ultra-light' }) });
      mockReadFeedPayload.mockResolvedValue({
        payload: Buffer.from('data'),
        index: 0,
        nextIndex: 1,
      });

      const result = await invokeProvider('swarm_readFeedEntry', { topic: VALID_TOPIC, owner: VALID_OWNER }, 'myapp.eth');

      // Should succeed even on ultra-light mode — reads don't check mode
      expect(result.result).toBeDefined();
      // fetch should only have been called once (/node)
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkBeeReachable', () => {
    test('returns ok when /node responds', async () => {
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      const result = await checkBeeReachable();
      expect(result).toEqual({ ok: true });
    });

    test('returns not-ok when no Bee URL', async () => {
      mockGetBeeApiUrl.mockReturnValue(null);

      const result = await checkBeeReachable();
      expect(result).toEqual({ ok: false, reason: 'node-stopped' });
    });

    test('returns not-ok when /node returns error', async () => {
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch.mockResolvedValueOnce({ ok: false });

      const result = await checkBeeReachable();
      expect(result).toEqual({ ok: false, reason: 'node-stopped' });
    });

    test('returns not-ok when fetch throws', async () => {
      mockGetBeeApiUrl.mockReturnValue('http://127.0.0.1:1633');
      global.fetch.mockRejectedValueOnce(new Error('network error'));

      const result = await checkBeeReachable();
      expect(result).toEqual({ ok: false, reason: 'node-stopped' });
    });
  });

  describe('swarm_listFeeds', () => {
    test('returns empty array for origin with no feeds', async () => {
      mockGetAllFeeds.mockReturnValue({});
      const result = await invokeProvider('swarm_listFeeds', {}, 'newapp.eth');
      expect(result.result).toEqual([]);
      expect(result.error).toBeUndefined();
    });

    test('returns array of feed records with full coordinates', async () => {
      mockGetAllFeeds.mockReturnValue({
        'user-feed': {
          topic: 'a1b2c3',
          owner: '0xOwner1',
          manifestReference: 'mref1',
          createdAt: 1000,
          lastUpdated: 2000,
          lastReference: 'ref1',
        },
        'comments': {
          topic: 'd4e5f6',
          owner: '0xOwner1',
          manifestReference: 'mref2',
          createdAt: 1500,
          lastUpdated: null,
          lastReference: null,
        },
      });

      const result = await invokeProvider('swarm_listFeeds', {}, 'myapp.eth');

      expect(result.result).toHaveLength(2);
      expect(result.result).toContainEqual({
        name: 'user-feed',
        topic: 'a1b2c3',
        owner: '0xOwner1',
        manifestReference: 'mref1',
        bzzUrl: 'bzz://mref1',
        createdAt: 1000,
        lastUpdated: 2000,
        lastReference: 'ref1',
      });
      expect(result.result).toContainEqual({
        name: 'comments',
        topic: 'd4e5f6',
        owner: '0xOwner1',
        manifestReference: 'mref2',
        bzzUrl: 'bzz://mref2',
        createdAt: 1500,
        lastUpdated: null,
        lastReference: null,
      });
    });

    test('does NOT require connection permission (origin-scoped introspection)', async () => {
      // After revocation an origin should still be able to introspect its
      // preserved feed records — the metadata persists by design so a
      // re-granted origin sees its prior feeds, and listing them doesn't
      // leak anything beyond what the origin already created.
      mockGetPermission.mockReturnValue(null);
      mockGetAllFeeds.mockReturnValue({
        'user-feed': {
          topic: 'a1b2c3',
          owner: '0xOwner',
          manifestReference: 'mref',
          createdAt: 1000,
          lastUpdated: null,
          lastReference: null,
        },
      });

      const result = await invokeProvider('swarm_listFeeds', {}, 'revoked.eth');

      expect(result.result).toHaveLength(1);
      expect(result.error).toBeUndefined();
    });

    test('scopes results to caller origin', async () => {
      mockGetAllFeeds.mockReturnValue({});
      await invokeProvider('swarm_listFeeds', {}, 'specific-origin.eth');
      expect(mockGetAllFeeds).toHaveBeenCalledWith('specific-origin.eth');
    });
  });
});
