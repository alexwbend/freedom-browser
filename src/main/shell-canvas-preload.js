const { contextBridge, ipcRenderer } = require('electron');

const SHELL_CANVAS_COMMAND = 'shell-canvas:command';
const SHELL_CANVAS_READY = 'shell-canvas:ready';
const SHELL_CANVAS_STATE = 'shell-canvas:state';

contextBridge.exposeInMainWorld('freedomShellCanvas', {
  ready: () => {
    ipcRenderer.send(SHELL_CANVAS_READY);
  },
  command: (command, payload = null) => {
    return ipcRenderer.invoke(SHELL_CANVAS_COMMAND, { command, payload });
  },
  onState: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const listener = (_event, state) => callback(state);
    ipcRenderer.on(SHELL_CANVAS_STATE, listener);
    return () => ipcRenderer.removeListener(SHELL_CANVAS_STATE, listener);
  },
});

module.exports = {
  SHELL_CANVAS_COMMAND,
  SHELL_CANVAS_READY,
  SHELL_CANVAS_STATE,
};
