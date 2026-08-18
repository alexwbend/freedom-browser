/**
 * Embedded Radicle API serving — the repository-viewer API that Freedom
 * consumes, backed directly by the in-process node.
 *
 * Two consumers share `serveRepoApi`:
 *  - the `radapi:` scheme registered here, fetched by the internal
 *    rad-browser.html page (its `base` param becomes `radapi://local`);
 *  - the `rad:` scheme handler (radicle/rad-protocol.js), which serves
 *    dweb pages through the same native serving core.
 *
 * Served repo endpoints:
 *   /                   → embedded node health/version
 *   /api/v1/stats       → node summary used by the Nodes panel
 *   /api/v1/repos       → locally seeded repositories
 *   (root)              → repo metadata used by the viewer
 *   /tree/SHA[/path]    → tree entries at head (SHA informational)
 *   /blob/SHA/path      → blob content
 *   /readme/SHA         → root readme blob
 *   /stats/...          → {} (viewer treats stats as optional)
 *   /remotes            → [] (viewer falls back gracefully)
 *   /issues[/ID]        → collaborative issue reads
 *   /patches[/ID]       → collaborative patch reads
 *
 * Tree/blob reads serve the head of the default branch — the viewer
 * always passes the head SHA it got from the repo metadata, so pinning
 * other commits is follow-up work.
 */

const log = require('./logger');
const embedded = require('./radicle-embedded');
const { loadSettings } = require('./settings-store');

const RID_RE = /^rad:z[1-9A-HJ-NP-Za-km-z]{20,60}$/;
const ALLOWED_METHODS = new Set(['GET', 'HEAD']);

function json(body, status = 200, { cors = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cors) headers['Access-Control-Allow-Origin'] = '*';
  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}

function withoutBody(response) {
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function serveNodeApi(pathname) {
  try {
    const status = await embedded.status();
    if (pathname === '/') {
      return json({
        version: status?.version || 'embedded',
        mode: 'embedded',
      }, 200, { cors: false });
    }
    const repos = await embedded.listRepos();
    return json({
      repos: { total: repos.length },
      peers: { connected: status?.connectedPeers ?? 0 },
    }, 200, { cors: false });
  } catch (err) {
    log.warn('[radapi] node status failed:', err.message);
    return json({ error: err.message }, 503, { cors: false });
  }
}

function decodeRepoApiPath(apiPath) {
  if (!apiPath) return [];
  if (!apiPath.startsWith('/') || apiPath.includes('\\')) return null;

  const raw = apiPath.slice(1).split('/');
  const decoded = [];
  for (let index = 0; index < raw.length; index += 1) {
    const segment = raw[index];
    if (segment === '') {
      if (index === raw.length - 1) continue;
      return null;
    }
    let value;
    try {
      value = decodeURIComponent(segment);
    } catch {
      return null;
    }
    // Encoded separators are separators too; accepting them would bypass
    // segment-level traversal validation after decoding.
    // eslint-disable-next-line no-control-regex
    if (value === '.' || value === '..' || /[\\/\u0000-\u001f\u007f]/.test(value)) {
      return null;
    }
    decoded.push(value);
  }
  return decoded;
}

function paginate(items, searchParams) {
  const params =
    searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams || '');
  const status = params.get('status');
  const filtered = status ? items.filter((item) => item?.state?.status === status) : items;
  const page = Math.max(0, Number.parseInt(params.get('page') || '0', 10) || 0);
  const perPage = Math.min(
    100,
    Math.max(1, Number.parseInt(params.get('perPage') || '30', 10) || 30)
  );
  return filtered.slice(page * perPage, (page + 1) * perPage);
}

/**
 * Serve one repo-scoped API path from the embedded node.
 * @param {string} rid - Full RID with rad: prefix (validated here)
 * @param {string} apiPath - Path under the repo root, e.g. '' or
 *   '/tree/<sha>/src' or '/blob/<sha>/README.md' (URL-encoded segments ok)
 * @returns {Promise<Response>}
 */
