const log = require('./logger');
const { app, ipcMain, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const IPC = require('../shared/ipc-channels');
const { broadcastToAllWebContents } = require('./lib/broadcast-to-all-webcontents');

// Apply theme to nativeTheme so webviews get correct prefers-color-scheme
function applyNativeTheme(theme) {
  if (theme === 'light') {
    nativeTheme.themeSource = 'light';
  } else if (theme === 'dark') {
    nativeTheme.themeSource = 'dark';
  } else {
    nativeTheme.themeSource = 'system';
  }
}

const SETTINGS_FILE = 'settings.json';

// Bee-era settings keys renamed to their ant-named replacements. Migrated on
// load (for users upgrading from a bee-based build): the value is copied to the
// new key and the old key is dropped from the live file.
const RENAMED_KEYS = {
  beeNodeMode: 'antNodeMode',
  startBeeAtLaunch: 'startAntAtLaunch',
};

const DEFAULT_SETTINGS = {
  theme: 'system',
  enableRadicleIntegration: false,
  enableIdentityWallet: true,
  antNodeMode: 'ultraLight',
  startAntAtLaunch: true,
  startIpfsAtLaunch: true,
  startRadicleAtLaunch: false,
  autoUpdate: true,
  showBookmarkBar: false,
  // Address-bar search provider id used when typed input is not a URL, hash,
  // or name. Valid ids live in the renderer's search-utils.js SEARCH_PROVIDERS
  // map; unknown ids fall back to DuckDuckGo there.
  searchProvider: 'duckduckgo',
  customSearchProviders: [],
  // When true, navigating to an Ethereum name that resolved with trust.level =
  // 'unverified' is gated behind an interstitial with a single-use
  // "Continue once" option. ENS network config (resolution strategy, RPC
  // endpoints, prover, quorum params) lives in the network registry —
  // this is the one ENS-navigation setting kept here.
  blockUnverifiedEns: true,
  // Experimental: when true, IPFS request progress phases ("Finding
  // providers…", "Searching the DHT…", etc.) are surfaced in the link
  // hover preview bar during ipfs:// / ipns:// loads. Off by default so the
  // preview bar stays a pure hover-URL surface; opt in via Settings →
  // Experimental. A follow-up will generalize this to other protocols.
  showIpfsProgressStatus: false,
  sidebarOpen: false,
  sidebarWidth: 320,
  // Linux only: render the tab strip as the window titlebar (frameless window).
  // Off by default so Linux users get the native OS frame; opt in via Settings.
  tabsInTitlebar: false,
};

let cachedSettings = null;

const SEARCH_TERMS_PLACEHOLDER = '{searchTerms}';
const CUSTOM_SEARCH_PROVIDER_LIMIT = 50;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function normalizeSearchUrlTemplate(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return null;

  const openSearchCount = trimmed.split(SEARCH_TERMS_PLACEHOLDER).length - 1;
  const percentCount = trimmed.split('%s').length - 1;
  if (openSearchCount + percentCount !== 1) return null;

  const normalized = percentCount === 1 ? trimmed.replace('%s', SEARCH_TERMS_PLACEHOLDER) : trimmed;

  try {
    const parsed = new URL(normalized.replace(SEARCH_TERMS_PLACEHOLDER, 'test'));
    const secure = parsed.protocol === 'https:';
    const loopbackHttp = parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname);
    if ((!secure && !loopbackHttp) || parsed.username || parsed.password) return null;
  } catch {
    return null;
  }

  return normalized;
}

function normalizeCustomSearchProviders(value) {
  if (!Array.isArray(value)) return [];

  const normalized = [];
  const seenIds = new Set();
  for (const candidate of value.slice(0, CUSTOM_SEARCH_PROVIDER_LIMIT)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;

    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
    const searchUrlTemplate = normalizeSearchUrlTemplate(candidate.searchUrlTemplate);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !name || name.length > 64) continue;
    if (!searchUrlTemplate || seenIds.has(id)) continue;

    seenIds.add(id);
    normalized.push({ id, name, searchUrlTemplate });
  }

  return normalized;
}

