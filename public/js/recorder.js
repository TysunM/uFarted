import { el, fmtDur } from './ui.js';

const MIME_PREFS = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
export const canRecord = () => Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

/**
 * Recording widget. Calls onDone(blob) when a take finishes (auto-stops at maxSeconds).
 * Returns { node, stop } so the caller can abort when the sheet closes.
 */
export function recorderWidget({ maxSeconds, onDone, onError, onCancel }) {
  const meter = el('i');
  const timer = el('span', { class: 'timer' }, '0:00');
  const stopBtn = el('button', { type: 'button', class: 'btn sm primary' }, '■ Stop');
  const node = el('div', { class: 'recorder' },
    el('div', { class: 'rec-live' }, el('span', { class: 'rec-dot' }), el('div', { class: 'meter' }, meter), timer, stopBtn),
    el('p', { class: 'tiny muted' }, `Hold the phone close. Max ${maxSeconds}s — it stops automatically.`));

  let stream, rec, ctx, raf, tick, stopped = false, settled = false;
  const chunks = [];
  const settle = (fn, arg) => { if (!settled) { settled = true; fn?.(arg); } };
  const cleanup = () => {
    cancelAnimationFrame(raf);
    clearInterval(tick);
    stream?.getTracks().forEach((t) => t.stop());
    ctx?.close().catch(() => {});
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (rec && rec.state !== 'inactive') return rec.stop(); // onstop delivers the take
    cleanup();
    settle(onCancel); // stopped before the mic even opened
  };
  stopBtn.addEventListener('click', stop);

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
      if (stopped) return cleanup();
      const mimeType = MIME_PREFS.find((m) => MediaRecorder.isTypeSupported?.(m));
      rec = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 96000 } : undefined);
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        cleanup();
        const blob = new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' });
        if (blob.size > 0) settle(onDone, blob); else settle(onError, 'Nothing was recorded. Try again.');
      };
      rec.start(250);
      const started = Date.now();
      tick = setInterval(() => {
        const ms = Date.now() - started;
        timer.textContent = fmtDur(ms);
        if (ms >= maxSeconds * 1000) stop();
      }, 200);
      // Live level meter (purely cosmetic, so failures are ignored).
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        const draw = () => {
          analyser.getByteTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
          meter.style.width = `${Math.min(100, (peak / 128) * 160)}%`;
          raf = requestAnimationFrame(draw);
        };
        draw();
      } catch { /* meter is optional */ }
    } catch (err) {
      stopped = true;
      cleanup();
      settle(onError, err?.name === 'NotAllowedError'
        ? 'Microphone is blocked. Allow it in your browser settings to record.'
        : 'Couldn’t start the microphone on this device.');
    }
  })();

  return { node, stop };
}
