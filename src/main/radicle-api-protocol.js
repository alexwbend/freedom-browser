/**
 * Embedded Radicle API serving — the subset of radicle-httpd's REST API
 * that Freedom consumes, backed by the in-process node
 * (radicle-embedded.js) instead of a localhost HTTP daemon.
 *
 * Two consumers share `serveRepoApi`:
 *  - the `radapi:` scheme registered here, fetched by the internal
 *    rad-browser.html page (its `base` param becomes `radapi://local`);
 *  - the `rad:` scheme handler (radicle/rad-protocol.js), which serves
 *    dweb pages and short-circuits to this module in embedded mode
 *    instead of proxying to httpd.
 *
 * Served repo endpoints:
 *   (root)              → repo metadata (httpd `GET /api/v1/repos/:rid` shape)
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

/**
 * Serve one repo-scoped API path from the embedded node.
 * @param {string} rid - Full RID with rad: prefix (validated here)
 * @param {string} apiPath - Path under the repo root, e.g. '' or
 *   '/tree/<sha>/src' or '/blob/<sha>/README.md' (URL-encoded segments ok)
 * @returns {Promise<Response>}
 */
async function serveRepoApi(rid, apiPath) {
  if (!RID_RE.test(rid)) {
    return json({ error: 'invalid RID' }, 400);
  }
  const parts = (apiPath || '').split('/').filter(Boolean);
  const section = parts[0] || null;
  // Sections carry an informational commit SHA segment: tree/SHA[/path...],
  // blob/SHA/path..., readme/SHA, stats/tree/SHA.
  const rest = parts.slice(2).map(decodeURIComponent).join('/');

  try {
    if (!section) {
      return json(await embedded.buildRepoMeta(rid));
    }
    switch (section) {
      case 'tree':
        return json(await embedded.tree(rid, rest));
      case 'blob': {
        if (!rest) return json({ error: 'missing path' }, 400);
        return json(await embedded.blob(rid, rest));
      }
      case 'readme': {
        const readme = await embedded.readme(rid);
        return readme ? json(readme) : json({ error: 'no readme' }, 404);
      }
      case 'stats':
        return json({});
      case 'remotes':
        return json([]);
      default:
        return json({ error: `unsupported endpoint: ${section}` }, 404);
    }
  } catch (err) {
    const missing = /not found|does not exist|NotFound/i.test(err.message);
    if (!missing) {
      log.warn('[radapi]', rid, apiPath, '→', err.message);
    }
    return json({ error: err.message }, missing ? 404 : 500);
  }
}

async function handle(request) {
  const url = new URL(request.url);
  // radapi://local/api/v1/repos/<rid>[/section...]
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'repos' || !parts[3]) {
    return json({ error: 'not found' }, 404);
  }
  const rid = decodeURIComponent(parts[3]);
  const apiPath = parts.length > 4 ? `/${parts.slice(4).join('/')}` : '';
  return serveRepoApi(rid, apiPath);
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
  targetSession.protocol.handle('radapi', (request) => handle(request));
  log.info('[radapi] Protocol handler registered');
}

module.exports = { registerRadicleApiProtocol, serveRepoApi };
