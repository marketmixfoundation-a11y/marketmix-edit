// Automated UI smoke test: FVE_SMOKE=<dir> electron .
// Loads <dir>/project.json, takes screenshots while editing/playing, writes them to <dir>.
// If FVE_EXPORT_PATH is set, runs an export to that path and captures the result dialog.
const fs = require('fs');
const path = require('path');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function smoke(win, app, dir) {
  const wc = win.webContents;
  const shot = async (name) => fs.writeFileSync(path.join(dir, name), (await win.capturePage()).toPNG());
  const run = (js) => wc.executeJavaScript(js);
  const errors = [];
  wc.on('console-message', (_e, level, msg) => level >= 2 && errors.push(msg));
  try {
    await wait(800);
    const projectText = fs.readFileSync(path.join(dir, 'project.json'), 'utf8');
    const project = JSON.parse(projectText);
    await run(`window.__fve.load(${projectText}); window.__fve.seek(1.5);`);
    await wait(3000);
    await shot('1-loaded.png');

    const vclip = project.videoClips && project.videoClips[0];
    if (vclip) {
      await run(`window.__fve.select({ track: 'video', id: ${JSON.stringify(vclip.id)} })`);
      await wait(6000);
      const diag = await run(`(() => ({
        canvas: !!document.querySelector('.stage-canvas'),
        display: document.querySelector('.stage-canvas') ? getComputedStyle(document.querySelector('.stage-canvas')).display : 'none',
        status: document.querySelector('.stage-status') ? document.querySelector('.stage-status').innerText : null,
        inspector: document.querySelector('.inspector') ? document.querySelector('.inspector').innerText.slice(0, 140) : null,
        selection: window.__mm.getSelection(),
        effect: window.__mm.getProject().videoClips[0] ? window.__mm.getProject().videoClips[0].effect : null,
      }))()`);
      fs.writeFileSync(path.join(dir, 'diag.json'), JSON.stringify(diag, null, 2));
      await shot('2-effect.png');

      const clicked = await run(`(() => {
        const block = document.querySelector('.object-block');
        if (block) block.scrollIntoView({ block: 'center' });
        const b = [...document.querySelectorAll('.object-block button')].find((x) => x.textContent.includes('Scan'));
        if (b) b.click();
        return !!b;
      })()`);
      if (clicked) {
        for (let i = 0; i < 20; i++) {
          await wait(500);
          const ready = await run(`!!document.querySelector('.object-block .chip')`);
          if (ready) break;
        }
        await run(`document.querySelector('.object-block')?.scrollIntoView({ block: 'center' })`);
        await wait(300);
        await shot('2b-objects.png');
      }
    }

    try {
      const objects = await run(`window.__mm.scan()`);
      fs.writeFileSync(path.join(dir, 'objects.json'), JSON.stringify(objects, null, 2));
    } catch (e) {
      fs.writeFileSync(path.join(dir, 'objects.json'), JSON.stringify({ error: e.message }));
    }

    const tclip = project.textClips && project.textClips[0];
    if (tclip) {
      await run(`window.__fve.seek(0.8); window.__fve.play();`);
      await wait(2000);
      await run(`window.__fve.pause()`);
      await wait(500);
      await shot('3-played.png');
    }

    if (process.env.FVE_EXPORT_PATH) {
      await run(`window.__mm.export()`);
      let modal = '';
      for (let i = 0; i < 240; i++) {
        await wait(1000);
        modal = await run(`document.querySelector('.modal') ? document.querySelector('.modal').innerText : 'no modal'`);
        fs.writeFileSync(path.join(dir, 'export-progress.txt'), modal);
        if (/Export (done|failed)/.test(modal) || modal === 'no modal') break;
      }
      fs.writeFileSync(path.join(dir, 'export-result.txt'), modal);
      await shot('4-export.png');
    }

    const t = await run(`document.querySelector('.tc').textContent`);
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ timecode: t, errors }, null, 2));
  } catch (e) {
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ error: e.message, errors }, null, 2));
  }
  app.quit();
};
