const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  importMedia: () => ipcRenderer.invoke('media:import'),
  saveProject: (json) => ipcRenderer.invoke('project:save', json),
  openProject: () => ipcRenderer.invoke('project:open'),
  pickExportPath: () => ipcRenderer.invoke('export:pick'),
  exportTo: (project, file) => ipcRenderer.invoke('export:run', { project, file }),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  showInFolder: (file) => ipcRenderer.invoke('shell:show', file),
  onExportProgress: (cb) => {
    const handler = (_e, p) => cb(p);
    ipcRenderer.on('export:progress', handler);
    return () => ipcRenderer.removeListener('export:progress', handler);
  },
  maskBegin: (meta) => ipcRenderer.invoke('mask:begin', meta),
  maskChunk: (id, data) => ipcRenderer.invoke('mask:chunk', { id, data }),
  maskEnd: (id) => ipcRenderer.invoke('mask:end', id),
  maskCancel: (id) => ipcRenderer.invoke('mask:cancel', id),
});
