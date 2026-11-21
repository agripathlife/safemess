import type {VoicePreset} from '../types/safemess';

const WORKLET_CODE = `
class SafeMessPitchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'pitchRatio', defaultValue: 0.74, minValue: 0.5, maxValue: 2.0 },
      { name: 'robotMix', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0 }
    ];
  }

  constructor() {
    super();
    this.bufSize = 4096;
    this.buffer = new Float32Array(this.bufSize);
    this.writeIndex = 0;
    this.phase = 0;
    this.robotPhase = 0;
    this.windowSize = 1536;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0] || !output || !output[0]) return true;

    const inCh = input[0];
    const outCh = output[0];
    const ratio = parameters.pitchRatio[0] ?? 0.74;
    const robotMix = parameters.robotMix[0] ?? 0.0;
    const step = (1.0 - ratio) / this.windowSize;

    for (let i = 0; i < inCh.length; i++) {
      this.buffer[this.writeIndex] = inCh[i];

      const p1 = this.phase;
      const p2 = (this.phase + 0.5) % 1.0;

      const d1 = p1 * this.windowSize;
      const d2 = p2 * this.windowSize;

      const idx1 = (this.writeIndex - d1 + this.bufSize) % this.bufSize;
      const idx2 = (this.writeIndex - d2 + this.bufSize) % this.bufSize;

      const i1a = Math.floor(idx1);
      const i1b = (i1a + 1) % this.bufSize;
      const f1 = idx1 - i1a;
      const s1 = this.buffer[i1a] * (1 - f1) + this.buffer[i1b] * f1;

      const i2a = Math.floor(idx2);
      const i2b = (i2a + 1) % this.bufSize;
      const f2 = idx2 - i2a;
      const s2 = this.buffer[i2a] * (1 - f2) + this.buffer[i2b] * f2;

      const w1 = 1.0 - Math.abs(2.0 * p1 - 1.0);
      const w2 = 1.0 - Math.abs(2.0 * p2 - 1.0);
      let pitched = s1 * w1 + s2 * w2;

      if (robotMix > 0.01) {
        const carrier = Math.sin(2.0 * Math.PI * this.robotPhase);
        const quantized = Math.round(inCh[i] * 12) / 12;
        const robotSample = (quantized * 0.45 + inCh[i] * carrier * 0.85);
        pitched = pitched * (1 - robotMix) + robotSample * robotMix;
        this.robotPhase = (this.robotPhase + 46 / sampleRate) % 1.0;
      }

      outCh[i] = Math.max(-0.98, Math.min(0.98, pitched));

      this.writeIndex = (this.writeIndex + 1) % this.bufSize;
      this.phase = (this.phase + step + 1.0) % 1.0;
    }

    for (let c = 1; c < output.length; c++) {
      output[c].set(outCh);
    }
    return true;
  }
}
registerProcessor('safemess-pitch-processor', SafeMessPitchProcessor);
`;

export class VoiceMaskingEngine {
  private ctx: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private lowShelf: BiquadFilterNode | null = null;
  private presenceFilter: BiquadFilterNode | null = null;
  private analyser: AnalyserNode | null = null;
  private destNode: MediaStreamAudioDestinationNode | null = null;
  private monitorGain: GainNode | null = null;
  private levelTimer: number | null = null;
  private blobUrl: string | null = null;
  private currentPreset: VoicePreset = 'deep';

