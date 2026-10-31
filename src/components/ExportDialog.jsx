import React from 'react';

export default function ExportDialog({ state, onCancel, onClose, onShow }) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        {state.error ? (
          <>
            <h3>Export failed</h3>
            <pre className="error">{state.error}</pre>
            <button onClick={onClose}>Close</button>
          </>
        ) : state.done ? (
          <>
            <h3>Export done ✅</h3>
            <p className="dim">{state.file}</p>
            <div className="modal-actions">
              <button onClick={onShow}>Show in folder</button>
              <button className="primary" onClick={onClose}>OK</button>
            </div>
          </>
        ) : (
          <>
            <h3>Export MP4…</h3>
            <div className="progress"><div style={{ width: `${(state.progress * 100).toFixed(1)}%` }} /></div>
            <p>{state.phase || 'Export'} · {(state.progress * 100).toFixed(0)}%</p>
            <button onClick={onCancel}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}
