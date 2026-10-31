// Builds FFmpeg arguments for exporting a project to MP4.
// Pure module (no Electron imports) so it can be tested from plain Node.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
const ffprobePath = require('ffprobe-static').path.replace('app.asar', 'app.asar.unpacked');

const DEFAULT_FONT = 'C:/Windows/Fonts/arial.ttf';

// Escape a path for use as a quoted filter option value: C:/x -> 'C\:/x'
function filterPath(p) {
  return "'" + p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''") + "'";
}

const num = (n) => Number(n).toFixed(3);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n)));

function ffColor(c) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(c || '').trim());
  return m ? '0x' + m[1] : '0xffd54a';
}

function probe(file) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file];
    const p = spawn(ffprobePath, args, { windowsHide: true });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(err || `ffprobe exited with ${code}`));
      const info = JSON.parse(out);
      const streams = info.streams || [];
      const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
      const a = streams.find((s) => s.codec_type === 'audio');
      resolve({
        duration: parseFloat(info.format && info.format.duration) || 0,
        hasVideo: !!v,
        hasAudio: !!a,
        width: v ? v.width : 0,
        height: v ? v.height : 0,
      });
    });
  });
}

// project: { width, height, fps, media[], videoClips[], textClips[], audioClips[] }
function buildExportArgs(project, outFile, tmpDir) {
  const { width: W, height: H, fps } = project;
  const mediaById = Object.fromEntries(project.media.map((m) => [m.id, m]));
  const inputs = [];
  const filters = [];

  const clips = project.videoClips.filter((c) => mediaById[c.mediaId]);
  if (clips.length === 0) throw new Error('The video track is empty.');

  const blurClips = clips.filter((c) => c.mask && c.effect && c.effect.type === 'bgblur');

  // Main (video) track inputs, followed by one raw grayscale mask input per blurred clip.
  clips.forEach((clip) => inputs.push('-i', mediaById[clip.mediaId].path));
  const maskIndex = {};
  blurClips.forEach((clip, k) => {
    maskIndex[clip.id] = clips.length + k;
    inputs.push(
      '-f', 'rawvideo', '-pixel_format', 'gray',
      '-video_size', `${clip.mask.width}x${clip.mask.height}`,
      '-framerate', String(fps),
      '-i', clip.mask.path
    );
  });

  // Per-clip visual chain: trim, normalize size/fps, then optional effect.
  clips.forEach((clip, i) => {
    const dur = clip.out - clip.in;
    const eff = clip.effect && clip.effect.type !== 'none' ? clip.effect : null;
    const base =
      `trim=start=${num(clip.in)}:end=${num(clip.out)},setpts=PTS-STARTPTS,` +
      `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps}`;

    if (eff?.type === 'bgblur' && maskIndex[clip.id] !== undefined) {
      const mi = maskIndex[clip.id];
      const blur = clamp(eff.blur ?? 18, 0, 50);
      const feather = clamp(eff.edge ?? 0, 0, 10);
      const outline = clamp(eff.outline ?? 0, 0, 10);
      filters.push(`[${i}:v]${base}[b${i}]`);
      filters.push(`[b${i}]split[s${i}][g${i}]`);
      filters.push(
        blur > 0.1
          ? `[g${i}]gblur=sigma=${blur.toFixed(2)},format=yuv420p[gb${i}]`
          : `[g${i}]format=yuv420p[gb${i}]`
      );
      filters.push(
        `[${mi}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
          `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black` +
          (feather > 0.01 ? `,gblur=sigma=${feather.toFixed(2)}` : '') +
          `,format=gray[m${i}]`
      );
      const hasOutline = outline > 0.1;
      const maskMain = hasOutline ? `mm${i}` : `m${i}`;
      if (hasOutline) filters.push(`[m${i}]split[mm${i}][mo${i}]`);
      filters.push(`[s${i}]format=yuva420p[sa${i}]`);
      filters.push(`[sa${i}][${maskMain}]alphamerge[fg${i}]`);
      filters.push(`[gb${i}][fg${i}]overlay=format=auto[c${i}]`);
      if (hasOutline) {
        const r = Math.max(1, outline);
        filters.push(`[mo${i}]split[ma${i}][mb${i}]`);
        filters.push(`[mb${i}]gblur=sigma=${r.toFixed(2)},lutyuv=y='if(gt(val,170),255,0)'[me${i}]`);
        filters.push(`[ma${i}][me${i}]blend=all_mode=difference,boxblur=1[mr${i}]`);
        filters.push(
          `color=c=${ffColor(eff.outlineColor)}:s=${W}x${H}:r=${fps}:d=${num(dur)}[mw${i}]`
        );
        filters.push(`[mw${i}][mr${i}]alphamerge[mra${i}]`);
        filters.push(`[c${i}][mra${i}]overlay=format=auto,format=yuv420p[v${i}]`);
      } else {
        filters.push(`[c${i}]format=yuv420p[v${i}]`);
      }
    } else if (eff?.type === 'edges') {
      const strength = clamp(eff.strength ?? 6, 1, 10);
      const high = (0.45 - strength * 0.03).toFixed(3);
      filters.push(
        `[${i}:v]${base},format=gray,edgedetect=low=0.05:high=${high},negate,format=yuv420p[v${i}]`
      );
    } else {
      filters.push(`[${i}:v]${base},format=yuv420p[v${i}]`);
    }

    const vol = clip.volume ?? 1;
    if (mediaById[clip.mediaId].hasAudio && !clip.muted) {
      filters.push(
        `[${i}:a]atrim=start=${num(clip.in)}:end=${num(clip.out)},asetpts=PTS-STARTPTS,` +
          `volume=${vol},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`
      );
    } else {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${num(dur)},aformat=sample_fmts=fltp[a${i}]`);
    }
  });
  filters.push(clips.map((_, i) => `[v${i}][a${i}]`).join('') + `concat=n=${clips.length}:v=1:a=1[vcat][acat]`);
  const total = clips.reduce((s, c) => s + (c.out - c.in), 0);

  // Text overlays.
  let vLabel = 'vcat';
  project.textClips.forEach((t, i) => {
    const txtFile = path.join(tmpDir, `text_${i}.txt`);
    fs.writeFileSync(txtFile, t.text, 'utf8');
    const color = (t.color || '#ffffff').replace('#', '0x');
    const next = `vt${i}`;
    filters.push(
      `[${vLabel}]drawtext=fontfile=${filterPath(t.font || DEFAULT_FONT)}:textfile=${filterPath(txtFile)}:` +
        `expansion=none:fontsize=${Math.round(t.size || 48)}:fontcolor=${color}:borderw=2:bordercolor=black:` +
        `x=(w*${num(t.x ?? 0.5)})-text_w/2:y=(h*${num(t.y ?? 0.85)})-text_h/2:` +
        `enable='between(t,${num(t.start)},${num(t.start + t.duration)})'[${next}]`
    );
    vLabel = next;
  });

  // Music track: delay each clip to its timeline position and mix with the main audio.
  const music = project.audioClips.filter((c) => mediaById[c.mediaId]);
  const mixLabels = ['[acat]'];
  music.forEach((c, j) => {
    const idx = clips.length + blurClips.length + j;
    inputs.push('-i', mediaById[c.mediaId].path);
    const delay = Math.round(c.start * 1000);
    filters.push(
      `[${idx}:a]atrim=start=${num(c.in)}:end=${num(c.out)},asetpts=PTS-STARTPTS,volume=${c.volume ?? 1},` +
        `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${delay}|${delay}[m${j}]`
    );
    mixLabels.push(`[m${j}]`);
  });
  let aLabel = 'acat';
  if (music.length) {
    filters.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:normalize=0[amix]`);
    aLabel = 'amix';
  }

  const args = [
    '-y', '-hide_banner',
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', `[${vLabel}]`, '-map', `[${aLabel}]`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-t', num(total),
    '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats',
    outFile,
  ];
  return { args, total };
}

// Runs the export; onProgress receives a 0..1 fraction. Returns { promise, cancel }.
function runExport(project, outFile, onProgress) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-'));
  const { args, total } = buildExportArgs(project, outFile, tmpDir);
  const proc = spawn(ffmpegPath, args, { windowsHide: true });
  let log = '';
  const promise = new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => {
      const m = /out_time_us=(\d+)/.exec(d.toString());
      if (m && total > 0) onProgress?.(Math.min(1, Number(m[1]) / 1e6 / total));
    });
    proc.stderr.on('data', (d) => {
      log += d;
      if (log.length > 20000) log = log.slice(-20000);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      if (code === 0) {
        onProgress?.(1);
        resolve(outFile);
      } else {
        reject(new Error(`FFmpeg failed (code ${code}):\n${log.slice(-3000)}`));
      }
    });
  });
  return { promise, cancel: () => proc.kill('SIGKILL') };
}

module.exports = { ffmpegPath, ffprobePath, probe, buildExportArgs, runExport };
