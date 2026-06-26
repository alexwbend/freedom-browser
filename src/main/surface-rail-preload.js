const { contextBridge, ipcRenderer } = require('electron');

const SHELL_SURFACE_RAIL_COMMAND = 'shell-surface-rail:command';
const SHELL_SURFACE_RAIL_STATE = 'shell-surface-rail:state';

contextBridge.exposeInMainWorld('freedomSurfaceRail', {
  command: (command, payload = {}) =>
    ipcRenderer.invoke(SHELL_SURFACE_RAIL_COMMAND, {
      command,
      payload,
    }),
  onState: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const listener = (_event, state) => callback(state);
    ipcRenderer.on(SHELL_SURFACE_RAIL_STATE, listener);
    return () => ipcRenderer.removeListener(SHELL_SURFACE_RAIL_STATE, listener);
  },
});
