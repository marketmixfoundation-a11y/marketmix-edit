# MarketMix Edit 0.1.0 — first public release

A free desktop video editor with on-device AI background blur, for Windows.
No account, no watermark, no uploads: your videos stay on your computer.

## Install

1. Download **`MarketMix-Edit-Setup-0.1.0.exe`** below (Windows 10 / 11, 64-bit).
2. Run it and choose an install folder. Setup creates Start Menu and Desktop shortcuts.
3. Windows SmartScreen may show *"Windows protected your PC"* because this build is not
   code-signed yet: click **More info**, then **Run anyway**.

## Highlights

### AI focus effects

- **Background blur** — MediaPipe selfie segmentation runs locally. The subject stays sharp
  and the background gets a soft blur you control with a slider.
- **Smart objects** — scan a clip and the app lists what it recognises (laptop, cup, chair,
  book…). Tick one to keep it sharp inside the blur — for example a laptop held in front of
  the subject. Detected boxes are feathered into the mask before the brush strokes.
- **Mask brush** — paint on the preview to erase or restore parts of the subject mask.
  Corrections are stored per clip and applied to every exported frame.
- **Subject outline** — optional coloured outline around the final mask, with size and colour.
- **Edges** — a separate edge-detection look with its own strength.

Everything is rendered on the GPU for the preview and baked into the MP4 by FFmpeg on export.

### Editor

A CapCut-style editor built on the open-source CapRocket project: magnetic timeline,
razor and split tools, undo / redo, text overlays, a music track, clip audio, clip speed,
filters, and MP4 export.

## Privacy

- The segmentation and object-detection models ship with the app and run offline.
- MediaPipe's optional telemetry endpoint is blocked by the app's Content Security Policy.
- No account, analytics, ads or telemetry.

## Requirements

Windows 10 or 11, 64-bit. About 250 MB of disk space.

## Credits and license

MarketMix Edit is MIT licensed. The editor skeleton comes from CapRocket
(https://github.com/medhachim/CapRocket), MIT licensed, Copyright (c) CapRocket contributors.
Subject segmentation and object detection use MediaPipe Tasks Vision (Apache 2.0).
Video encoding uses FFmpeg (LGPL/GPL).
