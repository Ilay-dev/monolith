import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';

type HeatmapTheme = 'thermal' | 'magma' | 'mono' | 'emerald' | 'radar';

const NOTE_STRINGS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const freqToNote = (freq: number): { note: string; cents: number } => {
  if (freq < 20 || !isFinite(freq)) return { note: '—', cents: 0 };
  const noteNum = 12 * (Math.log(freq / 440) / Math.log(2));
  const midi = Math.round(noteNum) + 69;
  const cents = Math.round((noteNum - Math.round(noteNum)) * 100);
  const name = NOTE_STRINGS[midi % 12] || 'C';
  const octave = Math.floor(midi / 12) - 1;
  return { note: `${name}${octave}`, cents };
};

// Blender-style ColorRamp mapping: maps raw [0..1] using Low Stop (Black Point) & High Stop (White Point)
const applyColorRamp = (raw: number, rampLow: number, rampHigh: number): number => {
  if (Math.abs(rampHigh - rampLow) < 0.005) {
    return raw >= rampLow ? 1 : 0;
  }
  const t = (raw - rampLow) / (rampHigh - rampLow);
  return Math.max(0, Math.min(1, t));
};

const mapHeatmapColor = (val: number, theme: HeatmapTheme): [number, number, number] => {
  const v = Math.max(0, Math.min(1, val));
  if (v <= 0.001) return [5, 5, 7];
  if (theme === 'mono') {
    const c = Math.round(v * 255);
    return [c, c, c];
  }
  if (theme === 'thermal') {
    if (v < 0.25) {
      const t = v / 0.25;
      return [Math.round(t * 45), Math.round(t * 10), Math.round(t * 70)];
    }
    if (v < 0.65) {
      const t = (v - 0.25) / 0.4;
      return [Math.round(45 + t * 210), Math.round(10 + t * 69), Math.round(70 * (1 - t))];
    }
    const t = (v - 0.65) / 0.35;
    return [255, Math.round(79 + t * 176), Math.round(t * 255)];
  }
  if (theme === 'magma') {
    if (v < 0.33) {
      const t = v / 0.33;
      return [Math.round(t * 120), Math.round(t * 15), Math.round(t * 130)];
    }
    if (v < 0.7) {
      const t = (v - 0.33) / 0.37;
      return [Math.round(120 + t * 130), Math.round(15 + t * 75), Math.round(130 - t * 80)];
    }
    const t = (v - 0.7) / 0.3;
    return [255, Math.round(90 + t * 165), Math.round(50 + t * 180)];
  }
  if (theme === 'emerald') {
    if (v < 0.5) {
      const t = v / 0.5;
      return [Math.round(t * 16), Math.round(t * 140), Math.round(t * 95)];
    }
    const t = (v - 0.5) / 0.5;
    return [Math.round(16 + t * 220), Math.round(140 + t * 115), Math.round(95 + t * 150)];
  }
  if (v < 0.5) {
    const t = v / 0.5;
    return [0, Math.round(t * 130), Math.round(t * 200)];
  }
  const t = (v - 0.5) / 0.5;
  return [Math.round(t * 240), Math.round(130 + t * 125), Math.round(200 + t * 55)];
};

// Precomputed FFT Tables Cache for ultra-fast arbitrary window resampling
const fftCache = new Map<number, { win: Float32Array; rev: Uint32Array }>();

function getFftTables(N: number) {
  let cached = fftCache.get(N);
  if (cached) return cached;
  const bits = Math.round(Math.log2(N));
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
  }
  const rev = new Uint32Array(N);
  for (let i = 0; i < N; i++) {
    let j = 0;
    for (let bit = 0; bit < bits; bit++) {
      j = (j << 1) | ((i >> bit) & 1);
    }
    rev[i] = j;
  }
  cached = { win, rev };
  fftCache.set(N, cached);
  return cached;
}

// High-precision Radix-2 FFT over any time slice [startSec..endSec] of an AudioBuffer
function computeWindowSpectrogram(
  audioBuffer: AudioBuffer,
  startSec: number,
  endSec: number,
  numColumns: number,
  fftN: number
): Uint8Array[] {
  const half = fftN >> 1;
  const channel = audioBuffer.getChannelData(0);
  const sr = audioBuffer.sampleRate;
  const totalSamples = channel.length;
  const startSample = Math.max(0, Math.floor(startSec * sr));
  const endSample = Math.min(totalSamples, Math.ceil(endSec * sr));
  const spanSamples = Math.max(fftN, endSample - startSample);

  const { win, rev } = getFftTables(fftN);
  const re = new Float32Array(fftN);
  const im = new Float32Array(fftN);
  const frames: Uint8Array[] = [];

  for (let f = 0; f < numColumns; f++) {
    const ratio = numColumns > 1 ? f / (numColumns - 1) : 0;
    const centerSample = startSample + Math.floor(ratio * Math.max(0, spanSamples - fftN));
    const base = Math.min(Math.max(0, totalSamples - fftN), centerSample);

    for (let i = 0; i < fftN; i++) {
      const idx = rev[i];
      re[i] = (channel[base + idx] || 0) * win[idx];
      im[i] = 0;
    }

    for (let size = 2; size <= fftN; size <<= 1) {
      const halfSize = size >> 1;
      const angle = (-2 * Math.PI) / size;
      const wStepRe = Math.cos(angle);
      const wStepIm = Math.sin(angle);

      for (let i = 0; i < fftN; i += size) {
        let wRe = 1;
        let wIm = 0;
        for (let j = 0; j < halfSize; j++) {
          const even = i + j;
          const odd = even + halfSize;
          const tRe = wRe * re[odd] - wIm * im[odd];
          const tIm = wRe * im[odd] + wIm * re[odd];
          re[odd] = re[even] - tRe;
          im[odd] = im[even] - tIm;
          re[even] += tRe;
          im[even] += tIm;
          const nextWRe = wRe * wStepRe - wIm * wStepIm;
          wIm = wRe * wStepIm + wIm * wStepRe;
          wRe = nextWRe;
        }
      }
    }

    const col = new Uint8Array(half);
    for (let b = 0; b < half; b++) {
      const mag = Math.hypot(re[b], im[b]) / half;
      const db = 20 * Math.log10(mag + 1e-7);
      const norm = Math.max(0, Math.min(1, (db + 88) / 80));
      col[b] = Math.round(norm * 255);
    }
    frames.push(col);
  }
  return frames;
}