async function serveRepoApi(
  rid,
  apiPath,
  { method = 'GET', search = '', allowPrivate = false } = {}
) {
  if (!RID_RE.test(rid)) {
    return json({ error: 'invalid RID' }, 400);
  }
  const parts = decodeRepoApiPath(apiPath);
  if (!parts) return json({ error: 'invalid repository path' }, 400);
  const section = parts[0] || null;

  try {
    if (!allowPrivate) {
      const info = await embedded.repoInfo(rid);
      if (info?.visibility?.type !== 'public') {
        return json({ error: 'repository is not public' }, 403);
      }
    }
    let response;
    if (!section) {
      response = json(await embedded.buildRepoMeta(rid));
    } else {
      switch (section) {
        case 'tree':
          response = parts[1]
            ? json(await embedded.tree(rid, parts.slice(2).join('/')))
            : json({ error: 'missing revision' }, 400);
          break;
        case 'blob': {
          const blobPath = parts.slice(2).join('/');
          response = parts[1] && blobPath
            ? json(await embedded.blob(rid, blobPath))
            : json({ error: 'missing path' }, 400);
          break;
        }
        case 'readme': {
          const readme = await embedded.readme(rid);
          response = readme ? json(readme) : json({ error: 'no readme' }, 404);
          break;
        }
        case 'stats':
          response = json({});
          break;
        case 'remotes':
          response = json([]);
          break;
        case 'issues':
          if (parts.length > 2) return json({ error: 'invalid issue path' }, 400);
          response = parts[1]
            ? json(await embedded.issue(rid, parts[1]))
            : json(paginate(await embedded.issues(rid), search));
          break;
        case 'patches':
          if (parts.length > 2) return json({ error: 'invalid patch path' }, 400);
          response = parts[1]
            ? json(await embedded.patch(rid, parts[1]))
            : json(paginate(await embedded.patches(rid), search));
          break;
        default:
          response = json({ error: `unsupported endpoint: ${section}` }, 404);
      }
    }
    return method === 'HEAD' ? withoutBody(response) : response;
  } catch (err) {
    const missing = /not found|does not exist|NotFound/i.test(err.message);
    if (!missing) {
      log.warn('[radapi]', rid, apiPath, '→', err.message);
    }
    return json({ error: err.message }, missing ? 404 : 500);
  }
}

async function handleRadicleApiRequest(request) {
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return json({ error: 'invalid URL' }, 400, { cors: false });
  }

  if (loadSettings().enableRadicleIntegration !== true) {
    return json({ error: 'Radicle integration is disabled' }, 403, { cors: false });
  }
  const method = (request.method || 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return json({ error: 'method not allowed' }, 405, { cors: false });
  }
  const origin = request.headers?.get?.('origin');
  if (origin && origin !== 'null' && !origin.startsWith('file://')) {
    return json({ error: 'radapi is restricted to internal pages' }, 403, { cors: false });
  }

  if (url.pathname === '/' || url.pathname === '/api/v1/stats') {
    const response = await serveNodeApi(url.pathname);
    return method === 'HEAD' ? withoutBody(response) : response;
  }

  // radapi://local/api/v1/repos/<rid>[/section...]
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'repos') {
    return json({ error: 'not found' }, 404, { cors: false });
  }
  if (!parts[3]) {
    try {
      const repos = await embedded.listRepos();
      const response = json(
        await Promise.all(repos.map(({ rid }) => embedded.buildRepoMeta(rid))),
        200,
        { cors: false }
      );
      return method === 'HEAD' ? withoutBody(response) : response;
    } catch (err) {
      log.warn('[radapi] repository listing failed:', err.message);
      return json({ error: err.message }, 500, { cors: false });
    }
  }
  let rid;
  try {
    rid = decodeURIComponent(parts[3]);
  } catch {
    return json({ error: 'invalid RID encoding' }, 400);
  }
  const apiPath = parts.length > 4 ? `/${parts.slice(4).join('/')}` : '';
  return serveRepoApi(rid, apiPath, {
    method,
    search: url.searchParams,
    allowPrivate: true,
  });
}

/**
 * Register the radapi: handler on the given session. The scheme must have
 * been declared in `protocol.registerSchemesAsPrivileged` at startup.
 */
function registerRadicleApiProtocol(targetSession) {
  if (!targetSession?.protocol?.handle) {
    log.warn('[radapi] session.protocol.handle unavailable — skipping');
    return;
  }
  targetSession.protocol.handle('radapi', (request) => handleRadicleApiRequest(request));
  log.info('[radapi] Protocol handler registered');
}

module.exports = {
  registerRadicleApiProtocol,
  handleRadicleApiRequest,
  serveRepoApi,
  decodeRepoApiPath,
};
