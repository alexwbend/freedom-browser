// Download shelf — compact bottom-right cards in the chrome, one per
// download owned by this window. Main sends `downloads:updated` to the
// owning window only (see downloads-manager.js), so a download started in
// another window never pops a card here.
//
// Lifecycle: a card appears on download start, tracks progress, and on a
// terminal state either offers Open / Show in folder (completed — files are
// NEVER opened automatically) or shows the failure state; settled cards
// auto-dismiss after a few seconds. The full history lives on
// freedom://downloads.

import { pushDebug } from './debug.js';

const AUTO_DISMISS_MS = 5000;

// id -> { el, nameEl, statusEl, barEl, fillEl, actionsEl, dismissTimer }
const cards = new Map();

let shelfEl = null;

// Human-readable byte count: 999 B, 1.2 KB, 34.5 MB, ...
export const formatBytes = (bytes) => {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '0 B';
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let scaled = value / 1024;
  let unitIndex = 0;
  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex++;
  }
  return `${scaled.toFixed(1)} ${units[unitIndex]}`;
};

// 0–100 when the total is known, null for an indeterminate bar.
export const progressPercent = (download) => {
  const total = Number(download?.total_bytes);
  const received = Number(download?.received_bytes);
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(received) || received <= 0) return 0;
  return Math.min(100, Math.round((received / total) * 100));
};

// One-line status under the filename, per state.
export const downloadStatusText = (download) => {
  const received = formatBytes(download?.received_bytes || 0);
  const total = Number(download?.total_bytes) > 0 ? formatBytes(download.total_bytes) : null;
  switch (download?.state) {
    case 'completed':
      return `Done — ${formatBytes(download.received_bytes || download.total_bytes || 0)}`;
    case 'cancelled':
      return 'Cancelled';
    case 'interrupted':
      return 'Failed — download interrupted';
    default:
      if (download?.is_paused) {
        return total ? `Paused — ${received} of ${total}` : `Paused — ${received}`;
      }
      return total ? `${received} of ${total}` : received;
  }
};

// Terminal states linger briefly, then the card dismisses itself.
export const isSettledState = (state) =>
  state === 'completed' || state === 'cancelled' || state === 'interrupted';

const dismissCard = (id) => {
  const card = cards.get(id);
  if (!card) return;
  if (card.dismissTimer) clearTimeout(card.dismissTimer);
  card.el.remove();
  cards.delete(id);
};

const makeButton = (label, className, testId, onClick) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = label;
  if (testId) btn.dataset.test = testId;
  btn.addEventListener('click', onClick);
  return btn;
};

const buildCard = (id) => {
  const el = document.createElement('div');
  el.className = 'download-card';
  el.dataset.id = String(id);

  const main = document.createElement('div');
  main.className = 'download-card-main';

  const nameEl = document.createElement('div');
  nameEl.className = 'download-card-name';

  const statusEl = document.createElement('div');
  statusEl.className = 'download-card-status';

  const barEl = document.createElement('div');
  barEl.className = 'download-card-progress';
  const fillEl = document.createElement('div');
  fillEl.className = 'download-card-progress-fill';
  barEl.appendChild(fillEl);

  main.appendChild(nameEl);
  main.appendChild(statusEl);
  main.appendChild(barEl);

  const actionsEl = document.createElement('div');
  actionsEl.className = 'download-card-actions';

  const closeBtn = makeButton('×', 'download-card-close', 'download-close', () => dismissCard(id));
  closeBtn.setAttribute('aria-label', 'Dismiss');

  el.appendChild(main);
  el.appendChild(actionsEl);
  el.appendChild(closeBtn);

  const card = { el, nameEl, statusEl, barEl, fillEl, actionsEl, dismissTimer: null };
  cards.set(id, card);
  shelfEl.appendChild(el);
  return card;
};

const renderActions = (card, download) => {
  const electronAPI = window.electronAPI;
  card.actionsEl.innerHTML = '';
  if (download.state === 'completed') {
    card.actionsEl.appendChild(
      makeButton('Open', 'download-card-btn', 'download-open', () => {
        electronAPI?.openDownloadedFile?.(download.id);
        dismissCard(download.id);
      })
    );
    card.actionsEl.appendChild(
      makeButton('Show in folder', 'download-card-btn', 'download-show-in-folder', () => {
        electronAPI?.showDownloadInFolder?.(download.id);
        dismissCard(download.id);
      })
    );
  } else if (!isSettledState(download.state)) {
    card.actionsEl.appendChild(
      makeButton('Cancel', 'download-card-btn danger', 'download-cancel', () => {
        electronAPI?.cancelDownload?.(download.id);
      })
    );
  }
};

// Apply one `downloads:updated` payload to the shelf. Exported for tests.
export const handleDownloadUpdate = (download) => {
  if (!shelfEl || !download || typeof download.id !== 'number') return;

  let card = cards.get(download.id);
  const isNew = !card;
  if (!card) card = buildCard(download.id);

  card.nameEl.textContent = download.filename || 'download';
  card.nameEl.title = download.filename || '';
  card.statusEl.textContent = downloadStatusText(download);

  const percent = progressPercent(download);
  const settled = isSettledState(download.state);
  card.barEl.classList.toggle('hidden', settled);
  card.barEl.classList.toggle('indeterminate', !settled && percent === null);
  card.fillEl.style.width = percent === null ? '100%' : `${percent}%`;

  card.el.classList.toggle('completed', download.state === 'completed');
  card.el.classList.toggle(
    'failed',
    download.state === 'cancelled' || download.state === 'interrupted'
  );

  // Buttons depend only on the state bucket; re-render on creation and on
  // state transitions (a progress tick never rebuilds them).
  if (isNew || settled) {
    renderActions(card, download);
  }

  if (card.dismissTimer) {
    clearTimeout(card.dismissTimer);
    card.dismissTimer = null;
  }
  if (settled) {
    card.dismissTimer = setTimeout(() => dismissCard(download.id), AUTO_DISMISS_MS);
  }
};

export const initDownloadsUi = () => {
  shelfEl = document.getElementById('download-shelf');
  if (!shelfEl) {
    pushDebug('[downloads] shelf container missing — shelf disabled');
    return;
  }
  window.electronAPI?.onDownloadUpdated?.(handleDownloadUpdate);
};

// Test-only: reset module state between specs.
export const _resetForTest = () => {
  for (const id of [...cards.keys()]) dismissCard(id);
  shelfEl = null;
};
