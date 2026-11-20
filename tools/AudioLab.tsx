import React, { useState, useRef, useEffect, useCallback } from 'react';

const AudioLab: React.FC = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [scopeMode, setScopeMode] = useState<'waveform' | 'spectrum'>('waveform');
  const [frequency, setFrequency] = useState(440);
  const [type, setType] = useState<OscillatorType>('sine');
  const [filterCutoff, setFilterCutoff] = useState(8000);
  const [lfoRate, setLfoRate] = useState(4);
  const [lfoDepth, setLfoDepth] = useState(0);
  const [volume, setVolume] = useState(0.25);

  const audioCtx = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const lfoRef = useRef<OscillatorNode | null>(null);
  const lfoGainRef = useRef<GainNode | null>(null);
  const filterRef = useRef<BiquadFilterNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  const toggleSynth = () => {
    if (isPlaying) {
      try { oscRef.current?.stop(); lfoRef.current?.stop(); } catch {}
      cancelAnimationFrame(rafRef.current);
      setIsPlaying(false);
      return;
    }

    if (!audioCtx.current) {
      audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioCtx.current;
    if (ctx.state === 'suspended') ctx.resume();

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyserRef.current = analyser;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterCutoff;
    filterRef.current = filter;

    const gain = ctx.createGain();
    gain.gain.value = volume;
    gainRef.current = gain;

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;
    oscRef.current = osc;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = lfoRate;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = lfoDepth;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    lfoRef.current = lfo;
    lfoGainRef.current = lfoGain;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(analyser);
    analyser.connect(ctx.destination);

    osc.start();
    lfo.start();
    setIsPlaying(true);
  };

  useEffect(() => {
    const ctx = audioCtx.current;
    if (!ctx) return;
    if (oscRef.current) {
      oscRef.current.frequency.setTargetAtTime(frequency, ctx.currentTime, 0.02);
      oscRef.current.type = type;
    }
    if (filterRef.current) filterRef.current.frequency.setTargetAtTime(filterCutoff, ctx.currentTime, 0.02);
    if (lfoRef.current) lfoRef.current.frequency.setTargetAtTime(lfoRate, ctx.currentTime, 0.02);
    if (lfoGainRef.current) lfoGainRef.current.gain.setTargetAtTime(lfoDepth, ctx.currentTime, 0.02);
    if (gainRef.current) gainRef.current.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
  }, [frequency, type, filterCutoff, lfoRate, lfoDepth, volume]);

  const drawScope = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d')!;
    const bufLen = analyser.frequencyBinCount;
    const data = new Uint8Array(bufLen);

    const render = () => {
      rafRef.current = requestAnimationFrame(render);
      const w = canvas.width, h = canvas.height;
      ctx.fillStyle = '#070708';
      ctx.fillRect(0, 0, w, h);

      if (scopeMode === 'waveform') {
        analyser.getByteTimeDomainData(data);
        let trig = 0;
        for (let i = 1; i < bufLen / 2; i++) {
          if (data[i - 1] < 128 && data[i] >= 128) { trig = i; break; }
        }
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const len = Math.min(bufLen - trig, 600);
        for (let i = 0; i < len; i++) {
          const x = (i / len) * w;
          const y = ((data[trig + i] / 128.0) * h) / 2;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else {
        analyser.getByteFrequencyData(data);
        const bars = 96;
        const bw = w / bars;
        for (let i = 0; i < bars; i++) {
          const v = data[i * 2] / 255;
          const bh = v * (h - 10);
          ctx.fillStyle = v > 0.8 ? '#ff4f00' : '#ffffff';
          ctx.fillRect(i * bw + 1, h - bh, Math.max(1, bw - 2), bh);
        }
      }
    };
    render();
  }, [scopeMode]);

  useEffect(() => {
    if (isPlaying) {
      cancelAnimationFrame(rafRef.current);
      drawScope();
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, scopeMode, drawScope]);

  useEffect(() => () => {
    try { oscRef.current?.stop(); lfoRef.current?.stop(); } catch {}
    cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
        <h1 className="text-base font-semibold text-white">Signal Lab</h1>
        <div className="flex items-center gap-2">
          <div className="flex bg-[#0b0b0d] p-0.5 rounded border border-zinc-800">
            {(['waveform', 'spectrum'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setScopeMode(m)}
                className={`px-2.5 py-1 rounded text-xs font-mono capitalize ${
                  scopeMode === m ? 'bg-white text-black font-semibold' : 'text-zinc-400'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <button
            onClick={toggleSynth}
            className={`px-4 py-1.5 rounded text-xs font-semibold ${
              isPlaying ? 'bg-[#ff4f00] text-black' : 'bg-white text-black'
            }`}
          >
            {isPlaying ? 'Stop' : 'Start'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-8 studio-panel rounded-lg overflow-hidden">
          <canvas ref={canvasRef} width={800} height={360} className="w-full h-72 sm:h-80 bg-[#070708] block" />
        </div>

        <div className="lg:col-span-4 studio-panel rounded-lg p-4 space-y-4">
          <div className="grid grid-cols-4 gap-1.5">
            {(['sine', 'square', 'sawtooth', 'triangle'] as const).map((w) => (
              <button
                key={w}
                onClick={() => setType(w)}
                className={`py-1.5 rounded text-xs font-mono uppercase border ${
                  type === w ? 'bg-white text-black border-white font-semibold' : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                }`}
              >
                {w.slice(0, 4)}
              </button>
            ))}
          </div>

          {[
            { l: 'Frequency', v: frequency, set: setFrequency, min: 20, max: 2000, step: 1, u: 'Hz' },
            { l: 'Lowpass Cutoff', v: filterCutoff, set: setFilterCutoff, min: 100, max: 12000, step: 50, u: 'Hz' },
            { l: 'LFO Rate', v: lfoRate, set: setLfoRate, min: 0.5, max: 20, step: 0.5, u: 'Hz' },
            { l: 'LFO Depth', v: lfoDepth, set: setLfoDepth, min: 0, max: 150, step: 1, u: 'Hz' },
            { l: 'Volume', v: volume, set: setVolume, min: 0, max: 1, step: 0.01, u: '' },
          ].map((s) => (
            <div key={s.l} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">{s.l}</span>
                <span className="font-mono text-zinc-200">
                  {s.u === '' ? `${Math.round(s.v * 100)}%` : `${s.v} ${s.u}`}
                </span>
              </div>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={s.v}
                onChange={(e) => s.set(parseFloat(e.target.value))}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AudioLab;
