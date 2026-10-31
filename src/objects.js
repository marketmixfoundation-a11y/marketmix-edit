// On-device object detection (EfficientDet-Lite0) used to keep chosen objects
// such as a laptop or a cup sharp inside the background-blur effect.

import { FilesetResolver, ObjectDetector } from '@mediapipe/tasks-vision';
import { toMediaUrl } from './store.js';
import { once, seekTo } from './video.js';

const BASE = new URL('./mediapipe', document.baseURI).toString().replace(/\/$/, '');
const MODEL = `${BASE}/efficientdet_lite0.tflite`;
const MIN_SCORE = 0.35;
const IGNORED = new Set(['person']);

let pending = null;
let lastTs = 0;

async function load() {
  const fileset = await FilesetResolver.forVisionTasks(BASE, false);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: 'VIDEO',
    scoreThreshold: MIN_SCORE,
    maxResults: 10,
  });
  try {
    return await ObjectDetector.createFromOptions(fileset, options('GPU'));
  } catch {
    return ObjectDetector.createFromOptions(fileset, options('CPU'));
  }
}

export function getDetector() {
  if (!pending) {
    pending = load().catch((e) => {
      pending = null;
      throw e;
    });
  }
  return pending;
}

export function nextTimestamp() {
  lastTs = Math.max(performance.now(), lastTs + 1);
  return lastTs;
}

// Returns [{ label, score, box: {x,y,w,h} }] with box coordinates normalized to the frame.
export function detectFrame(detector, video) {
  const res = detector.detectForVideo(video, nextTimestamp());
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const out = [];
  for (const d of res?.detections || []) {
    const c = d.categories?.[0];
    const b = d.boundingBox;
    if (!c || !b) continue;
    out.push({
      label: c.categoryName || 'object',
      score: c.score ?? 0,
      box: { x: b.originX / vw, y: b.originY / vh, w: b.width / vw, h: b.height / vh },
    });
  }
  return out;
}

export function keptBoxes(detections, labels) {
  if (!labels || !labels.length) return [];
  const wanted = new Set(labels);
  return detections.filter((d) => wanted.has(d.label)).map((d) => d.box);
}

// Samples a clip and counts the object classes found, for the "Scan clip" picker.
export async function scanClip(media, clip, samples = 5) {
  const detector = await getDetector();
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = toMediaUrl(media.path);
  await once(video, 'loadeddata');
  const counts = new Map();
  try {
    const len = Math.max(0.1, clip.out - clip.in);
    for (let i = 0; i < samples; i++) {
      await seekTo(video, clip.in + (len * (i + 0.5)) / samples);
      const found = new Set();
      for (const d of detectFrame(detector, video)) {
        if (!IGNORED.has(d.label)) found.add(d.label);
      }
      for (const label of found) counts.set(label, (counts.get(label) || 0) + 1);
    }
  } finally {
    video.removeAttribute('src');
    video.load();
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}
