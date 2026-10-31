// Renders per-frame subject masks for clips using the background-blur effect.
// Frames are streamed to the main process as raw 8-bit grayscale (one byte per pixel).

import { applyStrokes, effectOf, paintKeptObjects } from './effects.js';
import { getSegmenter } from './mediapipe.js';
import { detectFrame, getDetector, keptBoxes } from './objects.js';
import { toMediaUrl } from './store.js';
import { once, seekTo } from './video.js';

const MASK_WIDTH = 320;

export async function buildMasks(project, onProgress, isCanceled) {
  const clips = project.videoClips.filter((c) => effectOf(c)?.type === 'bgblur' && c.mediaId);
  if (!clips.length) return {};

  const segmenter = await getSegmenter();
  const needsObjects = clips.some((c) => (c.effect?.keepObjects || []).length);
  let detector = null;
  if (needsObjects) {
    try {
      detector = await getDetector();
    } catch {
      detector = null;
    }
  }
  const fps = project.fps || 30;
  const result = {};

  for (let ci = 0; ci < clips.length; ci++) {
    const clip = clips[ci];
    const media = project.media.find((m) => m.id === clip.mediaId);
    if (!media) continue;

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = toMediaUrl(media.path);
    await once(video, 'loadeddata');

    const mw = MASK_WIDTH;
    const mh = Math.max(2, Math.round((MASK_WIDTH * (video.videoHeight || project.height)) / (video.videoWidth || project.width) / 2) * 2);

    const segCanvas = document.createElement('canvas');
    const segCtx = segCanvas.getContext('2d', { willReadFrequently: true });
    const outCanvas = document.createElement('canvas');
    outCanvas.width = mw;
    outCanvas.height = mh;
    const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });

    const jobId = await window.api.maskBegin({ width: mw, height: mh, fps });
    const frames = Math.max(1, Math.round((clip.out - clip.in) * fps));
    let closed = false;

    try {
      for (let i = 0; i < frames; i++) {
        if (isCanceled && isCanceled()) {
          await window.api.maskCancel(jobId);
          closed = true;
          throw new Error('canceled');
        }
        await seekTo(video, clip.in + i / fps);
        const res = segmenter.segmentForVideo(video, performance.now() + i);
        const mask = res && res.categoryMask;
        if (!mask) throw new Error('Segmentation indisponible');
        const maskW = mask.width;
        const maskH = mask.height;
        if (segCanvas.width !== maskW || segCanvas.height !== maskH) {
          segCanvas.width = maskW;
          segCanvas.height = maskH;
        }
        const data = mask.getAsUint8Array();
        const img = segCtx.createImageData(maskW, maskH);
        for (let k = 0; k < maskW * maskH; k++) {
          const v = data[k] ? 0 : 255;
          img.data[k * 4] = v;
          img.data[k * 4 + 1] = v;
          img.data[k * 4 + 2] = v;
          img.data[k * 4 + 3] = v;
        }
        segCtx.putImageData(img, 0, 0);

        outCtx.clearRect(0, 0, mw, mh);
        outCtx.drawImage(segCanvas, 0, 0, mw, mh);
        const labels = clip.effect.keepObjects || [];
        if (detector && labels.length) {
          try {
            paintKeptObjects(outCtx, keptBoxes(detectFrame(detector, video), labels), video, mw, mh);
          } catch {
            /* keep the person mask if a detection frame fails */
          }
        }
        applyStrokes(outCtx, clip.effect.strokes, mw, mh);
        const px = outCtx.getImageData(0, 0, mw, mh).data;
        const gray = new Uint8Array(mw * mh);
        for (let k = 0; k < gray.length; k++) gray[k] = px[k * 4];
        await window.api.maskChunk(jobId, gray);

        onProgress?.((ci + (i + 1) / frames) / clips.length);
      }
      result[clip.id] = await window.api.maskEnd(jobId);
      closed = true;
    } finally {
      if (!closed) {
        try {
          await window.api.maskEnd(jobId);
        } catch {
          /* already closed */
        }
      }
      video.removeAttribute('src');
      video.load();
    }
  }
  return result;
}
