// Minimal zero-dependency static file server for the navigator.freedom test
// site. Serves the files in this directory over http:// so the page can be
// loaded in Freedom Browser as an ordinary web origin (unlike the internal
// freedom://playground page) to exercise the injected providers end to end.
//
// Usage:
//   node test/freedom-api-demo/server.js       → http://127.0.0.1:8080/
//   PORT=3000 node test/freedom-api-demo/server.js
//   npm run serve:freedom-api-demo
//
// Stop with Ctrl+C.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';

// The page logic is shared with the internal freedom://playground page; serve
// the single canonical copy from src instead of duplicating it here.
const SHARED_SCRIPT_NAME = 'freedom-surface.js';
const SHARED_SCRIPT_PATH = path.join(
  ROOT,
  '../../src/renderer/pages/scripts/freedom-surface.js'
);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function sendError(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message + '\n');
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendError(res, 405, 'Method Not Allowed');
    return;
  }

  const urlPath = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
  const relPath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');

  let filePath;
  if (relPath === SHARED_SCRIPT_NAME) {
    // Canonical shared script lives in src/, outside ROOT — serve it explicitly.
    filePath = SHARED_SCRIPT_PATH;
  } else {
    filePath = path.join(ROOT, relPath);
    // Path-traversal guard: the resolved path must stay inside ROOT.
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
      sendError(res, 403, 'Forbidden');
      return;
    }
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      sendError(res, 404, 'Not Found');
      return;
    }
    const type =
      CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stats.size,
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`navigator.freedom test site → http://${HOST}:${PORT}/`);
  console.log('Open it in Freedom Browser and use the buttons to exercise the API.');
  console.log('Stop with Ctrl+C.');
});
