import React, { useState } from 'react';
import { formatTime } from '../store.js';
import { effectOf, makeEffect } from '../effects.js';
import { scanClip } from '../objects.js';

function Num({ label, value, onChange, step = 0.1, min, max }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={Number(value.toFixed(2))} step={step} min={min} max={max}
        onChange={(e) => e.target.value !== '' && onChange(Number(e.target.value))} />
    </label>
  );
}

function Slider({ label, value, onChange, min = 0, max = 1, step = 0.01, fmt = (v) => v }) {
  return (
    <label className="field">
      <span>{label} <b>{fmt(value)}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export default function Inspector({ project, selection, dispatch, brush, setBrush }) {
  const track = selection?.track;
  const list = track === 'video' ? project.videoClips : track === 'text' ? project.textClips : track === 'audio' ? project.audioClips : [];
  const clip = list.find((c) => c.id === selection?.id);
  const set = (patch) => dispatch({ type: 'update', track, id: clip.id, patch });
  const media = clip?.mediaId && project.media.find((m) => m.id === clip.mediaId);
  const pct = (v) => `${Math.round(v * 100)}%`;
  const effect = clip && track === 'video' ? effectOf(clip) : null;
  const effectType = clip?.effect?.type || 'none';
  const setEffect = (patch) => set({ effect: { ...(clip.effect || { type: 'bgblur' }), ...patch } });
  const [scan, setScan] = useState({ clipId: null, busy: false, items: null, error: '' });

  const kept = effect?.keepObjects || [];
  const scanItems = clip && scan.clipId === clip.id ? scan.items || [] : [];
  const labels = [...new Set([...scanItems.map((i) => i.label), ...kept])];
  const scanHint = scan.busy
    ? 'Looking for objects…'
    : scan.clipId === clip?.id && scan.items
      ? 'No objects detected in this clip.'
      : 'Scan the clip to keep objects like a laptop or a cup sharp.';

  const runScan = async () => {
    if (!media) return;
    setScan({ clipId: clip.id, busy: true, items: scanItems, error: '' });
    try {
      const items = await scanClip(media, clip);
      setScan({ clipId: clip.id, busy: false, items, error: '' });
    } catch (e) {
      setScan({ clipId: clip.id, busy: false, items: null, error: e.message || String(e) });
    }
  };

  const toggleKeep = (label) => {
    const next = kept.includes(label) ? kept.filter((l) => l !== label) : [...kept, label];
    setEffect({ keepObjects: next });
  };

  return (
    <aside className="panel inspector">
      <div className="panel-title">Properties</div>
      {!clip && <div className="empty">Select a clip on the timeline to edit its properties.</div>}

      {clip && track === 'text' && (
        <div className="fields">
          <label className="field">
            <span>Text</span>
            <textarea rows={3} value={clip.text} onChange={(e) => set({ text: e.target.value })} />
          </label>
          <Slider label="Size" value={clip.size} min={12} max={200} step={1} onChange={(size) => set({ size })} />
          <label className="field row">
            <span>Color</span>
            <input type="color" value={clip.color} onChange={(e) => set({ color: e.target.value })} />
          </label>
          <Slider label="Position X" value={clip.x} fmt={pct} onChange={(x) => set({ x })} />
          <Slider label="Position Y" value={clip.y} fmt={pct} onChange={(y) => set({ y })} />
          <Num label="Start (s)" value={clip.start} min={0} onChange={(start) => set({ start: Math.max(0, start) })} />
          <Num label="Duration (s)" value={clip.duration} min={0.1} onChange={(duration) => set({ duration: Math.max(0.1, duration) })} />
        </div>
      )}

      {clip && track === 'video' && (
        <div className="fields">
          <div className="info">{media?.name}<br /><span className="dim">{media?.width}×{media?.height} · {formatTime(media?.duration ?? 0)}</span></div>
          <Num label="Source in (s)" value={clip.in} min={0} onChange={(v) => set({ in: Math.max(0, Math.min(v, clip.out - 0.1)) })} />
          <Num label="Source out (s)" value={clip.out} onChange={(v) => set({ out: Math.max(clip.in + 0.1, Math.min(v, media?.duration ?? v)) })} />
          <Slider label="Volume" value={clip.volume ?? 1} max={2} fmt={pct} onChange={(volume) => set({ volume })} />
          <label className="field row">
            <span>Mute</span>
            <input type="checkbox" checked={!!clip.muted} onChange={(e) => set({ muted: e.target.checked })} />
          </label>

          <div className="effect-block">
            <div className="effect-title">Effects</div>
            <label className="field">
              <span>Video effect</span>
              <select value={effectType} onChange={(e) => set({ effect: makeEffect(e.target.value, clip.effect) })}>
                <option value="none">None</option>
                <option value="bgblur">Background blur</option>
                <option value="edges">Edges</option>
              </select>
            </label>

            {effect?.type === 'bgblur' && (
              <>
                <Slider label="Blur strength" value={effect.blur} min={0} max={40} step={1} onChange={(blur) => setEffect({ blur })} />
                <Slider label="Edge softness" value={effect.edge} min={0} max={10} step={0.5} onChange={(edge) => setEffect({ edge })} />
                <Slider label="Subject outline" value={effect.outline} min={0} max={10} step={0.5} onChange={(outline) => setEffect({ outline })} />
                {effect.outline > 0 && (
                  <label className="field row">
                    <span>Outline color</span>
                    <input type="color" value={effect.outlineColor || '#ffd54a'} onChange={(e) => setEffect({ outlineColor: e.target.value })} />
                  </label>
                )}

                <div className="object-block">
                  <div className="brush-head">
                    <span>Smart objects</span>
                    <button className="small" onClick={runScan} disabled={scan.busy || !media}>
                      {scan.busy ? 'Scanning…' : 'Scan clip'}
                    </button>
                  </div>
                  {labels.length > 0 ? (
                    <div className="chips">
                      {labels.map((label) => {
                        const found = scanItems.find((i) => i.label === label);
                        return (
                          <button key={label} className={`chip ${kept.includes(label) ? 'on' : ''}`}
                            onClick={() => toggleKeep(label)}
                            title={found ? `Detected in ${found.count} of 5 sampled frames` : 'Selected, not detected in this scan'}>
                            {label}{found ? ` · ${found.count}` : ''}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="brush-hint">{scanHint}</p>
                  )}
                  {scan.error && <p className="brush-hint error-text">{scan.error}</p>}
                  {kept.length > 0 && (
                    <p className="brush-hint">Kept sharp: {kept.join(', ')} — they are excluded from the blur in the preview and the export.</p>
                  )}
                </div>

                <div className="brush-block">
                  <div className="brush-head">
                    <span>Mask brush</span>
                    <button className="small" onClick={() => setEffect({ strokes: [] })} disabled={!effect.strokes?.length}>Clear all</button>
                  </div>
                  <div className="seg">
                    {[['off', 'Off'], ['erase', 'Erase'], ['restore', 'Restore']].map(([mode, label]) => (
                      <button key={mode} className={brush.mode === mode ? 'on' : ''} onClick={() => setBrush({ ...brush, mode })}>{label}</button>
                    ))}
                  </div>
                  <Slider label="Brush size" value={brush.size} min={0.01} max={0.12} step={0.005}
                    fmt={(v) => `${Math.round(v * 200)}`} onChange={(size) => setBrush({ ...brush, size })} />
                  <p className="brush-hint">Paint on the preview while paused: Erase removes part of the subject mask, Restore brings it back.</p>
                </div>
              </>
            )}

            {effect?.type === 'edges' && (
              <Slider label="Edge strength" value={effect.strength} min={1} max={10} step={1} onChange={(strength) => setEffect({ strength })} />
            )}
          </div>
        </div>
      )}

      {clip && track === 'audio' && (
        <div className="fields">
          <div className="info">{media?.name}</div>
          <Num label="Timeline start (s)" value={clip.start} min={0} onChange={(start) => set({ start: Math.max(0, start) })} />
          <Slider label="Volume" value={clip.volume ?? 1} max={2} fmt={pct} onChange={(volume) => set({ volume })} />
        </div>
      )}

      <div className="shortcuts dim">
        <b>Shortcuts</b><br />
        Space: play/pause · S / Ctrl+B: split<br />
        Delete: remove · Ctrl+Z / Ctrl+Y: undo/redo<br />
        ← →: frame · Shift+← →: 1s
      </div>
    </aside>
  );
}
