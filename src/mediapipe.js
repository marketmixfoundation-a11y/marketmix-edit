import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

const BASE = new URL('./mediapipe', document.baseURI).toString().replace(/\/$/, '');
const MODEL = `${BASE}/selfie_segmenter.tflite`;

let pending = null;

async function load() {
  const fileset = await FilesetResolver.forVisionTasks(BASE, false);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: 'VIDEO',
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  });
  try {
    return await ImageSegmenter.createFromOptions(fileset, options('GPU'));
  } catch {
    return ImageSegmenter.createFromOptions(fileset, options('CPU'));
  }
}

export function getSegmenter() {
  if (!pending) {
    pending = load().catch((e) => {
      pending = null;
      throw e;
    });
  }
  return pending;
}
