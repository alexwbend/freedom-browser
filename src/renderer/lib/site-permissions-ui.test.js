// tabs.js reads `window` at module scope (heavy chrome-DOM import chain);
// these helper tests only exercise the pure label/phrase functions.
jest.mock('./tabs.js', () => ({
  getActiveWebview: jest.fn(() => null),
  getDisplayUrlForWebview: jest.fn(() => ''),
}));

import {
  permissionLabel,
  describePermissionRequest,
  permissionRequestNote,
} from './site-permissions-ui.js';

describe('site-permissions-ui helpers', () => {
  describe('permissionLabel', () => {
    test('maps storage keys to human labels', () => {
      expect(permissionLabel('camera')).toBe('Camera');
      expect(permissionLabel('microphone')).toBe('Microphone');
      expect(permissionLabel('notifications')).toBe('Notifications');
      expect(permissionLabel('clipboard-read')).toBe('Clipboard reading');
      expect(permissionLabel('geolocation')).toBe('Location');
      expect(permissionLabel('midi')).toBe('MIDI devices');
    });

    test('falls back to the raw key for unknown permissions', () => {
      expect(permissionLabel('somefuturething')).toBe('somefuturething');
    });
  });

  describe('describePermissionRequest', () => {
    test('names single devices', () => {
      expect(describePermissionRequest(['camera'])).toBe('use your camera');
      expect(describePermissionRequest(['microphone'])).toBe('use your microphone');
      expect(describePermissionRequest(['notifications'])).toBe('show notifications');
      expect(describePermissionRequest(['clipboard-read'])).toBe(
        'read text and images from your clipboard'
      );
      expect(describePermissionRequest(['geolocation'])).toBe('know your location');
      expect(describePermissionRequest(['midi'])).toBe('use your MIDI devices');
    });

    test('collapses camera + microphone into one phrase', () => {
      expect(describePermissionRequest(['camera', 'microphone'])).toBe(
        'use your camera and microphone'
      );
      expect(describePermissionRequest(['microphone', 'camera'])).toBe(
        'use your camera and microphone'
      );
    });

    test('deduplicates keys and joins the rest with "and"', () => {
      expect(describePermissionRequest(['camera', 'camera'])).toBe('use your camera');
      expect(describePermissionRequest(['notifications', 'geolocation'])).toBe(
        'show notifications and know your location'
      );
    });

    test('has a safe fallback for empty input', () => {
      expect(describePermissionRequest([])).toBe('use a device');
      expect(describePermissionRequest()).toBe('use a device');
    });
  });

  describe('permissionRequestNote', () => {
    test('geolocation carries the reliability caveat', () => {
      expect(permissionRequestNote(['geolocation'])).toMatch(/may not work reliably/);
    });

    test('other permissions carry no note', () => {
      expect(permissionRequestNote(['camera'])).toBeNull();
      expect(permissionRequestNote([])).toBeNull();
    });
  });
});
