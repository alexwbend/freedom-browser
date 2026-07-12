/**
 * Tests for the Safe signing board's message-session lifecycle.
 *
 * Focus: the board is chrome for a dApp request that is bound to one
 * document. When that document navigates away (or its webview dies) the
 * provider drops the response and main discards the session — the board
 * must be withdrawn too: promise settled, Ledger probing stopped, screen
 * taken down. The withdrawal is owner-scoped so an invalidation from a
 * predecessor document can never close a successor's board.
 */

const { createDocument, createElement } = require('../../../../test/helpers/fake-dom.js');

const originalWindow = global.window;
const originalDocument = global.document;
const originalCustomEvent = global.CustomEvent;

const flushMicrotasks = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

/** Observe a promise without awaiting it (the board settles it later). */
const track = (promise) => {
  const outcome = { settled: false, value: undefined, rejection: undefined };
  promise.then(
    (value) => {
      outcome.settled = true;
      outcome.value = value;
    },
    (error) => {
      outcome.settled = true;
      outcome.rejection = error;
    }
  );
  return outcome;
};

const messageState = (overrides = {}) => ({
  token: 'tok-1',
  status: 'collecting',
  collected: 1,
  threshold: 2,
  createdAt: '2026-07-12T00:00:00.000Z',
  display: { kind: 'message', site: 'https://app.example', method: 'personal_sign' },
  executorIndex: null,
  owners: [
    { index: 0, type: 'mnemonic', signed: true },
    { index: 1, type: 'mnemonic', signed: false },
  ],
  ...overrides,
});

const loadBoard = async () => {
  jest.resetModules();

  const walletMocks = {
    safeMessageState: jest.fn(async () => ({ success: false, error: 'no session' })),
    safeMessageSign: jest.fn(async () => ({ success: false, error: 'no session' })),
    safeMessageCancel: jest.fn(async () => ({ success: true })),
    safeMessageComplete: jest.fn(async () => ({ success: true, signature: '0xsig' })),
  };

  const identityView = createElement('div');
  global.window = {
    wallet: walletMocks,
    ledger: { getAccounts: jest.fn(async () => ({ success: false })) },
    dispatchEvent: jest.fn(),
  };
  global.CustomEvent = class CustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options?.detail;
    }
  };

  const screen = createElement('div', { classes: ['hidden'] });
  const elementsById = {
    'sidebar-safe-signing': screen,
    'safe-signing-back': createElement('button'),
    'safe-signing-title': createElement('h3'),
    'safe-signing-content': createElement('div'),
  };
  global.document = createDocument({ elementsById });

  jest.doMock('./wallet-state.js', () => ({
    walletState: { identityView },
    registerScreenHider: jest.fn(),
    hideAllSubscreens: jest.fn(),
  }));
  jest.doMock('./wallet-utils.js', () => ({
    escapeHtml: (text) => String(text ?? ''),
    truncateAddress: (address) => String(address ?? ''),
    formatRawTokenBalance: () => '0',
    walletRecord: jest.fn((index) => ({ name: `Account ${index}`, type: 'mnemonic' })),
    timeAgo: () => 'Just now',
  }));
  jest.doMock('./balance-display.js', () => ({ refreshBalances: jest.fn() }));
  jest.doMock('./vault-unlock.js', () => ({ showVaultUnlock: jest.fn() }));

  const mod = await import('./safe-signing.js');
  mod.initSafeSigning();

  return { mod, screen, identityView, walletMocks, ledger: global.window.ledger };
};

describe('safe signing board — message session withdrawal', () => {
  afterEach(() => {
    jest.useRealTimers();
    global.window = originalWindow;
    global.document = originalDocument;
    global.CustomEvent = originalCustomEvent;
    jest.restoreAllMocks();
  });

  test('abandoning for the owning document closes the board, stops polling, settles the promise', async () => {
    jest.useFakeTimers();
    const { mod, screen, walletMocks, ledger } = await loadBoard();
    const owner = { doc: 'A' };

    const withLedgerRow = messageState({
      owners: [
        { index: 0, type: 'mnemonic', signed: true },
        { index: 1, type: 'ledger', signed: false },
      ],
    });
    const outcome = track(mod.openSafeMessageBoard(5, withLedgerRow, owner));
    await flushMicrotasks();
    expect(screen.classList.contains('hidden')).toBe(false);

    // The unsigned Ledger row starts warm detection.
    await jest.advanceTimersByTimeAsync(0);
    expect(ledger.getAccounts).toHaveBeenCalledTimes(1);

    mod.abandonSafeMessageBoard(owner);
    await flushMicrotasks();

    expect(outcome.rejection).toEqual({ code: 4001, message: 'User rejected the request' });
    expect(screen.classList.contains('hidden')).toBe(true);
    expect(walletMocks.safeMessageCancel).toHaveBeenCalledWith(5, 'tok-1');

    // Ledger probing died with the board.
    const probes = ledger.getAccounts.mock.calls.length;
    await jest.advanceTimersByTimeAsync(10000);
    expect(ledger.getAccounts).toHaveBeenCalledTimes(probes);
  });

  test('a predecessor invalidation never closes a successor document board', async () => {
    const { mod, screen, walletMocks } = await loadBoard();
    const predecessor = { doc: 'A' };
    const successor = { doc: 'B' };

    const first = track(mod.openSafeMessageBoard(5, messageState(), predecessor));
    await flushMicrotasks();
    // Opening a new session settles the previous one (single board slot).
    const second = track(mod.openSafeMessageBoard(5, messageState({ token: 'tok-2' }), successor));
    await flushMicrotasks();
    expect(first.settled).toBe(true);
    walletMocks.safeMessageCancel.mockClear();

    // The predecessor's navigation invalidation arrives late.
    mod.abandonSafeMessageBoard(predecessor);
    await flushMicrotasks();

    expect(second.settled).toBe(false);
    expect(screen.classList.contains('hidden')).toBe(false);
    expect(walletMocks.safeMessageCancel).not.toHaveBeenCalled();
  });

  test('user cancel still rejects, cancels the session, and closes the board', async () => {
    const { mod, screen, walletMocks } = await loadBoard();

    const outcome = track(mod.openSafeMessageBoard(5, messageState(), { doc: 'A' }));
    await flushMicrotasks();

    mod.closeSafeSigning();
    await flushMicrotasks();

    expect(outcome.rejection).toEqual({ code: 4001, message: 'User rejected the request' });
    expect(walletMocks.safeMessageCancel).toHaveBeenCalledWith(5, 'tok-1');
    expect(screen.classList.contains('hidden')).toBe(true);
    expect(global.window.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'wallet:safe-signing-closed' })
    );
  });

  test('threshold met still completes and resolves the dApp promise', async () => {
    const { mod, screen, walletMocks } = await loadBoard();

    const complete = messageState({
      collected: 2,
      owners: [
        { index: 0, type: 'mnemonic', signed: true },
        { index: 1, type: 'mnemonic', signed: true },
      ],
    });
    const outcome = track(mod.openSafeMessageBoard(5, complete, { doc: 'A' }));
    await flushMicrotasks();

    expect(walletMocks.safeMessageComplete).toHaveBeenCalledWith(5, 'tok-1');
    expect(outcome.value).toBe('0xsig');
    expect(walletMocks.safeMessageCancel).not.toHaveBeenCalled();
    expect(screen.classList.contains('hidden')).toBe(true);
  });
});