  async start(
    rawMicStream: MediaStream,
    initialPreset: VoicePreset,
    onAudioLevel?: (level: number) => void
  ): Promise<MediaStream> {
    this.stop();
    this.currentPreset = initialPreset;

    const AudioCtx = window.AudioContext || (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
    const ctx = new AudioCtx({latencyHint: 'interactive'});
    this.ctx = ctx;

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const source = ctx.createMediaStreamSource(rawMicStream);
    this.sourceNode = source;

    const lowShelf = ctx.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = 190;
    this.lowShelf = lowShelf;

    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 1800;
    presence.Q.value = 1.2;
    this.presenceFilter = presence;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    this.analyser = analyser;

    const dest = ctx.createMediaStreamDestination();
    this.destNode = dest;

    const monitorGain = ctx.createGain();
    monitorGain.gain.value = 0; // muted locally by default to avoid feedback
    this.monitorGain = monitorGain;

    let dspOut: AudioNode = source;
    try {
      const blob = new Blob([WORKLET_CODE], {type: 'application/javascript'});
      this.blobUrl = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(this.blobUrl);
      const worklet = new AudioWorkletNode(ctx, 'safemess-pitch-processor');
      this.workletNode = worklet;
      source.connect(worklet);
      dspOut = worklet;
    } catch {
      // Fallback spectral filter if AudioWorklet is blocked by environment
      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.value = 500;
      bandpass.Q.value = 0.9;
      source.connect(bandpass);
      dspOut = bandpass;
    }

    dspOut.connect(lowShelf);
    lowShelf.connect(presence);
    presence.connect(analyser);
    analyser.connect(dest);
    analyser.connect(monitorGain);
    monitorGain.connect(ctx.destination);

    this.setPreset(initialPreset);

    if (onAudioLevel) {
      const data = new Uint8Array(analyser.frequencyBinCount);
      this.levelTimer = window.setInterval(() => {
        if (!this.analyser) return;
        this.analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        onAudioLevel(Math.min(1, rms * 3.5));
      }, 60);
    }

    return dest.stream;
  }

  setPreset(preset: VoicePreset): void {
    this.currentPreset = preset;
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const pitchParam = this.workletNode?.parameters.get('pitchRatio');
    const robotParam = this.workletNode?.parameters.get('robotMix');

    if (preset === 'deep') {
      pitchParam?.setTargetAtTime(0.73, now, 0.03);
      robotParam?.setTargetAtTime(0.0, now, 0.03);
      if (this.lowShelf) {
        this.lowShelf.gain.setTargetAtTime(7, now, 0.03);
      }
      if (this.presenceFilter) {
        this.presenceFilter.frequency.setTargetAtTime(1200, now, 0.03);
        this.presenceFilter.gain.setTargetAtTime(-2, now, 0.03);
      }
    } else if (preset === 'cartoon') {
      pitchParam?.setTargetAtTime(1.38, now, 0.03);
      robotParam?.setTargetAtTime(0.0, now, 0.03);
      if (this.lowShelf) {
        this.lowShelf.gain.setTargetAtTime(-6, now, 0.03);
      }
      if (this.presenceFilter) {
        this.presenceFilter.frequency.setTargetAtTime(2400, now, 0.03);
        this.presenceFilter.gain.setTargetAtTime(5, now, 0.03);
      }
    } else {
      // robot
      pitchParam?.setTargetAtTime(0.95, now, 0.03);
      robotParam?.setTargetAtTime(0.9, now, 0.03);
      if (this.lowShelf) {
        this.lowShelf.gain.setTargetAtTime(-3, now, 0.03);
      }
      if (this.presenceFilter) {
        this.presenceFilter.frequency.setTargetAtTime(1150, now, 0.03);
        this.presenceFilter.gain.setTargetAtTime(6, now, 0.03);
      }
    }
  }

  getPreset(): VoicePreset {
    return this.currentPreset;
  }

  setLocalMonitor(enabled: boolean): void {
    if (!this.ctx || !this.monitorGain) return;
    this.monitorGain.gain.setTargetAtTime(enabled ? 0.65 : 0, this.ctx.currentTime, 0.04);
  }

  stop(): void {
    if (this.levelTimer !== null) {
      clearInterval(this.levelTimer);
      this.levelTimer = null;
    }
    try {
      this.sourceNode?.disconnect();
      this.workletNode?.disconnect();
      this.lowShelf?.disconnect();
      this.presenceFilter?.disconnect();
      this.analyser?.disconnect();
      this.monitorGain?.disconnect();
      this.destNode?.disconnect();
    } catch {
      // ignore disconnect errors
    }
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.sourceNode = null;
    this.workletNode = null;
    this.lowShelf = null;
    this.presenceFilter = null;
    this.analyser = null;
    this.monitorGain = null;
    this.destNode = null;
  }
}

// Synthesized high-priority alert tone for Emergency Calls / Incoming Rings
let ringCtx: AudioContext | null = null;
let ringInterval: number | null = null;

export function startRingTone(isEmergency: boolean): void {
  stopRingTone();
  try {
    const AudioCtx = window.AudioContext || (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
    const ctx = new AudioCtx();
    ringCtx = ctx;

    const pulse = () => {
      if (!ringCtx) return;
      const now = ringCtx.currentTime;
      const osc = ringCtx.createOscillator();
      const gain = ringCtx.createGain();

      osc.type = isEmergency ? 'sawtooth' : 'sine';
      osc.frequency.setValueAtTime(isEmergency ? 880 : 523.25, now);
      if (isEmergency) {
        osc.frequency.setValueAtTime(1174.66, now + 0.16);
        osc.frequency.setValueAtTime(880, now + 0.32);
      } else {
        osc.frequency.setValueAtTime(659.25, now + 0.22);
      }

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(isEmergency ? 0.22 : 0.12, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

      osc.connect(gain);
      gain.connect(ringCtx.destination);
      osc.start(now);
      osc.stop(now + 0.58);
    };

    pulse();
    ringInterval = window.setInterval(pulse, isEmergency ? 900 : 1800);
  } catch {
    // Audio playback may require user gesture in some browsers
  }
}

export function stopRingTone(): void {
  if (ringInterval !== null) {
    clearInterval(ringInterval);
    ringInterval = null;
  }
  if (ringCtx) {
    void ringCtx.close().catch(() => {});
    ringCtx = null;
  }
}
