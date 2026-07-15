const { blake2b } = require('./blake2b');

describe('blake2b', () => {
  test('matches the RFC 7693 abc vector', () => {
    expect(Buffer.from(blake2b(Buffer.from('abc'), 64)).toString('hex')).toBe(
      'ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d' +
        '17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923'
    );
  });
});
