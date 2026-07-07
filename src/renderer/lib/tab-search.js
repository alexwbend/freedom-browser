// Tab search popover (Cmd/Ctrl+Shift+A, or View → Search Tabs).
//
// Lists the current window's open tabs — pinned tabs first, then strip
// order — with favicon, title, URL, and an audio badge for audible tabs.
// Typing fuzzy-filters on title/URL (tab-search-filter.js); ArrowUp/Down +
// Enter (or click) activates a tab, Esc closes. Placeholder tabs from lazy
// session restore appear via their persisted title/URL and materialize on
// activation like any other switch.
//
// Scope: the current window only. Every window's tab strip lives in its own
// renderer process, so enumerating (and focusing) tabs of other windows of
// the profile would need new main-process aggregation IPC — deliberately
// out of scope for this popover's first cut.

import { getTabs, getActiveTab, switchTab, getTabAudioState } from './tabs.js';
import { closeMenus } from './menus.js';
import { showMenuBackdrop, hideMenuBackdrop } from './menu-backdrop.js';
import { filterTabEntries } from './tab-search-filter.js';
import { pushDebug } from './debug.js';

const electronAPI = window.electronAPI;

// Default globe icon for entries without a favicon (same shape as the strip).
const GLOBE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
// Small speaker badge for audible entries.
const AUDIO_BADGE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>`;

let popover = null;
let input = null;
let listEl = null;
let onOpening = null;

let isOpen = false;
let entries = [];
let filtered = [];
let selectedIndex = 0;

// Snapshot the current tab strip as searchable entries: pinned first, then
// strip order (stable within each group).
const buildEntries = () => {
  const tabs = getTabs();
  const activeId = getActiveTab()?.id ?? null;
  const ordered = [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];
  return ordered.map((tab) => ({
    id: tab.id,
    title: tab.title || 'New Tab',
    url: tab.url || '',
    favicon: typeof tab.favicon === 'string' ? tab.favicon : null,
    pinned: tab.pinned === true,
    isActive: tab.id === activeId,
    audioState: getTabAudioState(tab),
  }));
};

const renderList = () => {
  if (!listEl) return;
  listEl.innerHTML = '';

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'tab-search-empty';
    empty.textContent = 'No matching tabs';
    listEl.appendChild(empty);
    return;
  }

  filtered.forEach((entry, index) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'tab-search-item';
    row.dataset.test = 'tab-search-item';
    row.dataset.tabId = String(entry.id);
    row.classList.toggle('selected', index === selectedIndex);

    const icon = document.createElement('span');
    icon.className = 'tab-search-item-icon';
    if (entry.favicon) {
      const img = document.createElement('img');
      img.src = entry.favicon;
      img.alt = '';
      icon.appendChild(img);
    } else {
      icon.innerHTML = GLOBE_SVG;
    }
    row.appendChild(icon);

    const text = document.createElement('span');
    text.className = 'tab-search-item-text';
    const title = document.createElement('span');
    title.className = 'tab-search-item-title';
    title.textContent = entry.title;
    const url = document.createElement('span');
    url.className = 'tab-search-item-url';
    url.textContent = entry.url;
    text.appendChild(title);
    text.appendChild(url);
    row.appendChild(text);

    if (entry.audioState === 'audible') {
      const badge = document.createElement('span');
      badge.className = 'tab-search-item-audio';
      badge.dataset.test = 'tab-search-item-audio';
      badge.innerHTML = AUDIO_BADGE_SVG;
      row.appendChild(badge);
    }

    if (entry.isActive) {
      const current = document.createElement('span');
      current.className = 'tab-search-item-current';
      current.textContent = 'Current';
      row.appendChild(current);
    }

    row.addEventListener('click', () => activateEntry(index));
    // Track the pointer like a menu: hovering moves the selection.
    row.addEventListener('mousemove', () => {
      if (selectedIndex !== index) {
        selectedIndex = index;
        updateSelection();
      }
    });

    listEl.appendChild(row);
  });
};

const updateSelection = () => {
  if (!listEl) return;
  const rows = listEl.querySelectorAll('.tab-search-item');
  rows.forEach((row, index) => {
    row.classList.toggle('selected', index === selectedIndex);
    if (index === selectedIndex) {
      row.scrollIntoView?.({ block: 'nearest' });
    }
  });
};

const refilter = () => {
  filtered = filterTabEntries(entries, input?.value || '');
  selectedIndex = 0;
  renderList();
};

const activateEntry = (index) => {
  const entry = filtered[index];
  hideTabSearch();
  if (!entry) return;
  switchTab(entry.id);
  pushDebug(`[TabSearch] Activated tab ${entry.id}`);
};

export const isTabSearchOpen = () => isOpen;

export const showTabSearch = () => {
  if (!popover || !input || !listEl) return;
  // Dismiss the other transient surfaces before taking the stage.
  closeMenus();
  onOpening?.();
  showMenuBackdrop();

  isOpen = true;
  entries = buildEntries();
  input.value = '';
  filtered = filterTabEntries(entries, '');
  selectedIndex = 0;
  renderList();
  popover.classList.remove('hidden');
  input.focus();
};

export const hideTabSearch = () => {
  if (!popover) return;
  const wasVisible = isOpen;
  popover.classList.add('hidden');
  isOpen = false;
  if (wasVisible) {
    hideMenuBackdrop();
  }
};

export const toggleTabSearch = () => {
  if (isOpen) {
    hideTabSearch();
  } else {
    showTabSearch();
  }
};

const onInputKeydown = (event) => {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      if (filtered.length > 0) {
        selectedIndex = (selectedIndex + 1) % filtered.length;
        updateSelection();
      }
      break;
    case 'ArrowUp':
      event.preventDefault();
      if (filtered.length > 0) {
        selectedIndex = (selectedIndex - 1 + filtered.length) % filtered.length;
        updateSelection();
      }
      break;
    case 'Enter':
      event.preventDefault();
      activateEntry(selectedIndex);
      break;
    case 'Escape':
      event.preventDefault();
      hideTabSearch();
      break;
  }
};

/**
 * Wire the popover. `options.onOpening` mirrors the tab/bookmark context
 * menus' opening hook — index.js uses it to dismiss autocomplete etc.
 */
export const initTabSearch = (options = {}) => {
  popover = document.getElementById('tab-search');
  input = document.getElementById('tab-search-input');
  listEl = document.getElementById('tab-search-list');
  onOpening = options.onOpening || null;
  if (!popover || !input || !listEl) return;

  input.addEventListener('input', refilter);
  input.addEventListener('keydown', onInputKeydown);

  // Keep clicks inside the popover from bubbling to document-level
  // close-everything handlers.
  popover.addEventListener('mousedown', (event) => {
    event.stopPropagation();
  });

  // View → Search Tabs (accelerator registered in src/main/menu.js — works
  // even while a webview has focus).
  electronAPI?.onTabSearch?.(() => {
    toggleTabSearch();
  });

  // Renderer-side fallback shortcut for when chrome has focus.
  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      toggleTabSearch();
    }
  });

  window.addEventListener('blur', hideTabSearch);
};
