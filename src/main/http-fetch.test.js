/**
 * Tests for http-fetch dweb-scheme support.
 *
 * bzz:// / ipfs:// / ipns:// URLs can't go through Node's http stack —
 * they must be dispatched to the custom protocol handlers registered on
 * the default session via session.fetch. The http/https paths hit real
 * sockets and are not covered here.
 */

const { session } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { fetchBuffer, fetchToFile } = require('./http-fetch');

const okResponse = (body) => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => Uint8Array.from(Buffer.from(body)).buffer,
});

describe('http-fetch dweb schemes', () => {
  beforeEach(() => {
    session.defaultSession.fetch = jest.fn();
  });

  test('rejects unsupported schemes', async () => {
    await expect(fetchBuffer('file:///etc/passwd')).rejects.toThrow('Unsupported URL scheme: file');
    await expect(fetchToFile('javascript:alert(1)', '/tmp/x')).rejects.toThrow(
      'Unsupported URL scheme: javascript'
    );
    expect(session.defaultSession.fetch).not.toHaveBeenCalled();
  });

  test.each(['bzz', 'ipfs', 'ipns'])(
    'fetchBuffer routes %s:// through session.defaultSession.fetch',
    async (scheme) => {
      const url = `${scheme}://example.eth/images/pic.png`;
      session.defaultSession.fetch.mockResolvedValue(okResponse('image-bytes'));

      const result = await fetchBuffer(url);

      expect(session.defaultSession.fetch).toHaveBeenCalledWith(
        url,
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(result).toEqual(Buffer.from('image-bytes'));
    }
  );

  test('fetchBuffer rejects on non-OK dweb response', async () => {
    session.defaultSession.fetch.mockResolvedValue({ ok: false, status: 404 });

    await expect(fetchBuffer('bzz://example.eth/missing.png')).rejects.toThrow(
      'Failed to download: HTTP 404'
    );
  });

  test('fetchBuffer maps AbortError to a timeout error', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    session.defaultSession.fetch.mockRejectedValue(abortError);

    await expect(fetchBuffer('bzz://example.eth/slow.png')).rejects.toThrow('Request timed out');
  });

  test('fetchToFile writes dweb response body to the destination path', async () => {
    session.defaultSession.fetch.mockResolvedValue(okResponse('png-data'));
    const destPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'http-fetch-')), 'pic.png');

    try {
      await fetchToFile('bzz://freedombrowser.eth/images/pic.png', destPath);
      expect(fs.readFileSync(destPath, 'utf8')).toBe('png-data');
    } finally {
      fs.rmSync(path.dirname(destPath), { recursive: true, force: true });
    }
  });

  test('fetchToFile propagates dweb fetch failures without creating the file', async () => {
    session.defaultSession.fetch.mockResolvedValue({ ok: false, status: 503 });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'http-fetch-'));
    const destPath = path.join(dir, 'pic.png');

    try {
      await expect(fetchToFile('ipfs://bafy123/pic.png', destPath)).rejects.toThrow(
        'Failed to download: HTTP 503'
      );
      expect(fs.existsSync(destPath)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
