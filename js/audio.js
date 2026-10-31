// Tiny WebAudio synth kit — no audio files, everything is generated.
export class SoundKit {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.noiseBuffer = null;
    this.stretchOsc = null;
    this.stretchGain = null;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(this.ctx.destination);

    // short noise buffer reused by impacts
    const len = Math.floor(this.ctx.sampleRate * 0.7);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.55, this.ctx.currentTime, 0.03);
    }
  }

  now() { return this.ctx ? this.ctx.currentTime : 0; }

  tone({ freq = 440, to = null, dur = 0.15, type = 'sine', vol = 0.3, attack = 0.005, delay = 0 }) {
    if (!this.ctx || this.muted) return;
    const t = this.now() + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to != null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise({ dur = 0.15, vol = 0.3, freq = 1200, q = 0.8, type = 'lowpass', delay = 0, sweep = null }) {
    if (!this.ctx || this.muted || !this.noiseBuffer) return;
    const t = this.now() + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (sweep != null) filter.frequency.exponentialRampToValueAtTime(Math.max(40, sweep), t + dur);
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t, Math.random() * 0.2);
    src.stop(t + dur + 0.02);
  }

  click() {
    this.unlock();
    this.tone({ freq: 520, to: 720, dur: 0.07, type: 'triangle', vol: 0.18 });
  }

  stretchStart() {
    this.unlock();
    if (!this.ctx || this.stretchOsc) return;
    const t = this.now();
    this.stretchOsc = this.ctx.createOscillator();
    this.stretchGain = this.ctx.createGain();
    this.stretchOsc.type = 'sawtooth';
    this.stretchOsc.frequency.value = 70;
    this.stretchGain.gain.value = 0.0001;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    this.stretchOsc.connect(filter).connect(this.stretchGain).connect(this.master);
    this.stretchOsc.start(t);
    this.stretchGain.gain.setTargetAtTime(0.035, t, 0.04);
  }

  stretchMove(power) {
    if (!this.stretchOsc || !this.ctx) return;
    const f = 60 + power * 130;
    this.stretchOsc.frequency.setTargetAtTime(f, this.now(), 0.02);
  }

  stretchStop() {
    if (!this.stretchOsc || !this.ctx) return;
    const t = this.now();
    this.stretchGain.gain.setTargetAtTime(0.0001, t, 0.03);
    this.stretchOsc.stop(t + 0.12);
    this.stretchOsc = null;
    this.stretchGain = null;
  }

  launch() {
    this.stretchStop();
    this.tone({ freq: 260, to: 80, dur: 0.22, type: 'triangle', vol: 0.38 });
    this.noise({ dur: 0.3, vol: 0.18, freq: 2200, sweep: 400, type: 'bandpass', q: 0.7 });
  }

  thud(strength = 1) {
    const s = Math.min(1.4, Math.max(0.2, strength));
    this.tone({ freq: 90 + Math.random() * 20, to: 42, dur: 0.13 + s * 0.05, type: 'sine', vol: 0.28 * s });
    this.noise({ dur: 0.1, vol: 0.1 * s, freq: 500, type: 'lowpass' });
  }

  woodBreak() {
    this.noise({ dur: 0.22, vol: 0.3, freq: 900, sweep: 240, type: 'bandpass', q: 1.1 });
    this.tone({ freq: 160, to: 70, dur: 0.12, type: 'square', vol: 0.12 });
    for (let i = 0; i < 3; i++) {
      this.noise({ dur: 0.06, vol: 0.1, freq: 1600 + Math.random() * 900, type: 'bandpass', delay: 0.03 + i * 0.04 });
    }
  }

  glassBreak() {
    this.noise({ dur: 0.18, vol: 0.24, freq: 5200, sweep: 2600, type: 'highpass' });
    for (let i = 0; i < 5; i++) {
      this.tone({
        freq: 1800 + Math.random() * 2600,
        to: 900 + Math.random() * 1000,
        dur: 0.08 + Math.random() * 0.1,
        type: 'sine',
        vol: 0.07,
        delay: 0.01 + i * 0.035,
      });
    }
  }

  stoneBreak() {
    this.noise({ dur: 0.32, vol: 0.34, freq: 700, sweep: 140, type: 'lowpass' });
    this.tone({ freq: 110, to: 48, dur: 0.2, type: 'square', vol: 0.12 });
  }

  poof() {
    this.tone({ freq: 520, to: 160, dur: 0.16, type: 'square', vol: 0.16 });
    this.noise({ dur: 0.2, vol: 0.2, freq: 2400, sweep: 600, type: 'bandpass', q: 0.6 });
    this.tone({ freq: 880, to: 1320, dur: 0.09, type: 'triangle', vol: 0.08, delay: 0.05 });
  }

  explode() {
    this.noise({ dur: 0.55, vol: 0.5, freq: 1400, sweep: 80, type: 'lowpass' });
    this.tone({ freq: 150, to: 34, dur: 0.45, type: 'sawtooth', vol: 0.3 });
    this.tone({ freq: 70, to: 30, dur: 0.6, type: 'sine', vol: 0.4 });
  }

  boost() {
    this.tone({ freq: 320, to: 880, dur: 0.16, type: 'sawtooth', vol: 0.12 });
    this.noise({ dur: 0.22, vol: 0.15, freq: 1200, sweep: 3200, type: 'bandpass' });
  }

  slam() {
    this.tone({ freq: 180, to: 44, dur: 0.28, type: 'square', vol: 0.22 });
    this.noise({ dur: 0.2, vol: 0.2, freq: 600, type: 'lowpass' });
  }

  egg() {
    const notes = [659, 784, 988, 1319];
    notes.forEach((f, i) => this.tone({ freq: f, dur: 0.28, type: 'triangle', vol: 0.16, delay: i * 0.09 }));
    this.noise({ dur: 0.5, vol: 0.05, freq: 6000, type: 'highpass' });
  }

  win() {
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((f, i) => {
      this.tone({ freq: f, dur: 0.34, type: 'triangle', vol: 0.2, delay: i * 0.11 });
      this.tone({ freq: f / 2, dur: 0.3, type: 'sine', vol: 0.08, delay: i * 0.11 });
    });
  }

  lose() {
    const notes = [392, 349, 311, 262];
    notes.forEach((f, i) => this.tone({ freq: f, to: f * 0.94, dur: 0.34, type: 'triangle', vol: 0.17, delay: i * 0.17 }));
    this.tone({ freq: 130, to: 90, dur: 0.9, type: 'sine', vol: 0.12, delay: 0.2 });
  }

  star(index) {
    const base = [659, 784, 1047][index] || 659;
    this.tone({ freq: base, dur: 0.25, type: 'triangle', vol: 0.18 });
    this.tone({ freq: base * 2, dur: 0.18, type: 'sine', vol: 0.08, delay: 0.03 });
  }
}
