const { contextBridge, ipcRenderer } = require('electron');
const IPC = require('../shared/ipc-channels');

contextBridge.exposeInMainWorld('freedomShellCanvas', {
  onState: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const listener = (_event, state) => callback(state);
    ipcRenderer.on(IPC.SHELL_CANVAS_STATE, listener);
    return () => ipcRenderer.removeListener(IPC.SHELL_CANVAS_STATE, listener);
  },
});
