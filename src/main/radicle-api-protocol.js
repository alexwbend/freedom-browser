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
 *   (root)              → repo metadata used by the viewer
 *   /tree/SHA[/path]    → tree entries at head (SHA informational)
 *   /blob/SHA/path      → blob content
 *   /readme/SHA         → root readme blob
 *   /stats/...          → {} (viewer treats stats as optional)
 *   /remotes            → [] (viewer falls back gracefully)
 *
 * Tree/blob reads serve the head of the default branch — the viewer
 * always passes the head SHA it got from the repo metadata, so pinning
 * other commits is follow-up work.
 */

const log = require('./logger');
const embedded = require('./radicle-embedded');

const RID_RE = /^rad:z[1-9A-HJ-NP-Za-km-z]{20,60}$/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
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
      });
    }
    const repos = await embedded.listRepos();
    return json({
      repos: { total: repos.length },
      peers: { connected: status?.connectedPeers ?? 0 },
    });
  } catch (err) {
    log.warn('[radapi] node status failed:', err.message);
    return json({ error: err.message }, 503);
  }
}

/**
 * Serve one repo-scoped API path from the embedded node.
 * @param {string} rid - Full RID with rad: prefix (validated here)
 * @param {string} apiPath - Path under the repo root, e.g. '' or
 *   '/tree/<sha>/src' or '/blob/<sha>/README.md' (URL-encoded segments ok)
 * @returns {Promise<Response>}
 */
async function serveRepoApi(rid, apiPath, { method = 'GET' } = {}) {
  if (!RID_RE.test(rid)) {
    return json({ error: 'invalid RID' }, 400);
  }
  const parts = (apiPath || '').split('/').filter(Boolean);
  const section = parts[0] || null;
  // Sections carry an informational commit SHA segment: tree/SHA[/path...],
  // blob/SHA/path..., readme/SHA, stats/tree/SHA.
  let rest;
  try {
    rest = parts.slice(2).map(decodeURIComponent).join('/');
  } catch {
    return json({ error: 'invalid path encoding' }, 400);
  }

  try {
    let response;
    if (!section) {
      response = json(await embedded.buildRepoMeta(rid));
    } else {
      switch (section) {
        case 'tree':
          response = json(await embedded.tree(rid, rest));
          break;
        case 'blob':
          response = rest
            ? json(await embedded.blob(rid, rest))
            : json({ error: 'missing path' }, 400);
          break;
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
    return json({ error: 'invalid URL' }, 400);
  }

  if (url.pathname === '/' || url.pathname === '/api/v1/stats') {
    const response = await serveNodeApi(url.pathname);
    return request.method === 'HEAD' ? withoutBody(response) : response;
  }

  // radapi://local/api/v1/repos/<rid>[/section...]
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'repos' || !parts[3]) {
    return json({ error: 'not found' }, 404);
  }
  let rid;
  try {
    rid = decodeURIComponent(parts[3]);
  } catch {
    return json({ error: 'invalid RID encoding' }, 400);
  }
  const apiPath = parts.length > 4 ? `/${parts.slice(4).join('/')}` : '';
  return serveRepoApi(rid, apiPath, { method: request.method });
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

module.exports = { registerRadicleApiProtocol, handleRadicleApiRequest, serveRepoApi };
