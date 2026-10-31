const { app, BrowserWindow, ipcMain, dialog, shell, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Readable } = require('stream');
const { probe, runExport } = require('./ffmpeg.cjs');

const VIDEO_EXT = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'];
const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'];
const MEDIA_EXT = [...VIDEO_EXT, ...AUDIO_EXT];

const DIST = path.join(__dirname, '..', 'dist');
const ICON = path.join(__dirname, '..', 'assets', 'icon.png');

app.setName('MarketMix Edit');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.tflite': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

let win;
let currentExport = null;
const maskJobs = new Map();
let maskSeq = 0;

function serveBundle(req) {
  const url = new URL(req.url);
  let rel = decodeURIComponent(url.pathname);
  if (!rel || rel === '/') rel = '/index.html';
  rel = rel.replace(/^\/+/, '');
  const file = path.normalize(path.join(DIST, rel));
  if (path.relative(DIST, file).startsWith('..')) return new Response('Forbidden', { status: 403 });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response('Not found', { status: 404 });
  const data = fs.readFileSync(file);
  return new Response(data, {
    headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' },
  });
}

function serveMedia(req) {
  const url = new URL(req.url);
  const file = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  const ext = path.extname(file).toLowerCase();
  if (!file || !MEDIA_EXT.includes(ext.slice(1)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return new Response('Not found', { status: 404 });
  }
  const size = fs.statSync(file).size;
  const type = MIME[ext] || 'application/octet-stream';
  const range = req.headers.get('range');
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? Number(m[1]) : 0;
    let end = m && m[2] ? Number(m[2]) : size - 1;
    if (!m) return new Response('Bad range', { status: 416, headers: { 'content-range': `bytes */${size}` } });
    if (!m[1] && m[2]) {
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    }
    if (start >= size) return new Response('', { status: 416, headers: { 'content-range': `bytes */${size}` } });
    end = Math.min(end, size - 1);
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
      status: 206,
      headers: {
        'content-type': type,
        'accept-ranges': 'bytes',
        'content-length': String(end - start + 1),
        'content-range': `bytes ${start}-${end}/${size}`,
      },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), {
    headers: { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': String(size) },
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#141416',
    title: 'MarketMix Edit',
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL('app://bundle/index.html');
  if (process.env.FVE_SMOKE) {
    win.webContents.once('did-finish-load', () => require('./smoke.cjs')(win, app, process.env.FVE_SMOKE));
  }
}

ipcMain.handle('media:import', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Import media',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Media', extensions: [...VIDEO_EXT, ...AUDIO_EXT] },
      { name: 'Video', extensions: VIDEO_EXT },
      { name: 'Audio', extensions: AUDIO_EXT },
    ],
  });
  if (res.canceled) return [];
  const items = [];
  for (const file of res.filePaths) {
    try {
      const info = await probe(file);
      items.push({ path: file, name: path.basename(file), type: info.hasVideo ? 'video' : 'audio', ...info });
    } catch (e) {
      items.push({ path: file, name: path.basename(file), error: e.message });
    }
  }
  return items;
});

ipcMain.handle('project:save', async (_e, json) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Save project',
    defaultPath: 'project.fve.json',
    filters: [{ name: 'Project', extensions: ['json'] }],
  });
  if (res.canceled) return null;
  fs.writeFileSync(res.filePath, json, 'utf8');
  return res.filePath;
});

ipcMain.handle('project:open', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Open project',
    properties: ['openFile'],
    filters: [{ name: 'Project', extensions: ['json'] }],
  });
  if (res.canceled) return null;
  return fs.readFileSync(res.filePaths[0], 'utf8');
});

ipcMain.handle('export:pick', async () => {
  if (process.env.FVE_EXPORT_PATH) return process.env.FVE_EXPORT_PATH;
  const res = await dialog.showSaveDialog(win, {
    title: 'Export video',
    defaultPath: 'export.mp4',
    filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
  });
  return res.canceled ? null : res.filePath;
});

ipcMain.handle('export:run', async (_e, { project, file }) => {
  try {
    currentExport = runExport(project, file, (p) => win.webContents.send('export:progress', p));
    await currentExport.promise;
    return { ok: true, file };
  } catch (e) {
    if (currentExport?.canceled) return { canceled: true };
    return { ok: false, error: e.message };
  } finally {
    currentExport = null;
    cleanupMasks();
  }
});

ipcMain.handle('export:cancel', () => {
  if (!currentExport) return;
  currentExport.canceled = true;
  currentExport.cancel();
});

ipcMain.handle('shell:show', (_e, file) => shell.showItemInFolder(file));

ipcMain.handle('mask:begin', (_e, { width, height, fps }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-mask-'));
  const file = path.join(dir, 'mask.gray');
  const fd = fs.openSync(file, 'w');
  const id = `mask-${++maskSeq}`;
  maskJobs.set(id, { id, dir, file, fd, width, height, fps, bytes: 0, closed: false });
  return id;
});

ipcMain.handle('mask:chunk', (_e, { id, data }) => {
  const job = maskJobs.get(id);
  if (!job || job.closed) throw new Error('mask job closed');
  let buf;
  if (Buffer.isBuffer(data)) buf = data;
  else if (data instanceof ArrayBuffer) buf = Buffer.from(data);
  else if (ArrayBuffer.isView(data)) buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  else throw new Error('invalid mask chunk');
  fs.writeSync(job.fd, buf);
  job.bytes += buf.length;
  return true;
});

ipcMain.handle('mask:end', (_e, id) => {
  const job = maskJobs.get(id);
  if (!job) return null;
  if (!job.closed) {
    fs.closeSync(job.fd);
    job.closed = true;
  }
  return { path: job.file, width: job.width, height: job.height };
});

ipcMain.handle('mask:cancel', (_e, id) => {
  const job = maskJobs.get(id);
  if (!job) return;
  try {
    if (!job.closed) fs.closeSync(job.fd);
  } catch {
    /* ignore */
  }
  job.closed = true;
});

function cleanupMasks() {
  for (const job of maskJobs.values()) {
    try {
      if (!job.closed) fs.closeSync(job.fd);
      fs.rmSync(job.dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  maskJobs.clear();
}

app.on('before-quit', cleanupMasks);

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    let host;
    try {
      host = new URL(req.url).host;
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    if (host === 'bundle') return serveBundle(req);
    if (host === 'media') return serveMedia(req);
    return new Response('Not found', { status: 404 });
  });
  createWindow();
});

app.on('window-all-closed', () => app.quit());
