const DEFAULT_HOME_URL = 'freedom://home';

const TAB_COMMANDS = Object.freeze({
  CREATE: 'tabs.create',
  CLOSE: 'tabs.close',
  ACTIVATE: 'tabs.activate',
  NAVIGATE: 'tabs.navigate',
  RELOAD: 'tabs.reload',
  GO_HOME: 'tabs.goHome',
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function commandError(code, message, details = {}) {
  return {
    code,
    message,
    ...details,
  };
}

function coerceOptions(value) {
  if (value === undefined || value === null) {
    return { ok: true, options: {} };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return {
      ok: false,
      error: commandError('TAB_COMMAND_OPTIONS_INVALID', 'Tab command options must be an object'),
    };
  }
  return { ok: true, options: value };
}

function coerceTabId(value) {
  if (Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) {
    return Number(value);
  }
  return null;
}

function coerceUrl(value, fallbackUrl) {
  if (value === undefined || value === null || value === '') {
    return fallbackUrl;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || fallbackUrl;
}

class ShellTabRegistry {
  constructor(options = {}) {
    this.homeUrl = options.homeUrl || DEFAULT_HOME_URL;
    this.tabs = [];
    this.activeTabId = null;
    this.nextTabId = 1;
    this.snapshotVersion = 0;
    this.commandSequence = 0;

    if (options.createInitialTab !== false) {
      const tab = this.createTabRecord({ url: this.homeUrl });
      this.tabs.push(tab);
      this.activeTabId = tab.id;
      this.bumpSnapshotVersion();
    }
  }

  bumpSnapshotVersion() {
    this.snapshotVersion += 1;
  }

  createTabRecord(options = {}) {
    return {
      id: this.nextTabId++,
      url: options.url || this.homeUrl,
      title: options.title || 'New Tab',
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
    };
  }

  findTab(tabId) {
    return this.tabs.find((tab) => tab.id === tabId) || null;
  }

  serializeTab(tab) {
    return {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      isActive: tab.id === this.activeTabId,
      isLoading: tab.isLoading === true,
      canGoBack: tab.canGoBack === true,
      canGoForward: tab.canGoForward === true,
    };
  }

  getSnapshot() {
    return {
      version: this.snapshotVersion,
      activeTabId: this.activeTabId,
      tabs: this.tabs.map((tab) => this.serializeTab(tab)),
    };
  }

  makeCommandResult(command, mutator) {
    const commandId = `tab-command-${++this.commandSequence}`;
    const result = mutator();
    if (!result.ok) {
      return {
        ok: false,
        commandId,
        command,
        error: result.error,
        snapshot: this.getSnapshot(),
      };
    }
    return {
      ok: true,
      commandId,
      command,
      ...result.value,
      snapshot: this.getSnapshot(),
    };
  }

  createTab(options = {}) {
    return this.makeCommandResult(TAB_COMMANDS.CREATE, () => {
      const optionsResult = coerceOptions(options);
      if (!optionsResult.ok) return optionsResult;

      const url = coerceUrl(optionsResult.options.url, this.homeUrl);
      if (!url) {
        return {
          ok: false,
          error: commandError('TAB_URL_INVALID', 'Tab URL must be a string'),
        };
      }

      const title =
        typeof optionsResult.options.title === 'string' && optionsResult.options.title.trim()
          ? optionsResult.options.title.trim()
          : 'New Tab';
      const tab = this.createTabRecord({ url, title });
      this.tabs.push(tab);
      this.activeTabId = tab.id;
      this.bumpSnapshotVersion();
      return { ok: true, value: { tabId: tab.id } };
    });
  }

  closeTab(options = {}) {
    return this.makeCommandResult(TAB_COMMANDS.CLOSE, () => {
      const optionsResult = coerceOptions(options);
      if (!optionsResult.ok) return optionsResult;

      const tabId = coerceTabId(optionsResult.options.tabId);
      if (!tabId) {
        return {
          ok: false,
          error: commandError('TAB_ID_INVALID', 'Tab id must be a positive integer'),
        };
      }

      const index = this.tabs.findIndex((tab) => tab.id === tabId);
      if (index === -1) {
        return {
          ok: false,
          error: commandError('TAB_NOT_FOUND', 'Tab does not exist', { tabId }),
        };
      }
      if (this.tabs.length === 1) {
        return {
          ok: false,
          error: commandError('TAB_CLOSE_LAST_UNSUPPORTED', 'Closing the last tab is not yet exposed'),
        };
      }

      this.tabs.splice(index, 1);
      if (this.activeTabId === tabId) {
        const nextIndex = Math.min(index, this.tabs.length - 1);
        this.activeTabId = this.tabs[nextIndex]?.id || null;
      }
      this.bumpSnapshotVersion();
      return { ok: true, value: { tabId } };
    });
  }

  activateTab(options = {}) {
    return this.makeCommandResult(TAB_COMMANDS.ACTIVATE, () => {
      const tab = this.getCommandTab(options);
      if (!tab.ok) return tab;

      this.activeTabId = tab.value.id;
      this.bumpSnapshotVersion();
      return { ok: true, value: { tabId: tab.value.id } };
    });
  }

  navigateTab(options = {}) {
    return this.makeCommandResult(TAB_COMMANDS.NAVIGATE, () => {
      const tab = this.getCommandTab(options);
      if (!tab.ok) return tab;

      const url = coerceUrl(tab.options.url, null);
      if (!url) {
        return {
          ok: false,
          error: commandError('TAB_URL_INVALID', 'Tab URL must be a non-empty string'),
        };
      }

      tab.value.url = url;
      tab.value.isLoading = false;
      this.bumpSnapshotVersion();
      return { ok: true, value: { tabId: tab.value.id, url } };
    });
  }

  reloadTab(options = {}) {
    return this.makeCommandResult(TAB_COMMANDS.RELOAD, () => {
      const tab = this.getCommandTab(options);
      if (!tab.ok) return tab;
      return { ok: true, value: { tabId: tab.value.id, url: tab.value.url } };
    });
  }

  goHome(options = {}) {
    return this.makeCommandResult(TAB_COMMANDS.GO_HOME, () => {
      const tab = this.getCommandTab(options);
      if (!tab.ok) return tab;

      tab.value.url = this.homeUrl;
      tab.value.title = 'New Tab';
      tab.value.isLoading = false;
      this.bumpSnapshotVersion();
      return { ok: true, value: { tabId: tab.value.id, url: this.homeUrl } };
    });
  }

  getCommandTab(options = {}) {
    const optionsResult = coerceOptions(options);
    if (!optionsResult.ok) return optionsResult;

    const tabId = coerceTabId(optionsResult.options.tabId ?? this.activeTabId);
    if (!tabId) {
      return {
        ok: false,
        error: commandError('TAB_ID_INVALID', 'Tab id must be a positive integer'),
      };
    }

    const tab = this.findTab(tabId);
    if (!tab) {
      return {
        ok: false,
        error: commandError('TAB_NOT_FOUND', 'Tab does not exist', { tabId }),
      };
    }

    return { ok: true, value: tab, options: optionsResult.options };
  }

  toJSON() {
    return clone(this.getSnapshot());
  }
}

function createShellTabRegistry(options = {}) {
  return new ShellTabRegistry(options);
}

module.exports = {
  DEFAULT_HOME_URL,
  ShellTabRegistry,
  TAB_COMMANDS,
  createShellTabRegistry,
};
