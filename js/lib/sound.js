// Kleine, im Browser erzeugte Töne (keine Audiodateien nötig).
let ctx;

function tone(freq, start, dur, type = 'sine', gain = 0.12) {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  } catch {
    /* Ton ist nur Beiwerk */
  }
}

export const sounds = {
  ok() {
    tone(660, 0, 0.1);
    tone(990, 0.07, 0.16);
  },
  bad() {
    tone(196, 0, 0.2, 'triangle', 0.16);
  },
  done() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.085, 0.2));
  },
};
