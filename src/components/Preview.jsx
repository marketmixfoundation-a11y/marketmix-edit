import React, { useEffect, useRef, useState } from 'react';
import { formatTime, toMediaUrl, videoLayout } from '../store.js';
import { drawBlurComposite, effectOf } from '../effects.js';
import { getSegmenter } from '../mediapipe.js';
import { detectFrame, getDetector, keptBoxes } from '../objects.js';

// Playback uses the wall clock as master; the <video>/<audio> elements are kept in sync with it.
const DRIFT = 0.25;

function syncMedia(el, url, localTime, playing, volume) {
  if (el.dataset.src !== url) {
    el.dataset.src = url;
    el.src = url;
  }
  el.volume = Math.max(0, Math.min(1, volume));
  if (el.readyState >= 1 && Math.abs(el.currentTime - localTime) > (playing ? DRIFT : 0.01)) el.currentTime = localTime;
  if (playing && el.paused) el.play().catch(() => {});
  if (!playing && !el.paused) el.pause();
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export default function Preview({ project, time, seekVer, playing, duration, onTime, onEnd, onTogglePlay, selection, brush, dispatch, frozen }) {
  const videoRef = useRef(null);
  const audioEls = useRef({});
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const segRef = useRef(null);
  const objRef = useRef(null);
  const objCacheRef = useRef(null);
  const lastTsRef = useRef(0);
  const lastRenderRef = useRef(0);
  const [scale, setScale] = React.useState(1);
  const [segState, setSegState] = useState('idle');
  const [segError, setSegError] = useState('');
  const [objState, setObjState] = useState('idle');
  const [objError, setObjError] = useState('');
  const mediaById = Object.fromEntries(project.media.map((m) => [m.id, m]));
  const layout = videoLayout(project.videoClips);
  const current = layout.find((l) => time >= l.start && time < l.end) || null;
  const currentEffect = current ? effectOf(current.clip) : null;
  const hasBlur = project.videoClips.some((c) => effectOf(c)?.type === 'bgblur');
  const needsObjects = project.videoClips.some((c) => {
    const e = effectOf(c);
    return e?.type === 'bgblur' && (e.keepObjects || []).length > 0;
  });
  const canPaint = !frozen && !playing && brush.mode !== 'off' && currentEffect?.type === 'bgblur';

  useEffect(() => {
    if (!hasBlur) return undefined;
    let alive = true;
    setSegState('loading');
    setSegError('');
    getSegmenter()
      .then((s) => {
        if (!alive) return;
        segRef.current = s;
        setSegState('ready');
      })
      .catch((e) => {
        if (!alive) return;
        setSegState('error');
        setSegError(e.message || String(e));
      });
    return () => {
      alive = false;
    };
  }, [hasBlur]);

  useEffect(() => {
    if (!needsObjects) return undefined;
    let alive = true;
    setObjState('loading');
    setObjError('');
    getDetector()
      .then((d) => {
        if (!alive) return;
        objRef.current = d;
        setObjState('ready');
      })
      .catch((e) => {
        if (!alive) return;
        setObjState('error');
        setObjError(e.message || String(e));
      });
    return () => {
      alive = false;
    };
  }, [needsObjects]);

  const apply = (t, isPlaying) => {
    const v = videoRef.current;
    const canvas = canvasRef.current;
    const cur = videoLayout(project.videoClips).find((l) => t >= l.start && t < l.end);
    if (cur && mediaById[cur.clip.mediaId]) {
      const c = cur.clip;
      v.style.visibility = 'visible';
      syncMedia(v, toMediaUrl(mediaById[c.mediaId].path), c.in + (t - cur.start), isPlaying, c.muted ? 0 : c.volume ?? 1);
    } else {
      v.style.visibility = 'hidden';
      if (!v.paused) v.pause();
    }
    project.audioClips.forEach((c) => {
      const el = audioEls.current[c.id];
      const m = mediaById[c.mediaId];
      if (!el || !m) return;
      const len = c.out - c.in;
      if (t >= c.start && t < c.start + len) syncMedia(el, toMediaUrl(m.path), c.in + (t - c.start), isPlaying, c.volume ?? 1);
      else if (!el.paused) el.pause();
    });

    const eff = cur ? effectOf(cur.clip) : null;
    v.style.filter = eff?.type === 'edges' ? `url(#mm-edge) contrast(${1 + (eff.strength ?? 6) / 4})` : 'none';

    if (eff?.type === 'bgblur' && segRef.current && v.readyState >= 2 && !frozen) {
      const now = Math.max(performance.now(), lastTsRef.current + 1);
      if (!isPlaying || now - lastRenderRef.current > 55) {
        lastRenderRef.current = now;
        lastTsRef.current = now;
        let objects = [];
        const labels = eff.keepObjects || [];
        if (labels.length && objRef.current) {
          try {
            const key = labels.join(',');
            const cache = objCacheRef.current;
            if (!cache || cache.clipId !== cur.clip.id || cache.key !== key || now - cache.at > 150) {
              objCacheRef.current = {
                clipId: cur.clip.id,
                key,
                at: now,
                boxes: keptBoxes(detectFrame(objRef.current, v), labels),
              };
            }
            objects = objCacheRef.current.boxes;
          } catch (e) {
            setObjState('error');
            setObjError(e.message || String(e));
          }
        }
        try {
          const res = segRef.current.segmentForVideo(v, now);
          if (res && res.categoryMask) {
            drawBlurComposite(canvas, v, eff, res.categoryMask, project.width, project.height, objects);
          }
        } catch (e) {
          setSegState('error');
          setSegError(e.message || String(e));
        }
      }
      canvas.style.display = 'block';
      v.style.opacity = '0';
      return;
    }
    canvas.style.display = 'none';
    v.style.opacity = '1';
  };

  // Paused: show the frame at `time`.
  useEffect(() => {
    if (!playing) apply(time, false);
  });

  // Playing: advance time with requestAnimationFrame.
  useEffect(() => {
    if (!playing) return undefined;
    const t0 = time;
    const wall0 = performance.now();
    let raf;
    const tick = () => {
      const t = t0 + (performance.now() - wall0) / 1000;
      if (t >= duration) {
        onTime(duration);
        onEnd();
        apply(duration, false);
        return;
      }
      apply(t, true);
      onTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Restart the loop when play state toggles, the user seeks (seekVer bumps) or the project changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, seekVer, project, duration]);

  // Scale text overlays from project pixels (e.g. 1280x720) to the on-screen stage.
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      if (stageRef.current) setScale(stageRef.current.clientWidth / project.width);
    });
    ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, [project.width]);

  const paintDown = (e) => {
    if (!canPaint || !current || e.button !== 0) return;
    e.preventDefault();
    const eff = effectOf(current.clip);
    const rect = e.currentTarget.getBoundingClientRect();
    const point = [clamp01((e.clientX - rect.left) / rect.width), clamp01((e.clientY - rect.top) / rect.height)];
    const base = eff.strokes || [];
    const stroke = { mode: brush.mode, radius: brush.size, points: [point] };
    dispatch({ type: 'beginGesture' });
    dispatch({ type: 'update', track: 'video', id: current.clip.id, patch: { effect: { ...eff, strokes: [...base, stroke] } }, transient: true });
    let last = point;
    const move = (ev) => {
      const p = [clamp01((ev.clientX - rect.left) / rect.width), clamp01((ev.clientY - rect.top) / rect.height)];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.003) return;
      last = p;
      stroke.points.push(p);
      dispatch({ type: 'update', track: 'video', id: current.clip.id, patch: { effect: { ...eff, strokes: [...base, stroke] } }, transient: true });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      dispatch({ type: 'endGesture' });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const texts = project.textClips.filter((c) => time >= c.start && time < c.start + c.duration);
  const keepCount = currentEffect?.type === 'bgblur' ? (currentEffect.keepObjects || []).length : 0;
  const stageStatus = currentEffect?.type !== 'bgblur'
    ? ''
    : segState === 'error'
      ? `Mask unavailable: ${segError}`
      : segState !== 'ready'
        ? 'Loading subject mask…'
        : keepCount && objState === 'error'
          ? `Object detection unavailable: ${objError}`
          : keepCount && objState !== 'ready'
            ? 'Loading object detection…'
            : '';

  return (
    <section className="panel preview">
      <svg className="mm-defs" aria-hidden="true" width="0" height="0">
        <defs>
          <filter id="mm-edge" x="-5%" y="-5%" width="110%" height="110%">
            <feColorMatrix type="saturate" values="0" result="g" />
            <feConvolveMatrix in="g" order="3" preserveAlpha="true" divisor="1" bias="0" targetX="1" targetY="1"
              kernelMatrix="0 -1 0 -1 4 -1 0 -1 0" result="e" />
            <feComponentTransfer in="e" result="c">
              <feFuncR type="linear" slope="2.6" />
              <feFuncG type="linear" slope="2.6" />
              <feFuncB type="linear" slope="2.6" />
            </feComponentTransfer>
            <feColorMatrix in="c" type="matrix" values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0" />
          </filter>
        </defs>
      </svg>
      <div className="stage-wrap">
        <div className="stage" ref={stageRef} style={{ aspectRatio: `${project.width} / ${project.height}`, width: `min(100cqw, calc(100cqh * ${project.width / project.height}))` }}>
          <video ref={videoRef} preload="auto" playsInline />
          <canvas ref={canvasRef} className="stage-canvas" onPointerDown={paintDown}
            style={{ display: 'none', pointerEvents: canPaint ? 'auto' : 'none', cursor: canPaint ? 'crosshair' : 'default' }} />
          {project.audioClips.map((c) => (
            <audio key={c.id} ref={(el) => { if (el) audioEls.current[c.id] = el; else delete audioEls.current[c.id]; }} preload="auto" />
          ))}
          {texts.map((t) => (
            <div key={t.id} className="overlay-text" style={{
              left: `${t.x * 100}%`, top: `${t.y * 100}%`, color: t.color,
              fontSize: `${t.size * scale}px`, textShadow: outline(Math.max(1, 2 * scale)),
            }}>{t.text}</div>
          ))}
          {stageStatus && <div className="stage-status">{stageStatus}</div>}
          {!project.videoClips.length && <div className="stage-empty">Import a video and add it to the timeline</div>}
        </div>
      </div>
      <div className="transport">
        <span className="tc">{formatTime(time)}</span>
        <button className="play" onClick={onTogglePlay} title="Space">{playing ? '❚❚' : '▶'}</button>
        <span className="tc dim">{formatTime(duration)}</span>
      </div>
    </section>
  );
}

// Black outline around preview text, matching FFmpeg drawtext's borderw.
function outline(w) {
  const s = [];
  for (let a = 0; a < 360; a += 45) {
    const r = (a * Math.PI) / 180;
    s.push(`${(Math.cos(r) * w).toFixed(2)}px ${(Math.sin(r) * w).toFixed(2)}px 0 #000`);
  }
  return s.join(',');
}