const SpectrogramLab: React.FC = () => {
  const [sourceMode, setSourceMode] = useState<'none' | 'mic' | 'file' | 'synth'>('none');
  const [isFrozen, setIsFrozen] = useState(false);
  const [theme, setTheme] = useState<HeatmapTheme>('thermal');
  const [logScale, setLogScale] = useState(true);
  const [fftSize, setFftSize] = useState<number>(2048); // 1024, 2048, 4096
  const [sampleRateSlices, setSampleRateSlices] = useState<number>(920); // columns computed per window (300 to 1840)
  const [smoothing, setSmoothing] = useState<number>(0.6);

  // Blender-Style Color Ramp (2 Sliders: Black Point / Low Cutoff & White Point / High Ceiling)
  const [rampLow, setRampLow] = useState<number>(0.12);  // 0.0 to 1.0
  const [rampHigh, setRampHigh] = useState<number>(0.85); // 0.0 to 1.0

  const [fileName, setFileName] = useState<string>('');
  const [fileDuration, setFileDuration] = useState<number>(0);
  const [isFilePlaying, setIsFilePlaying] = useState<boolean>(false);

  // Zoom & Pan State (Time Axis X & Frequency Axis Y)
  const [timeZoom, setTimeZoom] = useState<number>(1);       // 1x to 40x
  const [timePan, setTimePan] = useState<number>(1);         // 0.0 (start) to 1.0 (end/latest)
  const [autoFollow, setAutoFollow] = useState<boolean>(true);
  const [freqZoom, setFreqZoom] = useState<number>(1);       // 1x to 12x
  const [freqPan, setFreqPan] = useState<number>(0);         // 0.0 (low freq) to 1.0 (high freq)

  // Live Frequency Telemetry
  const [telemetry, setTelemetry] = useState({
    peakHz: 0,
    peakDb: -100,
    note: '—',
    cents: 0,
    centroidHz: 0,
    rmsDb: -100,
  });

  // Hover Crosshair Readout
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    y: number;
    hz: number;
    note: string;
    timeSec?: number;
  } | null>(null);

  const waterfallCanvasRef = useRef<HTMLCanvasElement>(null);
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const loadedBufferRef = useRef<AudioBuffer | null>(null);
  const fileSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const fileStartWallRef = useRef<number>(0);
  const filePauseOffsetRef = useRef<number>(0);
  const synthOscsRef = useRef<OscillatorNode[]>([]);

  // Live stream history (for Mic / Synth) & dynamic high-res window frames (for File mode)
  const historyFramesRef = useRef<Uint8Array[]>([]);
  const fileWindowFramesRef = useRef<Uint8Array[]>([]);
  const latestSpectrumRef = useRef<Uint8Array>(new Uint8Array(1024));
  const peakHoldRef = useRef<Float32Array>(new Float32Array(2048));
  const rafRef = useRef<number>(0);

  const panDragRef = useRef<{
    active: boolean;
    target: 'waterfall' | 'spectrum';
    startX: number;
    startY: number;
    initialTimePan: number;
    initialFreqPan: number;
  } | null>(null);

  const stopFilePlaybackNode = () => {
    try {
      fileSourceRef.current?.stop();
      fileSourceRef.current?.disconnect();
    } catch {}
    fileSourceRef.current = null;
    setIsFilePlaying(false);
  };

  const stopAllSources = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    stopFilePlaybackNode();
    synthOscsRef.current.forEach((o) => {
      try { o.stop(); o.disconnect(); } catch {}
    });
    synthOscsRef.current = [];
    setSourceMode('none');
  }, []);

  const initAnalyser = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    if (!analyserRef.current) {
      analyserRef.current = ctx.createAnalyser();
    }
    analyserRef.current.fftSize = fftSize;
    analyserRef.current.smoothingTimeConstant = smoothing;
    return { ctx, analyser: analyserRef.current };
  };

  const startMic = async () => {
    stopAllSources();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const { ctx, analyser } = initAnalyser();
      const src = ctx.createMediaStreamSource(stream);
      src.connect(analyser);
      micStreamRef.current = stream;
      historyFramesRef.current = [];
      peakHoldRef.current.fill(0);
      setFileDuration(0);
      setTimePan(1);
      setAutoFollow(true);
      setSourceMode('mic');
      setIsFrozen(false);
    } catch {
      alert('Microphone access was denied or unavailable.');
    }
  };

  const playLoadedAudioFrom = useCallback(
    (offsetSec: number) => {
      const buf = loadedBufferRef.current;
      if (!buf) return;
      stopFilePlaybackNode();
      const { ctx, analyser } = initAnalyser();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(analyser);
      analyser.connect(ctx.destination);
      const safeOffset = ((offsetSec % buf.duration) + buf.duration) % buf.duration;
      src.start(0, safeOffset);
      fileSourceRef.current = src;
      fileStartWallRef.current = ctx.currentTime - safeOffset;
      filePauseOffsetRef.current = safeOffset;
      setIsFilePlaying(true);
    },
    [fftSize, smoothing]
  );

  // Visible time window calculation
  const visibleTimeWindow = useMemo(() => {
    const dur = fileDuration || historyFramesRef.current.length / 60;
    if (dur <= 0) return { start: 0, end: 0 };
    const span = dur / timeZoom;
    const start = timePan * Math.max(0, dur - span);
    return { start, end: start + span };
  }, [fileDuration, timeZoom, timePan]);

  // Whenever loaded AudioBuffer, timeZoom, timePan, sampleRateSlices, or fftSize changes,
  // dynamically resample the exact visible window [start..end] at full sampling precision!
  useEffect(() => {
    if (sourceMode !== 'file' || !loadedBufferRef.current) return;
    const buf = loadedBufferRef.current;
    const dur = buf.duration;
    const span = dur / timeZoom;
    const startSec = timePan * Math.max(0, dur - span);
    const endSec = startSec + span;

    const computed = computeWindowSpectrogram(
      buf,
      startSec,
      endSec,
      sampleRateSlices,
      Math.min(2048, fftSize)
    );
    fileWindowFramesRef.current = computed;
  }, [sourceMode, fileDuration, timeZoom, timePan, sampleRateSlices, fftSize]);

  const handleFileUpload = async (file?: File) => {
    if (!file) return;
    stopAllSources();
    const { ctx } = initAnalyser();
    try {
      const buf = await ctx.decodeAudioData(await file.arrayBuffer());
      loadedBufferRef.current = buf;
      setFileName(file.name);
      setFileDuration(buf.duration);

      const initialSlices = computeWindowSpectrogram(buf, 0, buf.duration, sampleRateSlices, Math.min(2048, fftSize));
      fileWindowFramesRef.current = initialSlices;
      if (initialSlices.length > 0) {
        latestSpectrumRef.current = initialSlices[0];
      }
      peakHoldRef.current.fill(0);
      setTimeZoom(1);
      setTimePan(0);
      setAutoFollow(false);
      setSourceMode('file');
      setIsFrozen(false);
      playLoadedAudioFrom(0);
    } catch {}
  };

  const startTestSignal = () => {
    stopAllSources();
    const { ctx, analyser } = initAnalyser();
    const master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(analyser);
    analyser.connect(ctx.destination);

    const freqs = [220, 440, 880, 1760, 3520];
    const oscs: OscillatorNode[] = [];

    freqs.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 1 / (idx + 1);
      osc.connect(g);
      g.connect(master);
      osc.start();
      oscs.push(osc);
    });

    const sweepOsc = ctx.createOscillator();
    sweepOsc.type = 'sine';
    sweepOsc.frequency.value = 1200;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.35;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 900;
    lfo.connect(lfoGain);
    lfoGain.connect(sweepOsc.frequency);
    const sweepGain = ctx.createGain();
    sweepGain.gain.value = 0.35;
    sweepOsc.connect(sweepGain);
    sweepGain.connect(master);
    sweepOsc.start();
    lfo.start();
    oscs.push(sweepOsc, lfo);

    synthOscsRef.current = oscs;
    historyFramesRef.current = [];
    peakHoldRef.current.fill(0);
    setFileDuration(0);
    setTimePan(1);
    setAutoFollow(true);
    setSourceMode('synth');
    setIsFrozen(false);
  };

  useEffect(() => {
    if (analyserRef.current) analyserRef.current.fftSize = fftSize;
  }, [fftSize]);

  useEffect(() => {
    if (analyserRef.current) analyserRef.current.smoothingTimeConstant = smoothing;
  }, [smoothing]);

  const normToFreq = useCallback(
    (viewNorm: number, sampleRate: number) => {
      const nyquist = sampleRate / 2;
      const windowSpan = 1 / freqZoom;
      const startNorm = freqPan * (1 - windowSpan);
      const globalNorm = Math.max(0, Math.min(1, startNorm + viewNorm * windowSpan));
      if (logScale) {
        const minLog = Math.log10(20);
        const maxLog = Math.log10(nyquist);
        return Math.pow(10, minLog + globalNorm * (maxLog - minLog));
      }
      return globalNorm * nyquist;
    },
    [logScale, freqZoom, freqPan]
  );

  const yToFreq = useCallback(
    (y: number, height: number, sampleRate: number) => {
      const viewNorm = 1 - Math.max(0, Math.min(1, y / height));
      return normToFreq(viewNorm, sampleRate);
    },
    [normToFreq]
  );

  // Draw Waterfall Heatmap & Lower FFT Histogram using Blender ColorRamp & Dynamic Resampled Frames
  const drawCanvases = useCallback(
    (playheadSec: number | null) => {
      const wfCanvas = waterfallCanvasRef.current;
      const spCanvas = spectrumCanvasRef.current;
      if (!wfCanvas || !spCanvas) return;

      const wfCtx = wfCanvas.getContext('2d')!;
      const spCtx = spCanvas.getContext('2d')!;
      const sampleRate = loadedBufferRef.current?.sampleRate || audioCtxRef.current?.sampleRate || 44100;
      const nyquist = sampleRate / 2;

      const w = wfCanvas.width;
      const h = wfCanvas.height;

      // Determine active frame source
      if (sourceMode === 'file') {
        const frames = fileWindowFramesRef.current;
        const totalCols = frames.length;
        if (totalCols === 0) {
          wfCtx.fillStyle = '#050507';
          wfCtx.fillRect(0, 0, w, h);
        } else {
          const binLen = frames[0].length;
          const rowBins = new Uint16Array(h);
          for (let y = 0; y < h; y++) {
            const hz = yToFreq(y, h, sampleRate);
            rowBins[y] = Math.min(binLen - 1, Math.max(0, Math.floor((hz / nyquist) * binLen)));
          }

          const imgData = wfCtx.createImageData(w, h);
          const data = imgData.data;

          for (let x = 0; x < w; x++) {
            const cIdx = Math.min(totalCols - 1, Math.floor((x / w) * totalCols));
            const col = frames[cIdx];
            for (let y = 0; y < h; y++) {
              const rawNorm = col[rowBins[y]] / 255;
              const ramped = applyColorRamp(rawNorm, rampLow, rampHigh);
              const [r, g, b] = mapHeatmapColor(ramped, theme);
              const pIdx = (y * w + x) * 4;
              data[pIdx] = r;
              data[pIdx + 1] = g;
              data[pIdx + 2] = b;
              data[pIdx + 3] = 255;
            }
          }
          wfCtx.putImageData(imgData, 0, 0);

          if (playheadSec !== null && visibleTimeWindow.end > visibleTimeWindow.start) {
            if (playheadSec >= visibleTimeWindow.start && playheadSec <= visibleTimeWindow.end) {
              const px =
                ((playheadSec - visibleTimeWindow.start) /
                  (visibleTimeWindow.end - visibleTimeWindow.start)) *
                w;
              wfCtx.fillStyle = '#ffffff';
              wfCtx.fillRect(px - 1, 0, 2, h);
            }
          }
        }
      } else {
        // Live Mic / Synth history buffer
        const frames = historyFramesRef.current;
        const totalFrames = frames.length;
        if (totalFrames === 0) {
          wfCtx.fillStyle = '#050507';
          wfCtx.fillRect(0, 0, w, h);
        } else {
          const binLen = frames[0].length;
          const visibleFrames = Math.max(10, totalFrames / timeZoom);
          const maxStartFrame = Math.max(0, totalFrames - visibleFrames);
          const startFrame = timePan * maxStartFrame;

          const rowBins = new Uint16Array(h);
          for (let y = 0; y < h; y++) {
            const hz = yToFreq(y, h, sampleRate);
            rowBins[y] = Math.min(binLen - 1, Math.max(0, Math.floor((hz / nyquist) * binLen)));
          }

          const imgData = wfCtx.createImageData(w, h);
          const data = imgData.data;

          for (let x = 0; x < w; x++) {
            const fIdx = Math.min(
              totalFrames - 1,
              Math.max(0, Math.floor(startFrame + (x / w) * visibleFrames))
            );
            const col = frames[fIdx];
            if (!col) continue;
            const cLen = col.length;
            for (let y = 0; y < h; y++) {
              const bin = Math.min(cLen - 1, rowBins[y]);
              const rawNorm = col[bin] / 255;
              const ramped = applyColorRamp(rawNorm, rampLow, rampHigh);
              const [r, g, b] = mapHeatmapColor(ramped, theme);
              const pIdx = (y * w + x) * 4;
              data[pIdx] = r;
              data[pIdx + 1] = g;
              data[pIdx + 2] = b;
              data[pIdx + 3] = 255;
            }
          }
          wfCtx.putImageData(imgData, 0, 0);
        }
      }

      // 2. Render Lower FFT Frequency Histogram with ColorRamp Applied
      const sw = spCanvas.width;
      const sh = spCanvas.height;
      spCtx.fillStyle = '#070708';
      spCtx.fillRect(0, 0, sw, sh);

      spCtx.strokeStyle = '#18181f';
      spCtx.lineWidth = 1;
      for (let gy = 0; gy < sh; gy += sh / 4) {
        spCtx.beginPath();
        spCtx.moveTo(0, gy);
        spCtx.lineTo(sw, gy);
        spCtx.stroke();
      }

      const activeSpec = latestSpectrumRef.current;
      const specLen = activeSpec.length || 1;
      const numBars = 180;
      const barW = sw / numBars;

      for (let i = 0; i < numBars; i++) {
        const viewNorm = i / numBars;
        const hz = normToFreq(viewNorm, sampleRate);
        const bin = Math.min(specLen - 1, Math.max(0, Math.floor((hz / nyquist) * specLen)));
        const rawNorm = activeSpec[bin] / 255;
        const val = applyColorRamp(rawNorm, rampLow, rampHigh);
        const barH = val * (sh - 20);

        const [r, g, b] = mapHeatmapColor(val, theme);
        spCtx.fillStyle = `rgb(${r},${g},${b})`;
        spCtx.fillRect(i * barW + 1, sh - 16 - barH, Math.max(1, barW - 1.5), barH);
      }

      // Peak-Hold Curve
      spCtx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      spCtx.lineWidth = 1.2;
      spCtx.beginPath();
      for (let i = 0; i < numBars; i++) {
        const viewNorm = i / numBars;
        const hz = normToFreq(viewNorm, sampleRate);
        const bin = Math.min(specLen - 1, Math.max(0, Math.floor((hz / nyquist) * specLen)));
        const pk = applyColorRamp(peakHoldRef.current[bin] / 255, rampLow, rampHigh);
        const py = sh - 16 - pk * (sh - 20);
        if (i === 0) spCtx.moveTo(i * barW, py);
        else spCtx.lineTo(i * barW, py);
      }
      spCtx.stroke();

      // Frequency X-Axis Ticks
      spCtx.fillStyle = '#71717a';
      spCtx.font = '10px "JetBrains Mono", monospace';
      for (let t = 0; t <= 6; t++) {
        const norm = t / 6;
        const hz = Math.round(normToFreq(norm, sampleRate));
        const label = hz >= 1000 ? `${(hz / 1000).toFixed(1)}kHz` : `${hz}Hz`;
        const tx = Math.min(sw - 38, Math.max(4, norm * sw - 16));
        spCtx.fillText(label, tx, sh - 3);
      }
    },
    [sourceMode, timeZoom, timePan, rampLow, rampHigh, theme, yToFreq, normToFreq, visibleTimeWindow]
  );

  useEffect(() => {
    drawCanvases(sourceMode === 'file' ? filePauseOffsetRef.current : null);
  }, [
    timeZoom,
    timePan,
    freqZoom,
    freqPan,
    theme,
    logScale,
    rampLow,
    rampHigh,
    sampleRateSlices,
    fftSize,
    drawCanvases,
    sourceMode,
  ]);

  // Main Real-Time Loop
  useEffect(() => {
    if (sourceMode === 'none') return;

    const analyser = analyserRef.current;
    const ctxAudio = audioCtxRef.current;
    if (!analyser || !ctxAudio) return;

    let frameCount = 0;

    const renderLoop = () => {
      rafRef.current = requestAnimationFrame(renderLoop);
      if (isFrozen) return;

      const binCount = analyser.frequencyBinCount;
      const freqData = new Uint8Array(binCount);
      const timeData = new Float32Array(binCount);
      analyser.getByteFrequencyData(freqData);
      analyser.getFloatTimeDomainData(timeData);

      const sampleRate = ctxAudio.sampleRate;
      const nyquist = sampleRate / 2;

      const col = new Uint8Array(binCount);
      for (let b = 0; b < binCount; b++) {
        const v = freqData[b];
        col[b] = v;
        if (v > peakHoldRef.current[b]) {
          peakHoldRef.current[b] = v;
        } else {
          peakHoldRef.current[b] = Math.max(0, peakHoldRef.current[b] - 0.35);
        }
      }
      latestSpectrumRef.current = col;

      if (sourceMode === 'mic' || sourceMode === 'synth') {
        historyFramesRef.current.push(col);
        const maxHistory = Math.max(4000, sampleRateSlices * 6);
        if (historyFramesRef.current.length > maxHistory) {
          historyFramesRef.current.shift();
        }
        if (autoFollow) setTimePan(1);
      }

      let playheadSec: number | null = null;
      if (sourceMode === 'file' && loadedBufferRef.current) {
        const dur = loadedBufferRef.current.duration;
        playheadSec = isFilePlaying
          ? ((ctxAudio.currentTime - fileStartWallRef.current) % dur + dur) % dur
          : filePauseOffsetRef.current;

        if (autoFollow && isFilePlaying && timeZoom > 1) {
          const playRatio = dur > 0 ? playheadSec / dur : 0;
          const visRatio = 1 / timeZoom;
          const centered = Math.max(0, Math.min(1, (playRatio - visRatio / 2) / Math.max(0.001, 1 - visRatio)));
          setTimePan(centered);
        }
      }

      let maxVal = 0;
      let maxBin = 0;
      let weightedSum = 0;
      let magSum = 0;

      for (let i = 1; i < binCount; i++) {
        const v = freqData[i];
        const binHz = (i / binCount) * nyquist;
        weightedSum += binHz * v;
        magSum += v;
        if (v > maxVal) {
          maxVal = v;
          maxBin = i;
        }
      }

      let sumSq = 0;
      for (let i = 0; i < timeData.length; i++) sumSq += timeData[i] * timeData[i];
      const rms = Math.sqrt(sumSq / timeData.length);
      const rmsDb = rms > 0.00001 ? Math.round(20 * Math.log10(rms)) : -100;

      let refinedBin = maxBin;
      if (maxBin > 0 && maxBin < binCount - 1) {
        const alpha = freqData[maxBin - 1];
        const beta = freqData[maxBin];
        const gamma = freqData[maxBin + 1];
        const denom = alpha - 2 * beta + gamma;
        if (denom !== 0) refinedBin = maxBin + (0.5 * (alpha - gamma)) / denom;
      }

      const peakHz = maxVal > 8 ? (refinedBin / binCount) * nyquist : 0;
      const peakDb = maxVal > 0 ? Math.round((maxVal / 255) * 90 - 90) : -100;
      const centroidHz = magSum > 0 ? Math.round(weightedSum / magSum) : 0;

      if (frameCount++ % 3 === 0) {
        const { note, cents } = freqToNote(peakHz);
        setTelemetry({
          peakHz: Math.round(peakHz),
          peakDb,
          note,
          cents,
          centroidHz,
          rmsDb,
        });
      }

      drawCanvases(playheadSec);
    };

    rafRef.current = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [sourceMode, isFrozen, autoFollow, isFilePlaying, timeZoom, sampleRateSlices, drawCanvases]);

  // Global Mouse Drag Handler for Canvas Panning
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = panDragRef.current;
      if (!drag || !drag.active) return;

      if (drag.target === 'waterfall' && waterfallCanvasRef.current) {
        const rect = waterfallCanvasRef.current.getBoundingClientRect();
        const dxRatio = (e.clientX - drag.startX) / rect.width;
        const dyRatio = (e.clientY - drag.startY) / rect.height;

        if (timeZoom > 1) {
          setAutoFollow(false);
          setTimePan(Math.max(0, Math.min(1, drag.initialTimePan - dxRatio)));
        }
        if (freqZoom > 1) {
          setFreqPan(Math.max(0, Math.min(1, drag.initialFreqPan + dyRatio)));
        }
      } else if (drag.target === 'spectrum' && spectrumCanvasRef.current) {
        const rect = spectrumCanvasRef.current.getBoundingClientRect();
        const dxRatio = (e.clientX - drag.startX) / rect.width;
        if (freqZoom > 1) {
          setFreqPan(Math.max(0, Math.min(1, drag.initialFreqPan - dxRatio)));
        }
      }
    };

    const onUp = () => {
      if (panDragRef.current) panDragRef.current.active = false;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [timeZoom, freqZoom]);

  useEffect(() => () => stopAllSources(), [stopAllSources]);

  const exportSpectrogramPNG = () => {
    const canvas = waterfallCanvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `monolith-spectrogram-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const sampleRate = loadedBufferRef.current?.sampleRate || audioCtxRef.current?.sampleRate || 44100;
  const freqAxisTicks = [1, 0.85, 0.7, 0.55, 0.4, 0.25, 0.1, 0].map((n) => {
    const hz = Math.round(normToFreq(n, sampleRate));
    return hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${hz} Hz`;
  });

  // Build CSS linear-gradient string for the Blender-style ColorRamp preview bar
  const colorRampGradientCss = useMemo(() => {
    const stops: string[] = [];
    for (let i = 0; i <= 20; i++) {
      const pct = i / 20;
      const ramped = applyColorRamp(pct, rampLow, rampHigh);
      const [r, g, b] = mapHeatmapColor(ramped, theme);
      stops.push(`rgb(${r},${g},${b}) ${pct * 100}%`);
    }
    return `linear-gradient(to right, ${stops.join(', ')})`;
  }, [rampLow, rampHigh, theme]);

  return (
    <div className="space-y-4">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-white">Spectrogram & Frequency Analyzer</h1>
          {sourceMode === 'file' && fileName && (
            <span className="font-mono text-xs text-zinc-400 truncate max-w-[180px]">{fileName}</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={sourceMode === 'mic' ? stopAllSources : startMic}
            className={`px-3 py-1.5 rounded text-xs font-medium border ${
              sourceMode === 'mic'
                ? 'bg-[#ff4f00] text-black border-[#ff4f00] font-semibold'
                : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border-zinc-800'
            }`}
          >
            <i className="fas fa-microphone mr-1.5 text-[11px]"></i>
            {sourceMode === 'mic' ? 'Stop Mic' : 'Live Mic'}
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            className={`px-3 py-1.5 rounded text-xs font-medium border ${
              sourceMode === 'file'
                ? 'bg-white text-black border-white font-semibold'
                : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border-zinc-800'
            }`}
          >
            Open Audio File
          </button>

          {sourceMode === 'file' && (
            <button
              onClick={() => {
                if (isFilePlaying) {
                  if (audioCtxRef.current && loadedBufferRef.current) {
                    const dur = loadedBufferRef.current.duration;
                    filePauseOffsetRef.current =
                      ((audioCtxRef.current.currentTime - fileStartWallRef.current) % dur + dur) % dur;
                  }
                  stopFilePlaybackNode();
                } else {
                  playLoadedAudioFrom(filePauseOffsetRef.current);
                }
              }}
              className="px-3 py-1.5 rounded bg-[#ff4f00] text-black text-xs font-semibold"
            >
              {isFilePlaying ? 'Pause Audio' : 'Play Audio'}
            </button>
          )}

          <button
            onClick={sourceMode === 'synth' ? stopAllSources : startTestSignal}
            className={`px-3 py-1.5 rounded text-xs font-medium border ${
              sourceMode === 'synth'
                ? 'bg-white text-black border-white font-semibold'
                : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border-zinc-800'
            }`}
          >
            Test Signal
          </button>

          {sourceMode !== 'none' && (
            <>
              <button
                onClick={() => setIsFrozen(!isFrozen)}
                className={`px-3 py-1.5 rounded text-xs font-mono border ${
                  isFrozen
                    ? 'bg-white text-black border-white font-semibold'
                    : 'bg-zinc-900 text-zinc-300 border-zinc-800'
                }`}
              >
                {isFrozen ? 'Resume' : 'Freeze'}
              </button>

              <button
                onClick={exportSpectrogramPNG}
                className="px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs text-zinc-200"
              >
                Export PNG
              </button>
            </>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,video/*"
        onChange={(e) => handleFileUpload(e.target.files?.[0])}
        className="hidden"
      />

      {/* Live Frequency Telemetry Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 font-mono text-xs">
        <div className="studio-panel rounded-lg p-3">
          <div className="text-[10px] text-zinc-500">DOMINANT FREQ</div>
          <div className="text-base font-bold text-white mt-0.5">
            {telemetry.peakHz > 0 ? `${telemetry.peakHz} Hz` : '—'}
          </div>
        </div>
        <div className="studio-panel rounded-lg p-3">
          <div className="text-[10px] text-zinc-500">PITCH / NOTE</div>
          <div className="text-base font-bold text-[#ff4f00] mt-0.5">
            {telemetry.note}{' '}
            {telemetry.peakHz > 0 && (
              <span className="text-xs text-zinc-400">
                ({telemetry.cents >= 0 ? `+${telemetry.cents}` : telemetry.cents}ct)
              </span>
            )}
          </div>
        </div>
        <div className="studio-panel rounded-lg p-3">
          <div className="text-[10px] text-zinc-500">PEAK MAGNITUDE</div>
          <div className="text-base font-bold text-white mt-0.5">
            {telemetry.peakDb > -99 ? `${telemetry.peakDb} dB` : '—'}
          </div>
        </div>
        <div className="studio-panel rounded-lg p-3">
          <div className="text-[10px] text-zinc-500">SPECTRAL CENTROID</div>
          <div className="text-base font-bold text-zinc-200 mt-0.5">
            {telemetry.centroidHz > 0 ? `${telemetry.centroidHz} Hz` : '—'}
          </div>
        </div>
        <div className="studio-panel rounded-lg p-3 col-span-2 sm:col-span-1">
          <div className="text-[10px] text-zinc-500">RMS LEVEL</div>
          <div className="text-base font-bold text-zinc-200 mt-0.5">
            {telemetry.rmsDb > -99 ? `${telemetry.rmsDb} dBFS` : '—'}
          </div>
        </div>
      </div>

      {/* Main Waterfall Heatmap + Histogram + Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-9 space-y-3">
          {/* 2D Waterfall Heatmap Spectrogram */}
          <div className="studio-panel rounded-lg overflow-hidden">
            <div className="h-8 px-3 bg-[#0a0a0d] border-b border-zinc-800/80 flex items-center justify-between text-[11px] font-mono text-zinc-400">
              <div className="flex items-center gap-3">
                <span>
                  Time Zoom: <strong className="text-white">{timeZoom.toFixed(1)}x</strong>
                </span>
                <span>
                  Freq Zoom: <strong className="text-white">{freqZoom.toFixed(1)}x</strong>
                </span>
                <span>
                  Rate: <strong className="text-white">{sampleRateSlices} slices</strong>
                </span>
                {visibleTimeWindow.end > 0 && (
                  <span className="hidden sm:inline text-zinc-500">
                    {visibleTimeWindow.start.toFixed(2)}s – {visibleTimeWindow.end.toFixed(2)}s
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {(timeZoom > 1 || freqZoom > 1) && (
                  <button
                    onClick={() => {
                      setTimeZoom(1);
                      setFreqZoom(1);
                      setFreqPan(0);
                      setTimePan(sourceMode === 'file' ? 0 : 1);
                    }}
                    className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-white hover:text-black text-zinc-200 text-[10px]"
                  >
                    Reset 1:1
                  </button>
                )}
              </div>
            </div>

            <div
              onWheel={(e) => {
                e.preventDefault();
                const factor = e.deltaY < 0 ? 1.25 : 0.8;
                if (e.shiftKey) {
                  setFreqZoom((z) => Math.max(1, Math.min(12, Number((z * factor).toFixed(2)))));
                } else {
                  setTimeZoom((z) => Math.max(1, Math.min(40, Number((z * factor).toFixed(2)))));
                }
              }}
              onMouseDown={(e) => {
                panDragRef.current = {
                  active: true,
                  target: 'waterfall',
                  startX: e.clientX,
                  startY: e.clientY,
                  initialTimePan: timePan,
                  initialFreqPan: freqPan,
                };
              }}
              onDoubleClick={(e) => {
                if (sourceMode === 'file' && loadedBufferRef.current) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratioX = (e.clientX - rect.left) / rect.width;
                  const targetSec =
                    visibleTimeWindow.start + ratioX * (visibleTimeWindow.end - visibleTimeWindow.start);
                  playLoadedAudioFrom(targetSec);
                }
              }}
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const y = e.clientY - rect.top;
                const x = e.clientX - rect.left;
                const hz = Math.round(yToFreq(y, rect.height, sampleRate));
                const { note } = freqToNote(hz);
                const ratioX = Math.max(0, Math.min(1, x / rect.width));
                const timeSec =
                  visibleTimeWindow.end > 0
                    ? visibleTimeWindow.start + ratioX * (visibleTimeWindow.end - visibleTimeWindow.start)
                    : undefined;
                setHoverInfo({ x, y, hz, note, timeSec });
              }}
              onMouseLeave={() => setHoverInfo(null)}
              className={`relative bg-[#050507] ${
                timeZoom > 1 || freqZoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'
              }`}
            >
              <canvas
                ref={waterfallCanvasRef}
                width={960}
                height={340}
                className="w-full h-72 sm:h-80 block"
              />

              {/* Dynamic Frequency Y-Axis Scale Overlay */}
              <div className="absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-black/85 to-transparent flex flex-col justify-between py-2 pr-2 text-right font-mono text-[10px] text-zinc-300 pointer-events-none">
                {freqAxisTicks.map((lbl, idx) => (
                  <span key={idx}>{lbl}</span>
                ))}
              </div>

              {/* Mouse Crosshair */}
              {hoverInfo && (
                <>
                  <div
                    style={{ top: `${hoverInfo.y}px` }}
                    className="absolute inset-x-0 h-[1px] bg-white/40 pointer-events-none"
                  />
                  <div
                    style={{ left: `${hoverInfo.x}px` }}
                    className="absolute inset-y-0 w-[1px] bg-white/25 pointer-events-none"
                  />
                  <div
                    style={{
                      top: `${Math.max(8, hoverInfo.y - 28)}px`,
                      left: `${Math.min(260, hoverInfo.x + 12)}px`,
                    }}
                    className="absolute px-2 py-0.5 rounded bg-black/90 border border-zinc-700 font-mono text-[11px] text-white pointer-events-none"
                  >
                    {hoverInfo.hz} Hz • <span className="text-[#ff4f00]">{hoverInfo.note}</span>
                    {hoverInfo.timeSec !== undefined && (
                      <span className="text-zinc-400 ml-1.5">@ {hoverInfo.timeSec.toFixed(2)}s</span>
                    )}
                  </div>
                </>
              )}

              {sourceMode === 'none' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-xs text-zinc-500 gap-2 pointer-events-none">
                  <span>Enable Live Mic, Open Audio File, or start Test Signal to view heatmap</span>
                </div>
              )}
            </div>

            {/* Horizontal Time Pan / Scroll Bar for Long Audio */}
            <div className="p-2.5 bg-[#0a0a0d] border-t border-zinc-800/80 flex items-center gap-3">
              <button
                onClick={() => {
                  setAutoFollow(false);
                  setTimePan((p) => Math.max(0, Number((p - 0.08).toFixed(4))));
                }}
                className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-mono text-zinc-300"
              >
                ← Left
              </button>

              <div className="flex-1 flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase text-zinc-500 whitespace-nowrap">
                  Time Position
                </span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.001"
                  value={timePan}
                  onChange={(e) => {
                    setAutoFollow(false);
                    setTimePan(parseFloat(e.target.value));
                  }}
                />
              </div>

              <button
                onClick={() => {
                  setAutoFollow(false);
                  setTimePan((p) => Math.min(1, Number((p + 0.08).toFixed(4))));
                }}
                className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-mono text-zinc-300"
              >
                Right →
              </button>

              <button
                onClick={() => {
                  setAutoFollow(!autoFollow);
                  if (!autoFollow && sourceMode !== 'file') setTimePan(1);
                }}
                className={`px-2.5 py-1 rounded text-[10px] font-mono border ${
                  autoFollow
                    ? 'bg-white text-black border-white font-semibold'
                    : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                }`}
              >
                Follow
              </button>
            </div>
          </div>

          {/* Lower FFT Frequency Histogram */}
          <div className="studio-panel rounded-lg overflow-hidden bg-[#070708]">
            <div className="h-7 px-3 bg-[#0a0a0d] border-b border-zinc-800/80 flex items-center justify-between text-[10px] font-mono text-zinc-400">
              <span>FFT FREQUENCY HISTOGRAM (WHEEL TO ZOOM • DRAG LEFT/RIGHT TO PAN)</span>
              <span>
                {Math.round(normToFreq(0, sampleRate))} Hz – {Math.round(normToFreq(1, sampleRate))} Hz
              </span>
            </div>
            <div
              onWheel={(e) => {
                e.preventDefault();
                const factor = e.deltaY < 0 ? 1.25 : 0.8;
                setFreqZoom((z) => Math.max(1, Math.min(12, Number((z * factor).toFixed(2)))));
              }}
              onMouseDown={(e) => {
                panDragRef.current = {
                  active: true,
                  target: 'spectrum',
                  startX: e.clientX,
                  startY: e.clientY,
                  initialTimePan: timePan,
                  initialFreqPan: freqPan,
                };
              }}
              className={freqZoom > 1 ? 'cursor-grab active:cursor-grabbing p-2' : 'p-2'}
            >
              <canvas
                ref={spectrumCanvasRef}
                width={960}
                height={140}
                className="w-full h-32 block"
              />
            </div>
          </div>
        </div>

        {/* Right Controls: Blender ColorRamp, Sampling Rate, Zoom & DSP */}
        <div className="lg:col-span-3 studio-panel rounded-lg p-4 space-y-4">
          {/* 1. BLENDER-STYLE COLOR RAMP (2 SLIDERS) */}
          <div className="space-y-2.5 pb-3 border-b border-zinc-800">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono uppercase text-zinc-300 font-semibold">
                Color Ramp
              </span>
              <button
                onClick={() => {
                  setRampLow(0.12);
                  setRampHigh(0.85);
                }}
                className="text-[10px] font-mono text-zinc-500 hover:text-white"
              >
                Reset
              </button>
            </div>

            {/* Visual ColorRamp Gradient Preview with Stop Markers */}
            <div className="relative h-5 rounded border border-zinc-700 overflow-hidden" style={{ background: colorRampGradientCss }}>
              <div
                style={{ left: `${rampLow * 100}%` }}
                className="absolute inset-y-0 w-1 -ml-0.5 bg-black border-x border-white pointer-events-none"
              />
              <div
                style={{ left: `${rampHigh * 100}%` }}
                className="absolute inset-y-0 w-1 -ml-0.5 bg-white border-x border-black pointer-events-none"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Low Cut (Dark Stop)</span>
                <span className="font-mono text-zinc-200">{Math.round(rampLow * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="0.98"
                step="0.01"
                value={rampLow}
                onChange={(e) => setRampLow(parseFloat(e.target.value))}
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">High Cut (Bright Stop)</span>
                <span className="font-mono text-zinc-200">{Math.round(rampHigh * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.02"
                max="1"
                step="0.01"
                value={rampHigh}
                onChange={(e) => setRampHigh(parseFloat(e.target.value))}
              />
            </div>
          </div>

          {/* 2. SAMPLING RATE / TEMPORAL & FFT PRECISION */}
          <div className="space-y-2.5 pb-3 border-b border-zinc-800">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-300 font-medium">Sampling Rate (Slices)</span>
              <span className="font-mono text-white">{sampleRateSlices}</span>
            </div>
            <input
              type="range"
              min="240"
              max="1920"
              step="120"
              value={sampleRateSlices}
              onChange={(e) => setSampleRateSlices(parseInt(e.target.value))}
            />

            <div>
              <label className="block text-[10px] font-mono uppercase text-zinc-500 mb-1">
                FFT Frequency Bins
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[1024, 2048, 4096].map((sz) => (
                  <button
                    key={sz}
                    onClick={() => setFftSize(sz)}
                    className={`py-1 rounded text-xs font-mono border ${
                      fftSize === sz
                        ? 'bg-white text-black border-white font-semibold'
                        : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                    }`}
                  >
                    {sz}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 3. ZOOM & PAN CONTROLS */}
          <div className="space-y-2.5 pb-3 border-b border-zinc-800">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Time Zoom (X)</span>
              <span className="font-mono text-white">{timeZoom.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="1"
              max="40"
              step="0.5"
              value={timeZoom}
              onChange={(e) => setTimeZoom(parseFloat(e.target.value))}
            />

            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Freq Zoom (Histogram)</span>
              <span className="font-mono text-white">{freqZoom.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="1"
              max="12"
              step="0.25"
              value={freqZoom}
              onChange={(e) => setFreqZoom(parseFloat(e.target.value))}
            />

            {freqZoom > 1 && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-400">Freq Band Pan</span>
                  <span className="font-mono text-zinc-200">{Math.round(freqPan * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={freqPan}
                  onChange={(e) => setFreqPan(parseFloat(e.target.value))}
                />
              </div>
            )}
          </div>

          {/* 4. PALETTE & SCALE */}
          <div>
            <label className="block text-[10px] font-mono uppercase text-zinc-500 mb-1.5">
              Heatmap Palette
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { id: 'thermal', label: 'Thermal' },
                { id: 'magma', label: 'Magma' },
                { id: 'emerald', label: 'Viridis' },
                { id: 'radar', label: 'Cyan' },
                { id: 'mono', label: 'Mono B&W' },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id as HeatmapTheme)}
                  className={`py-1.5 px-2 rounded text-xs font-mono border text-left ${
                    theme === t.id
                      ? 'bg-white text-black border-white font-semibold'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => setLogScale(true)}
              className={`py-1.5 rounded text-xs font-mono border ${
                logScale
                  ? 'bg-white text-black border-white font-semibold'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-800'
              }`}
            >
              Logarithmic
            </button>
            <button
              onClick={() => setLogScale(false)}
              className={`py-1.5 rounded text-xs font-mono border ${
                !logScale
                  ? 'bg-white text-black border-white font-semibold'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-800'
              }`}
            >
              Linear
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SpectrogramLab;
