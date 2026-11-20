import React, { useState, useRef, useEffect, useCallback } from 'react';

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

// Map normalized intensity [0..1] to RGB [r, g, b] for the heatmap waterfall
const mapHeatmapColor = (val: number, theme: HeatmapTheme): [number, number, number] => {
  const v = Math.max(0, Math.min(1, val));
  if (theme === 'mono') {
    const c = Math.round(Math.pow(v, 1.15) * 255);
    return [c, c, c];
  }
  if (theme === 'thermal') {
    // Black -> Deep Indigo -> Signal Orange (#ff4f00) -> Bright White
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
  // radar (cyan/blue)
  if (v < 0.5) {
    const t = v / 0.5;
    return [0, Math.round(t * 130), Math.round(t * 200)];
  }
  const t = (v - 0.5) / 0.5;
  return [Math.round(t * 240), Math.round(130 + t * 125), Math.round(200 + t * 55)];
};

const SpectrogramLab: React.FC = () => {
  const [sourceMode, setSourceMode] = useState<'none' | 'mic' | 'file' | 'synth'>('none');
  const [isFrozen, setIsFrozen] = useState(false);
  const [theme, setTheme] = useState<HeatmapTheme>('thermal');
  const [logScale, setLogScale] = useState(true);
  const [fftSize, setFftSize] = useState<number>(2048);
  const [scrollSpeed, setScrollSpeed] = useState<number>(2);
  const [smoothing, setSmoothing] = useState<number>(0.65);
  const [gainBoost, setGainBoost] = useState<number>(1.2);
  const [fileName, setFileName] = useState<string>('');

  // Live Frequency Telemetry
  const [telemetry, setTelemetry] = useState({
    peakHz: 0,
    peakDb: -100,
    note: '—',
    cents: 0,
    centroidHz: 0,
    rmsDb: -100,
  });

  // Hover Crosshair Readout on Waterfall
  const [hoverInfo, setHoverInfo] = useState<{ x: number; y: number; hz: number; note: string } | null>(null);

  const waterfallCanvasRef = useRef<HTMLCanvasElement>(null);
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const fileSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const synthOscsRef = useRef<OscillatorNode[]>([]);
  const peakHoldRef = useRef<Float32Array>(new Float32Array(2048));
  const rafRef = useRef<number>(0);

  const stopAllSources = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    try {
      fileSourceRef.current?.stop();
      fileSourceRef.current?.disconnect();
    } catch {}
    fileSourceRef.current = null;

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
    peakHoldRef.current = new Float32Array(analyserRef.current.frequencyBinCount);
    return { ctx, analyser: analyserRef.current };
  };

  // Start Live Microphone
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
      setSourceMode('mic');
      setIsFrozen(false);
    } catch {
      alert('Microphone access was denied or unavailable.');
    }
  };

  // Start Audio File Analysis
  const handleFileUpload = async (file?: File) => {
    if (!file) return;
    stopAllSources();
    const { ctx, analyser } = initAnalyser();
    try {
      const buf = await ctx.decodeAudioData(await file.arrayBuffer());
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(analyser);
      analyser.connect(ctx.destination);
      src.start(0);
      fileSourceRef.current = src;
      setFileName(file.name);
      setSourceMode('file');
      setIsFrozen(false);
    } catch {}
  };

  // Start Multi-Harmonic Test Signal
  const startTestSignal = () => {
    stopAllSources();
    const { ctx, analyser } = initAnalyser();
    const master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(analyser);
    analyser.connect(ctx.destination);

    // Fundamental + Harmonics + Sweeping LFO modulated tone
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

    // Add a slow sweeping oscillator (300 Hz <-> 2400 Hz)
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
    setSourceMode('synth');
    setIsFrozen(false);
  };

  useEffect(() => {
    if (analyserRef.current) {
      analyserRef.current.fftSize = fftSize;
      peakHoldRef.current = new Float32Array(analyserRef.current.frequencyBinCount);
    }
  }, [fftSize]);

  useEffect(() => {
    if (analyserRef.current) {
      analyserRef.current.smoothingTimeConstant = smoothing;
    }
  }, [smoothing]);

  // Map Y canvas coordinate [0..height] to frequency in Hz
  const yToFreq = useCallback(
    (y: number, height: number, sampleRate: number) => {
      const nyquist = sampleRate / 2;
      const norm = 1 - Math.max(0, Math.min(1, y / height)); // 0 at bottom, 1 at top
      if (logScale) {
        const minLog = Math.log10(20);
        const maxLog = Math.log10(nyquist);
        return Math.pow(10, minLog + norm * (maxLog - minLog));
      }
      return norm * nyquist;
    },
    [logScale]
  );

  // Main Waterfall Heatmap + FFT Spectrum Render Loop
  useEffect(() => {
    if (sourceMode === 'none') return;

    const wfCanvas = waterfallCanvasRef.current;
    const spCanvas = spectrumCanvasRef.current;
    const analyser = analyserRef.current;
    const ctxAudio = audioCtxRef.current;
    if (!wfCanvas || !spCanvas || !analyser || !ctxAudio) return;

    const wfCtx = wfCanvas.getContext('2d', { willReadFrequently: true })!;
    const spCtx = spCanvas.getContext('2d')!;
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

      // 1. Compute Telemetry (Peak Bin, Spectral Centroid, RMS dB)
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
        if (v > peakHoldRef.current[i]) {
          peakHoldRef.current[i] = v;
        } else {
          peakHoldRef.current[i] = Math.max(0, peakHoldRef.current[i] - 0.35);
        }
      }

      let sumSq = 0;
      for (let i = 0; i < timeData.length; i++) sumSq += timeData[i] * timeData[i];
      const rms = Math.sqrt(sumSq / timeData.length);
      const rmsDb = rms > 0.00001 ? Math.round(20 * Math.log10(rms)) : -100;

      // Quadratic interpolation for sub-bin peak frequency accuracy
      let refinedBin = maxBin;
      if (maxBin > 0 && maxBin < binCount - 1) {
        const alpha = freqData[maxBin - 1];
        const beta = freqData[maxBin];
        const gamma = freqData[maxBin + 1];
        const denom = alpha - 2 * beta + gamma;
        if (denom !== 0) {
          refinedBin = maxBin + (0.5 * (alpha - gamma)) / denom;
        }
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

      // 2. Render 2D Waterfall Heatmap Spectrogram
      const w = wfCanvas.width;
      const h = wfCanvas.height;
      const dx = scrollSpeed;

      // Shift existing waterfall left by `dx` pixels
      wfCtx.drawImage(wfCanvas, dx, 0, w - dx, h, 0, 0, w - dx, h);

      // Paint new vertical slice of width `dx` on right edge
      const sliceImg = wfCtx.createImageData(dx, h);
      const sliceData = sliceImg.data;

      for (let y = 0; y < h; y++) {
        const hz = yToFreq(y, h, sampleRate);
        const binFloat = (hz / nyquist) * binCount;
        const binIdx = Math.min(binCount - 1, Math.max(0, Math.floor(binFloat)));
        const rawIntensity = (freqData[binIdx] / 255) * gainBoost;
        const [r, g, b] = mapHeatmapColor(rawIntensity, theme);

        for (let sx = 0; sx < dx; sx++) {
          const pIdx = (y * dx + sx) * 4;
          sliceData[pIdx] = r;
          sliceData[pIdx + 1] = g;
          sliceData[pIdx + 2] = b;
          sliceData[pIdx + 3] = 255;
        }
      }
      wfCtx.putImageData(sliceImg, w - dx, 0);

      // 3. Render Live FFT Spectrum Analyzer + Peak Hold Envelope
      const sw = spCanvas.width;
      const sh = spCanvas.height;
      spCtx.fillStyle = '#070708';
      spCtx.fillRect(0, 0, sw, sh);

      // Grid lines
      spCtx.strokeStyle = '#18181f';
      spCtx.lineWidth = 1;
      for (let gy = 0; gy < sh; gy += sh / 4) {
        spCtx.beginPath();
        spCtx.moveTo(0, gy);
        spCtx.lineTo(sw, gy);
        spCtx.stroke();
      }

      const numBars = 140;
      const barW = sw / numBars;

      // Live spectrum bars
      for (let i = 0; i < numBars; i++) {
        const normX = i / numBars;
        const hz = logScale
          ? Math.pow(10, Math.log10(20) + normX * (Math.log10(nyquist) - Math.log10(20)))
          : normX * nyquist;
        const bin = Math.min(binCount - 1, Math.max(0, Math.floor((hz / nyquist) * binCount)));
        const val = Math.min(1, (freqData[bin] / 255) * gainBoost);
        const barH = val * (sh - 12);

        const [r, g, b] = mapHeatmapColor(Math.max(0.25, val), theme);
        spCtx.fillStyle = `rgb(${r},${g},${b})`;
        spCtx.fillRect(i * barW + 1, sh - barH, Math.max(1, barW - 1.5), barH);
      }

      // Peak-Hold Line
      spCtx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      spCtx.lineWidth = 1.2;
      spCtx.beginPath();
      for (let i = 0; i < numBars; i++) {
        const normX = i / numBars;
        const hz = logScale
          ? Math.pow(10, Math.log10(20) + normX * (Math.log10(nyquist) - Math.log10(20)))
          : normX * nyquist;
        const bin = Math.min(binCount - 1, Math.max(0, Math.floor((hz / nyquist) * binCount)));
        const pk = Math.min(1, (peakHoldRef.current[bin] / 255) * gainBoost);
        const py = sh - pk * (sh - 12);
        if (i === 0) spCtx.moveTo(i * barW, py);
        else spCtx.lineTo(i * barW, py);
      }
      spCtx.stroke();
    };

    rafRef.current = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [sourceMode, isFrozen, theme, logScale, scrollSpeed, gainBoost, yToFreq]);

  useEffect(() => () => stopAllSources(), [stopAllSources]);

  const exportSpectrogramPNG = () => {
    const canvas = waterfallCanvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `monolith-spectrogram-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const freqLabels = logScale
    ? ['20 kHz', '10 kHz', '5 kHz', '2 kHz', '1 kHz', '500 Hz', '200 Hz', '80 Hz', '20 Hz']
    : ['22 kHz', '16 kHz', '11 kHz', '5.5 kHz', '0 Hz'];

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

      {/* Main Waterfall Heatmap + Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-9 space-y-3">
          {/* 2D Waterfall Heatmap Spectrogram */}
          <div className="studio-panel rounded-lg overflow-hidden relative">
            <div
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const y = e.clientY - rect.top;
                const x = e.clientX - rect.left;
                const sr = audioCtxRef.current?.sampleRate || 44100;
                const hz = Math.round(yToFreq(y, rect.height, sr));
                const { note } = freqToNote(hz);
                setHoverInfo({ x, y, hz, note });
              }}
              onMouseLeave={() => setHoverInfo(null)}
              className="relative bg-[#050507] cursor-crosshair"
            >
              <canvas
                ref={waterfallCanvasRef}
                width={920}
                height={340}
                className="w-full h-72 sm:h-80 block"
              />

              {/* Frequency Y-Axis Scale Overlay */}
              <div className="absolute inset-y-0 right-0 w-14 bg-gradient-to-l from-black/80 to-transparent flex flex-col justify-between py-2 pr-2 text-right font-mono text-[10px] text-zinc-400 pointer-events-none">
                {freqLabels.map((lbl) => (
                  <span key={lbl}>{lbl}</span>
                ))}
              </div>

              {/* Mouse Crosshair Frequency Inspection Line */}
              {hoverInfo && (
                <>
                  <div
                    style={{ top: `${hoverInfo.y}px` }}
                    className="absolute inset-x-0 h-[1px] bg-white/40 pointer-events-none"
                  />
                  <div
                    style={{ top: `${Math.max(8, hoverInfo.y - 26)}px`, left: `${Math.min(260, hoverInfo.x + 12)}px` }}
                    className="absolute px-2 py-0.5 rounded bg-black/90 border border-zinc-700 font-mono text-[11px] text-white pointer-events-none"
                  >
                    {hoverInfo.hz} Hz • <span className="text-[#ff4f00]">{hoverInfo.note}</span>
                  </div>
                </>
              )}

              {sourceMode === 'none' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-xs text-zinc-500 gap-2 pointer-events-none">
                  <span>Enable Live Mic, Open Audio File, or start Test Signal to view heatmap</span>
                </div>
              )}
            </div>
          </div>

          {/* Live FFT Spectrum + Peak Hold Curve */}
          <div className="studio-panel rounded-lg overflow-hidden p-2 bg-[#070708]">
            <canvas
              ref={spectrumCanvasRef}
              width={920}
              height={130}
              className="w-full h-28 block"
            />
          </div>
        </div>

        {/* Right DSP & Heatmap Configuration */}
        <div className="lg:col-span-3 studio-panel rounded-lg p-4 space-y-4">
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

          <div>
            <label className="block text-[10px] font-mono uppercase text-zinc-500 mb-1.5">
              Frequency Scale
            </label>
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

          <div>
            <label className="block text-[10px] font-mono uppercase text-zinc-500 mb-1.5">
              FFT Resolution
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

          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Gain / Sensitivity</span>
              <span className="font-mono text-zinc-200">{Math.round(gainBoost * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="2.5"
              step="0.1"
              value={gainBoost}
              onChange={(e) => setGainBoost(parseFloat(e.target.value))}
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Waterfall Speed</span>
              <span className="font-mono text-zinc-200">{scrollSpeed}px/f</span>
            </div>
            <input
              type="range"
              min="1"
              max="6"
              step="1"
              value={scrollSpeed}
              onChange={(e) => setScrollSpeed(parseInt(e.target.value))}
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Temporal Smoothing</span>
              <span className="font-mono text-zinc-200">{Math.round(smoothing * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="0.95"
              step="0.05"
              value={smoothing}
              onChange={(e) => setSmoothing(parseFloat(e.target.value))}
            />
          </div>

          <button
            onClick={() => {
              if (analyserRef.current) {
                peakHoldRef.current = new Float32Array(analyserRef.current.frequencyBinCount);
              }
            }}
            className="w-full py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-300"
          >
            Reset Peak Hold
          </button>
        </div>
      </div>
    </div>
  );
};

export default SpectrogramLab;
