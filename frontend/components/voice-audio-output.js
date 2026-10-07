/** PCM playback with local volume, a real playback meter, and an optional room-send stream. */
let activeVoiceOutput = null;

export function stopAllVoiceAiOutput(except = null) {
  const active = activeVoiceOutput;
  if (!active || active === except) return false;
  active.interrupt();
  return true;
}

export class VoiceAudioOutput {
  constructor({ rate = 24000, onLevel, volume = 0.8 } = {}) {
    this.ctx = new AudioContext({ sampleRate: rate });
    this.rate = rate;
    this.next = 0;
    this.nodes = new Set();
    this.onLevel = onLevel;
    this.bus = this.ctx.createGain();
    this.gain = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.samples = new Float32Array(256);
    this.streamDestination = this.ctx.createMediaStreamDestination();
    this.bus.connect(this.analyser);
    this.analyser.connect(this.gain);
    this.gain.connect(this.ctx.destination);
    this.localOutput = "web-audio";
    // Share only synthesized assistant audio, never the microphone. The room integration
    // decides whether to publish this stream; local volume does not alter remote volume.
    this.bus.connect(this.streamDestination);
    this.setVolume(volume);
  }

  async resume() {
    const resumed = this.ctx?.state === "suspended" ? this.ctx.resume() : null;
    this.attachHeadsetElement();
    if (resumed) await resumed;
  }

  /** Quest / WebXR often routes HTMLAudio to the headset when AudioContext.destination stays on desktop. */
  attachHeadsetElement() {
    if (typeof document === "undefined") return null;
    const stream = this.getOutputStream();
    if (!stream) return this.el || null;
    if (!this.el) {
      const el = document.createElement("audio");
      el.autoplay = true;
      el.playsInline = true;
      el.setAttribute("playsinline", "");
      el.setAttribute("webkit-playsinline", "");
      el.muted = false;
      el.volume = this.volume;
      try { el.srcObject = stream; } catch { return null; }
      try { document.body?.appendChild(el); } catch { /* detached */ }
      this.el = el;
    }
    if (this.localOutput !== "web-audio") return this.el;
    const element = this.el, context = this.ctx;
    if (!context || typeof element.play !== "function") return element;
    // The HTML element carries the same assistant bus. Select exactly one
    // local output so the fallback cannot double-play or bypass local mute.
    this.gain.disconnect(context.destination);
    this.localOutput = "element-pending";
    const restoreContext = () => {
      if (this.ctx !== context || this.el !== element) return;
      try { element.pause(); } catch { /* already stopped */ }
      if (this.localOutput !== "web-audio") this.gain.connect(context.destination);
      this.localOutput = "web-audio";
    };
    element.onerror = restoreContext;
    try {
      void Promise.resolve(element.play()).then(() => {
        if (this.ctx === context && this.el === element) this.localOutput = "element";
      }, restoreContext);
    } catch { restoreContext(); }
    return this.el;
  }

  setVolume(value) {
    const n = Number(value);
    this.volume = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.8;
    if (this.gain) this.gain.gain.value = this.volume;
    if (this.el) this.el.volume = this.volume;
  }

  getOutputStream() { return this.streamDestination?.stream || null; }

  playPcm16(samples) {
    if (!samples?.length || !this.ctx) return;
    // Desktop, VR, Realtime and buffered subscription sessions all meet here.
    // Only one Voice AI output may own the speakers at a time.
    stopAllVoiceAiOutput(this);
    try { globalThis.window?.speechSynthesis?.cancel?.(); } catch { /* no browser TTS */ }
    activeVoiceOutput = this;
    const buf = this.ctx.createBuffer(1, samples.length, this.rate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 32768;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.bus);
    this.nodes.add(src);
    src.onended = () => {
      this.nodes.delete(src);
      src.disconnect();
      if (!this.nodes.size) {
        if (activeVoiceOutput === this) activeVoiceOutput = null;
        this.stopMeter();
      }
    };
    const now = this.ctx.currentTime;
    if (this.next < now + 0.02) this.next = now;
    src.start(this.next);
    this.next += buf.duration;
    if (!this.timer) this.timer = setInterval(() => {
      this.analyser.getFloatTimeDomainData(this.samples);
      let sum = 0;
      for (const x of this.samples) sum += x * x;
      try { this.onLevel?.(Math.min(1, Math.sqrt(sum / this.samples.length) * 3)); } catch { /* UI only */ }
    }, 33);
  }

  stopMeter() { clearInterval(this.timer); this.timer = null; try { this.onLevel?.(0); } catch { /* UI only */ } }

  interrupt() {
    for (const src of this.nodes) { try { src.stop(); src.disconnect(); } catch { /* already ended */ } }
    this.nodes.clear();
    this.next = 0;
    if (activeVoiceOutput === this) activeVoiceOutput = null;
    this.stopMeter();
  }

  close() {
    this.interrupt();
    if (this.el) {
      try { this.el.pause(); } catch { /* ignore */ }
      try { this.el.srcObject = null; } catch { /* ignore */ }
      try { this.el.remove(); } catch { /* ignore */ }
      this.el = null;
    }
    this.streamDestination?.stream.getTracks().forEach(t => t.stop());
    this.ctx?.close()?.catch?.(() => {});
    this.ctx = null;
  }
}
