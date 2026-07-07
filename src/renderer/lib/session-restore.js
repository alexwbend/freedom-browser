// Session persistence — renderer side of "Continue where you left off".
//
// Captures the tab strip as a serializable snapshot and ships it (debounced
// ~1s) to the main-process session store (src/main/session-store.js), the
// single writer of the per-profile session.json. tabs.js registers a
// snapshot provider at init and calls `persistSessionSoon()` from its
// mutation paths; everything else lives here so the tabs.js diff stays
// small (an upcoming tab-strip branch also reworks that file).
import { getInternalPageName } from './page-urls.js';

const electronAPI = window.electronAPI;

export const SESSION_SNAPSHOT_DEBOUNCE_MS = 1000;

// Favicons are cached as data: URLs; anything larger than this is dropped
// from the snapshot rather than bloating session.json (the favicon pipeline
// repopulates it on the next real load anyway).
const MAX_PERSISTED_FAVICON_CHARS = 65536;

let snapshotProvider = null;
let debounceTimer = null;

// tabs.js registers `() => ({ tabs, activeTabId })` here during init.
export const initSessionPersistence = (provider) => {
  snapshotProvider = provider;
};

/**
 * Serialize live tab objects into the persisted session shape:
 * `{ tabs: [{url, title, pinned, faviconUrl}], activeTabIndex }`.
 *
 * - Tabs without a useful URL (never-navigated about:blank parks) are
 *   skipped; `activeTabIndex` is computed against the serialized list.
 * - Internal pages are normalized to their `freedom://<name>` form — the
 *   resolved `file://…/pages/…` URL is install-location-specific, and the
 *   friendly form round-trips through the normal open path on restore
 *   (including the home page, which persists as `freedom://home`).
 * - Per-tab back/forward history is NOT captured: Electron's <webview>
 *   exposes no API to export or re-seed a NavigationHistory, so restore is
 *   URL-only by design.
 */
export const serializeSessionTabs = (tabs, activeTabId) => {
  const serialized = [];
  let activeTabIndex = 0;
  for (const tab of tabs || []) {
    const rawUrl = tab?.url || tab?.navigationState?.currentPageUrl || '';
    if (!rawUrl || rawUrl === 'about:blank') continue;
    const internalName = rawUrl.startsWith('freedom://') ? null : getInternalPageName(rawUrl);
    const url = internalName ? `freedom://${internalName}` : rawUrl;
    const faviconUrl =
      typeof tab.favicon === 'string' && tab.favicon.length <= MAX_PERSISTED_FAVICON_CHARS
        ? tab.favicon
        : null;
    if (tab.id === activeTabId) {
      activeTabIndex = serialized.length;
    }
    serialized.push({
      url,
      title: typeof tab.title === 'string' ? tab.title : '',
      pinned: tab.pinned === true,
      faviconUrl,
    });
  }
  return { tabs: serialized, activeTabIndex };
};

const sendSnapshotNow = () => {
  if (!snapshotProvider || !electronAPI?.updateSessionState) return;
  try {
    const { tabs, activeTabId } = snapshotProvider();
    electronAPI.updateSessionState(serializeSessionTabs(tabs, activeTabId));
  } catch {
    // Persistence must never break tab handling.
  }
};

// Debounced (trailing-edge, ~1s) snapshot request. Tab mutations call this
// freely; bursts (rapid loads, drags, mass tab closes) collapse into one
// IPC message + one atomic write in the main process. Because the file is
// rewritten continuously, a crashed session restores too — at worst the
// final debounce window (~1s of changes) is lost.
export const persistSessionSoon = () => {
  if (!snapshotProvider || !electronAPI?.updateSessionState) return;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    sendSnapshotNow();
  }, SESSION_SNAPSHOT_DEBOUNCE_MS);
};

/**
 * Fetch the persisted window snapshot this window should restore, or null.
 * Only windows launched with a `restoreSlot` query parameter (assigned by
 * the main process at startup) restore anything; user-opened windows
 * (Cmd+N) carry no slot and start fresh.
 */
export const getSessionToRestore = async (urlParams) => {
  const rawSlot = urlParams?.get?.('restoreSlot');
  if (rawSlot === null || rawSlot === undefined) return null;
  const slot = Number(rawSlot);
  if (!Number.isInteger(slot) || slot < 0) return null;
  try {
    const payload = await electronAPI?.getSessionToRestore?.(slot);
    if (!payload || !Array.isArray(payload.tabs) || payload.tabs.length === 0) return null;
    return payload;
  } catch {
    return null;
  }
};
