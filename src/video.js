// Small helpers for driving hidden <video> elements frame by frame.

export function once(target, event) {
  return new Promise((resolve, reject) => {
    const ok = () => {
      cleanup();
      resolve();
    };
    const bad = () => {
      cleanup();
      reject(target.error || new Error(`video ${event} failed`));
    };
    const cleanup = () => {
      target.removeEventListener(event, ok);
      target.removeEventListener('error', bad);
    };
    target.addEventListener(event, ok);
    target.addEventListener('error', bad);
  });
}

export function seekTo(video, time) {
  return new Promise((resolve, reject) => {
    const target = Math.max(0, Math.min(time, (video.duration || time) - 0.001));
    if (Math.abs(video.currentTime - target) < 0.0005) return resolve();
    const ok = () => {
      cleanup();
      resolve();
    };
    const bad = () => {
      cleanup();
      reject(video.error || new Error('video seek failed'));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', ok);
      video.removeEventListener('error', bad);
    };
    video.addEventListener('seeked', ok);
    video.addEventListener('error', bad);
    video.currentTime = target;
  });
}
