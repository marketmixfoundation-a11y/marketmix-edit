// Background-blur effect model + canvas compositor shared by preview and mask export.

export const DEFAULT_BLUR = 18;

export function effectOf(clip) {
  const e = clip && clip.effect;
  return e && e.type && e.type !== 'none' ? e : null;
}

export function makeEffect(type, prev) {
  if (type === 'bgblur') {
    return {
      type,
      blur: prev?.blur ?? DEFAULT_BLUR,
      edge: prev?.edge ?? 2,
      outline: prev?.outline ?? 0,
      outlineColor: prev?.outlineColor ?? '#ffd54a',
      strokes: prev?.strokes ?? [],
      keepObjects: prev?.keepObjects ?? [],
    };
  }
  if (type === 'edges') return { type, strength: prev?.strength ?? 6 };
  return { type: 'none' };
}

export function applyStrokes(ctx, strokes, w, h) {
  for (const s of strokes || []) {
    if (!s.points || !s.points.length) continue;
    ctx.save();
    ctx.globalCompositeOperation = s.mode === 'restore' ? 'source-over' : 'destination-out';
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = Math.max(1, s.radius * 2 * w);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const [x0, y0] = s.points[0];
    if (s.points.length === 1) {
      ctx.arc(x0 * w, y0 * h, Math.max(1, s.radius * w), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.moveTo(x0 * w, y0 * h);
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i][0] * w, s.points[i][1] * h);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// Paints detected object boxes into a grayscale frame mask so they stay sharp.
// Boxes are normalized to the video frame; the mask may be letterboxed inside W×H.
export function paintKeptObjects(ctx, boxes, video, W, H) {
  if (!boxes || !boxes.length) return;
  const vw = video.videoWidth || W;
  const vh = video.videoHeight || H;
  const s = Math.min(W / vw, H / vh);
  const dw = vw * s;
  const dh = vh * s;
  const ox = (W - dw) / 2;
  const oy = (H - dh) / 2;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#fff';
  ctx.filter = `blur(${Math.max(2, Math.round(W * 0.006))}px)`;
  for (const b of boxes) {
    const x = ox + Math.max(0, Math.min(1, b.x)) * dw;
    const y = oy + Math.max(0, Math.min(1, b.y)) * dh;
    const w = Math.max(0, Math.min(1, b.x + b.w) - Math.max(0, b.x)) * dw;
    const h = Math.max(0, Math.min(1, b.y + b.h) - Math.max(0, b.y)) * dh;
    const pad = Math.max(2, W * 0.01);
    ctx.beginPath();
    ctx.roundRect(x - pad, y - pad, w + pad * 2, h + pad * 2, Math.max(2, Math.min(w, h) * 0.15));
    ctx.fill();
  }
  ctx.restore();
}

export function maskToCanvas(mask, canvas, ctx) {
  const w = mask.width;
  const h = mask.height;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const data = mask.getAsUint8Array();
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = data[i] ? 0 : 255;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = v;
  }
  ctx.putImageData(img, 0, 0);
}

// Draw a source into a W×H frame preserving aspect (matching FFmpeg's scale+pad).
function drawContained(ctx, src, W, H) {
  const sw = src.videoWidth || src.width;
  const sh = src.videoHeight || src.height;
  if (!sw || !sh) return;
  const s = Math.min(W / sw, H / sh);
  const dw = sw * s;
  const dh = sh * s;
  ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

let bgCanvas = null;
let bgCtx = null;
let personCanvas = null;
let personCtx = null;
let maskCanvas = null;
let maskCtx = null;
let paddedMask = null;
let paddedMaskCtx = null;

function ensureCanvases(W, H, mw, mh) {
  if (!bgCanvas) {
    bgCanvas = document.createElement('canvas');
    bgCtx = bgCanvas.getContext('2d');
    personCanvas = document.createElement('canvas');
    personCtx = personCanvas.getContext('2d');
    maskCanvas = document.createElement('canvas');
    maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    paddedMask = document.createElement('canvas');
    paddedMaskCtx = paddedMask.getContext('2d');
  }
  for (const c of [bgCanvas, personCanvas, paddedMask]) {
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
  }
  if (maskCanvas.width !== mw || maskCanvas.height !== mh) {
    maskCanvas.width = mw;
    maskCanvas.height = mh;
  }
}

export function drawBlurComposite(outCanvas, video, effect, categoryMask, W, H, objects) {
  if (!outCanvas || !categoryMask) return;
  if (outCanvas.width !== W || outCanvas.height !== H) {
    outCanvas.width = W;
    outCanvas.height = H;
  }
  const mw = categoryMask.width;
  const mh = categoryMask.height;
  ensureCanvases(W, H, mw, mh);

  maskToCanvas(categoryMask, maskCanvas, maskCtx);

  const out = outCanvas.getContext('2d');

  bgCtx.save();
  bgCtx.clearRect(0, 0, W, H);
  bgCtx.fillStyle = '#000';
  bgCtx.fillRect(0, 0, W, H);
  bgCtx.filter = `blur(${Math.max(0, effect.blur ?? DEFAULT_BLUR)}px)`;
  drawContained(bgCtx, video, W, H);
  bgCtx.restore();

  paddedMaskCtx.clearRect(0, 0, W, H);
  drawContained(paddedMaskCtx, maskCanvas, W, H);
  paintKeptObjects(paddedMaskCtx, objects, video, W, H);
  applyStrokes(paddedMaskCtx, effect.strokes, W, H);

  personCtx.save();
  personCtx.clearRect(0, 0, W, H);
  drawContained(personCtx, video, W, H);
  personCtx.globalCompositeOperation = 'destination-in';
  personCtx.filter = effect.edge > 0 ? `blur(${effect.edge}px)` : 'none';
  personCtx.drawImage(paddedMask, 0, 0);
  personCtx.restore();

  out.clearRect(0, 0, W, H);
  out.drawImage(bgCanvas, 0, 0);
  if (effect.outline > 0) {
    out.save();
    out.filter = `drop-shadow(0 0 ${effect.outline}px ${effect.outlineColor || '#ffd54a'})`;
    out.drawImage(personCanvas, 0, 0);
    out.restore();
  }
  out.drawImage(personCanvas, 0, 0);
}