function structuredSettingEquals(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeStructuredSettings(parsed) {
  if (!Object.prototype.hasOwnProperty.call(parsed, 'customSearchProviders')) return false;
  const normalized = normalizeCustomSearchProviders(parsed.customSearchProviders);
  if (structuredSettingEquals(parsed.customSearchProviders, normalized)) return false;
  parsed.customSearchProviders = normalized;
  return true;
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

// Rewrites bee-era keys to their ant-named replacements in place. Returns true
// when at least one key was migrated so the caller can persist the result.
function migrateRenamedKeys(parsed) {
  let migrated = false;
  for (const [oldKey, newKey] of Object.entries(RENAMED_KEYS)) {
    if (!Object.prototype.hasOwnProperty.call(parsed, oldKey)) continue;
    if (!Object.prototype.hasOwnProperty.call(parsed, newKey)) {
      parsed[newKey] = parsed[oldKey];
    }
    delete parsed[oldKey];
    migrated = true;
  }
  return migrated;
}

function loadSettings() {
  if (cachedSettings) {
    return cachedSettings;
  }

  try {
    const filePath = getSettingsPath();
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      const keysMigrated = migrateRenamedKeys(parsed);
      const structuredSettingsChanged = normalizeStructuredSettings(parsed);
      const settingsChanged = keysMigrated || structuredSettingsChanged;
      if (settingsChanged) {
        try {
          fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2), 'utf-8');
        } catch (err) {
          log.error('Failed to persist migrated settings:', err);
        }
      }
      cachedSettings = { ...DEFAULT_SETTINGS, ...parsed };
    } else {
      cachedSettings = { ...DEFAULT_SETTINGS };
    }
  } catch (err) {
    log.error('Failed to load settings:', err);
    cachedSettings = { ...DEFAULT_SETTINGS };
  }

  // Apply theme to nativeTheme
  applyNativeTheme(cachedSettings.theme);

  return cachedSettings;
}

function broadcastSettingsUpdated(merged) {
  broadcastToAllWebContents(IPC.SETTINGS_UPDATED, merged);
}

// Walks DEFAULT_SETTINGS keys in one pass: drops unknown input keys (defense
// against a buggy or compromised internal page persisting junk to disk) and
// detects no-op saves at the same time. customSearchProviders is the one
// structured setting and is normalized before it reaches disk or a renderer.
function saveSettings(newSettings) {
  try {
    const previous = loadSettings();
    const merged = { ...previous };
    let changed = false;

    if (newSettings && typeof newSettings === 'object') {
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (!Object.prototype.hasOwnProperty.call(newSettings, key)) continue;

        const nextValue =
          key === 'customSearchProviders'
            ? normalizeCustomSearchProviders(newSettings[key])
            : newSettings[key];
        const valuesMatch =
          key === 'customSearchProviders'
            ? structuredSettingEquals(previous[key], nextValue)
            : previous[key] === nextValue;

        if (!valuesMatch) {
          merged[key] = nextValue;
          changed = true;
        }
      }
    }

    if (!changed) return true;

    const filePath = getSettingsPath();
    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8');
    cachedSettings = merged;

    if (merged.theme !== previous.theme) {
      applyNativeTheme(merged.theme);
    }

    broadcastSettingsUpdated(merged);

    return true;
  } catch (err) {
    log.error('Failed to save settings:', err);
    return false;
  }
}

function registerSettingsIpc() {
  ipcMain.handle(IPC.SETTINGS_GET, () => {
    return loadSettings();
  });

  ipcMain.handle(IPC.SETTINGS_SAVE, (_event, newSettings) => {
    return saveSettings(newSettings);
  });
}

module.exports = {
  loadSettings,
  saveSettings,
  registerSettingsIpc,
};
