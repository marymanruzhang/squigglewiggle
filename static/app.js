/**
 * SquiggleWiggle AI — Multi-user canvas controller
 *
 * State machine per player:  idle → drawing → done
 * Global trigger: 10 s of inactivity on EITHER canvas (or both Done buttons pressed)
 */

document.addEventListener('DOMContentLoaded', () => {

  const INACTIVITY_MS = 10_000;

  // ── Canvas contexts ────────────────────────────────────────────────────
  const canvas1 = document.getElementById('canvas1');
  const canvas2 = document.getElementById('canvas2');
  const ctx1    = canvas1.getContext('2d');
  const ctx2    = canvas2.getContext('2d');

  // ── Buttons ────────────────────────────────────────────────────────────
  const clearBtn1 = document.getElementById('clearBtn1');
  const clearBtn2 = document.getElementById('clearBtn2');
  const doneBtn1  = document.getElementById('doneBtn1');
  const doneBtn2  = document.getElementById('doneBtn2');

  // ── Per-player result elements ─────────────────────────────────────────
  const result1  = document.getElementById('result1');
  const result2  = document.getElementById('result2');
  const gif1     = document.getElementById('gif1');
  const gif2     = document.getElementById('gif2');
  const label1   = document.getElementById('label1');
  const label2   = document.getElementById('label2');
  const top5_1   = document.getElementById('top5_1');
  const top5_2   = document.getElementById('top5_2');
  const doneInd1 = document.getElementById('done1');
  const doneInd2 = document.getElementById('done2');

  // ── Status / countdown ─────────────────────────────────────────────────
  const statusMsg     = document.getElementById('statusMsg');
  const countdownBar  = document.getElementById('countdownBar');
  const countdownFill = document.getElementById('countdownFill');
  const countdownLbl  = document.getElementById('countdownLabel');

  // ── Stage ──────────────────────────────────────────────────────────────
  const stageEmpty       = document.getElementById('stageEmpty');
  const stageLoader      = document.getElementById('stageLoader');
  const stageMsg         = document.getElementById('stageMsg');
  const stageResult      = document.getElementById('stageResult');
  const interactionGif   = document.getElementById('interactionGif');
  const interactionLabel = document.getElementById('interactionLabel');
  const replayBtn        = document.getElementById('replayBtn');

  // ── State ──────────────────────────────────────────────────────────────
  const state = {
    1: { drawn: false, done: false, strokes: [], curX: [], curY: [], drawing: false },
    2: { drawn: false, done: false, strokes: [], curX: [], curY: [], drawing: false },
  };

  let inactivityTimer   = null;
  let countdownInterval = null;
  let animating         = false;

  // ── Canvas init ────────────────────────────────────────────────────────
  function initCtx(ctx) {
    ctx.fillStyle   = '#ffffff';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.lineWidth   = 7;
    ctx.strokeStyle = '#000000';
  }
  initCtx(ctx1);
  initCtx(ctx2);

  // ── Drawing handlers ───────────────────────────────────────────────────
  function getXY(e, cvs) {
    const r  = cvs.getBoundingClientRect();
    const sx = cvs.width  / r.width;
    const sy = cvs.height / r.height;
    const ev = e.touches ? e.touches[0] : e;
    return { x: (ev.clientX - r.left) * sx, y: (ev.clientY - r.top) * sy };
  }

  function makeHandlers(pid, ctx) {
    const s = state[pid];
    return {
      start(e) {
        e.preventDefault();
        s.drawing = true;
        s.drawn   = true;
        const { x, y } = getXY(e, ctx.canvas);
        s.curX = [x]; s.curY = [y];
        ctx.beginPath(); ctx.moveTo(x, y);
        resetInactivity();
        updateStatus();
      },
      move(e) {
        if (!s.drawing) return;
        e.preventDefault();
        const { x, y } = getXY(e, ctx.canvas);
        ctx.lineTo(x, y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, y);
        s.curX.push(x); s.curY.push(y);
        resetInactivity();
      },
      end() {
        if (s.drawing && s.curX.length > 0) {
          s.strokes.push([s.curX.slice(), s.curY.slice()]);
          s.curX = []; s.curY = [];
        }
        s.drawing = false;
        resetInactivity();
      },
    };
  }

  function attach(cvs, h) {
    cvs.addEventListener('mousedown',  h.start);
    cvs.addEventListener('mousemove',  h.move);
    cvs.addEventListener('mouseup',    h.end);
    cvs.addEventListener('mouseleave', h.end);
    cvs.addEventListener('touchstart', h.start, { passive: false });
    cvs.addEventListener('touchmove',  h.move,  { passive: false });
    cvs.addEventListener('touchend',   h.end);
  }

  attach(canvas1, makeHandlers(1, ctx1));
  attach(canvas2, makeHandlers(2, ctx2));

  // ── Clear ──────────────────────────────────────────────────────────────
  function clearPlayer(pid, ctx) {
    initCtx(ctx);
    const s = state[pid];
    Object.assign(s, { drawn: false, done: false, strokes: [], curX: [], curY: [], drawing: false });
    document.getElementById(`done${pid}`).textContent = '';
    document.getElementById(`result${pid}`).style.display = 'none';
    cancelInactivity();
    updateStatus();
  }

  clearBtn1.addEventListener('click', () => clearPlayer(1, ctx1));
  clearBtn2.addEventListener('click', () => clearPlayer(2, ctx2));

  // ── Done buttons ───────────────────────────────────────────────────────
  function markDone(pid) {
    if (!state[pid].drawn || animating) return;
    state[pid].done = true;
    document.getElementById(`done${pid}`).textContent = '✓ Ready';
    updateStatus();
    if (state[1].done && state[2].done) {
      cancelInactivity();
      triggerAnimation();
    }
  }

  doneBtn1.addEventListener('click', () => markDone(1));
  doneBtn2.addEventListener('click', () => markDone(2));

  // ── Inactivity countdown ───────────────────────────────────────────────
  function resetInactivity() {
    if (animating) return;
    cancelInactivity();
    if (!state[1].drawn && !state[2].drawn) return;

    countdownBar.style.display = 'block';
    countdownFill.style.transition = 'none';
    countdownFill.style.width = '100%';

    requestAnimationFrame(() => requestAnimationFrame(() => {
      countdownFill.style.transition = `width ${INACTIVITY_MS}ms linear`;
      countdownFill.style.width = '0%';
    }));

    let remaining = INACTIVITY_MS;
    countdownInterval = setInterval(() => {
      remaining -= 1000;
      countdownLbl.textContent = `Auto-animating in ${Math.max(0, Math.round(remaining / 1000))}s…`;
    }, 1000);

    inactivityTimer = setTimeout(() => {
      cancelInactivity();
      triggerAnimation();
    }, INACTIVITY_MS);
  }

  function cancelInactivity() {
    clearTimeout(inactivityTimer);
    clearInterval(countdownInterval);
    inactivityTimer = countdownInterval = null;
    countdownBar.style.display = 'none';
  }

  // ── Status text ────────────────────────────────────────────────────────
  function updateStatus() {
    if (animating) { statusMsg.textContent = 'AI is recognising and animating your sketches… ✨'; return; }
    const { drawn: d1, done: dn1 } = state[1];
    const { drawn: d2, done: dn2 } = state[2];
    if (!d1 && !d2)  { statusMsg.textContent = 'Both players draw something, then press ✓ Done!'; return; }
    if ( d1 && !d2)  { statusMsg.textContent = 'Waiting for Player 2 to draw…'; return; }
    if (!d1 &&  d2)  { statusMsg.textContent = 'Waiting for Player 1 to draw…'; return; }
    if (dn1 && dn2)  { statusMsg.textContent = 'Both ready — animating!'; return; }
    if (dn1 && !dn2) { statusMsg.textContent = 'Player 1 is ready — waiting for Player 2…'; return; }
    if (!dn1 && dn2) { statusMsg.textContent = 'Player 2 is ready — waiting for Player 1…'; return; }
    statusMsg.textContent = 'Both drawn — press ✓ Done when ready, or wait 10 s!';
  }

  // ── Top-5 pills ────────────────────────────────────────────────────────
  function renderTop5(container, items) {
    container.innerHTML = '';
    (items || []).forEach((item, i) => {
      const p = document.createElement('span');
      p.className = 'top5-pill' + (i === 0 ? ' best' : '');
      p.title     = `${item.conf.toFixed(1)}%`;
      p.textContent = item.label;
      container.appendChild(p);
    });
  }

  // ── Main animation trigger ─────────────────────────────────────────────
  async function triggerAnimation() {
    if (animating) return;
    if (!state[1].drawn && !state[2].drawn) return;

    animating = true;
    updateStatus();

    stageResult.style.display = 'none';
    stageEmpty.style.display  = 'block';
    stageLoader.style.display = 'block';
    stageMsg.textContent      = 'Recognising and animating…';

    const b64 = cvs => cvs.toDataURL('image/png');

    const body = {
      image1:   b64(canvas1),
      strokes1: state[1].strokes,
      image2:   b64(canvas2),
      strokes2: state[2].strokes,
    };

    try {
      const resp = await fetch('/api/animate-pair', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Server error');

      const ts = '?t=' + Date.now();

      // Player 1 mini result
      gif1.src          = data.gif_url1 + ts;
      label1.textContent = data.category1;
      renderTop5(top5_1, data.top5_1);
      result1.style.display = 'flex';

      // Player 2 mini result
      gif2.src          = data.gif_url2 + ts;
      label2.textContent = data.category2;
      renderTop5(top5_2, data.top5_2);
      result2.style.display = 'flex';

      // Interaction stage
      stageLoader.style.display  = 'none';
      stageEmpty.style.display   = 'none';
      interactionGif.src          = data.interaction_gif_url + ts;
      interactionLabel.textContent = `${data.category1} meets ${data.category2}`;
      stageResult.style.display   = 'flex';

    } catch (err) {
      console.error(err);
      stageLoader.style.display = 'none';
      stageMsg.textContent      = 'Error: ' + err.message;
    } finally {
      animating = false;
      updateStatus();
    }
  }

  // ── Replay ─────────────────────────────────────────────────────────────
  replayBtn.addEventListener('click', () => {
    const src = interactionGif.src.split('?')[0];
    interactionGif.src = src + '?t=' + Date.now();
  });

});
