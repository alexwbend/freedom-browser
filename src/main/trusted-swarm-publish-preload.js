const { contextBridge, ipcRenderer } = require('electron');

const CHANNEL_PREFIX = 'trusted-swarm-publish-surface';

function getSurfaceId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('surfaceId') || '';
}

function channelFor(kind) {
  return `${CHANNEL_PREFIX}:${kind}:${getSurfaceId()}`;
}

contextBridge.exposeInMainWorld('freedomAPI', {
  copyText: (text) => ipcRenderer.invoke(channelFor('copy-text'), text),
  openInNewTab: (url) => ipcRenderer.invoke(channelFor('open-in-new-tab'), url),
  swarm: {
    publishData: (data) => ipcRenderer.invoke(channelFor('publish-data'), data),
    publishFilePath: (filePath) => ipcRenderer.invoke(channelFor('publish-file'), filePath),
    publishDirectoryPath: (dirPath) =>
      ipcRenderer.invoke(channelFor('publish-directory'), dirPath),
    getUploadStatus: (tagUid) => ipcRenderer.invoke(channelFor('get-upload-status'), tagUid),
    getStamps: () => ipcRenderer.invoke(channelFor('get-stamps')),
    pickFileForPublish: () => ipcRenderer.invoke(channelFor('pick-file')),
    pickDirectoryForPublish: () => ipcRenderer.invoke(channelFor('pick-directory')),
    getPublishHistory: () => ipcRenderer.invoke(channelFor('get-publish-history')),
    clearPublishHistory: () => ipcRenderer.invoke(channelFor('clear-publish-history')),
  },
});
