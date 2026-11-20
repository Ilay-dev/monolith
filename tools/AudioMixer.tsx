import React, { useState, useRef, useEffect, useCallback } from 'react';

interface AudioTrack {
  id: string;
  name: string;
  buffer: AudioBuffer;
  peaks: number[];
  volume: number;
  pitch: number;
  bass: number;
  mid: number;
  treble: number;
  lowpass: number;
  pan: number;
  isMuted: boolean;
  isSoloed: boolean;
}

interface TrackNodes {
  source: AudioBufferSourceNode;
  gain: GainNode;
  bass: BiquadFilterNode;
  mid: BiquadFilterNode;
  treble: BiquadFilterNode;
  lowpass: BiquadFilterNode;
  panner: StereoPannerNode;
}

const extractPeaks = (buffer: AudioBuffer, count = 100): number[] => {
  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / count));
  const peaks: number[] = [];
  for (let i = 0; i < count; i++) {
    let max = 0;
    const start = i * step;
    for (let j = 0; j < step && start + j < data.length; j += 8) {
      const v = Math.abs(data[start + j]);
      if (v > max) max = v;
    }
    peaks.push(Math.min(1, max));
  }
  return peaks;
};

const encodeWav = (buffer: AudioBuffer): Blob => {
  const numCh = buffer.numberOfChannels;
  const len = buffer.length * numCh * 2 + 44;
  const out = new ArrayBuffer(len);
  const view = new DataView(out);
  let pos = 0;
  const u16 = (d: number) => { view.setUint16(pos, d, true); pos += 2; };
  const u32 = (d: number) => { view.setUint32(pos, d, true); pos += 4; };

  u32(0x46464952); u32(len - 8); u32(0x45564157);
  u32(0x20746d66); u32(16); u16(1); u16(numCh);
  u32(buffer.sampleRate); u32(buffer.sampleRate * 2 * numCh);
  u16(numCh * 2); u16(16); u32(0x61746164); u32(len - 44);

  const chs = Array.from({ length: numCh }, (_, i) => buffer.getChannelData(i));
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chs[c][i]));
      view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      pos += 2;
    }
  }
  return new Blob([out], { type: 'audio/wav' });
};

const AudioMixer: React.FC = () => {
  const [tracks, setTracks] = useState<AudioTrack[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(true);
  const [masterVolume, setMasterVolume] = useState(0.85);
  const [currentTime, setCurrentTime] = useState(0);

  const audioCtx = useRef<AudioContext | null>(null);
  const trackNodes = useRef<Map<string, TrackNodes>>(new Map());
  const masterGain = useRef<GainNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const pauseOffsetRef = useRef<number>(0);
  const rafRef = useRef<number>(0);

  const maxDuration = tracks.reduce((m, t) => Math.max(m, t.buffer.duration), 0);

  const initAudio = () => {
    if (!audioCtx.current) {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtx.current = ctx;
      masterGain.current = ctx.createGain();
      masterGain.current.gain.value = masterVolume;
      masterGain.current.connect(ctx.destination);
    }
    if (audioCtx.current.state === 'suspended') audioCtx.current.resume();
  };

  const stopNodes = () => {
    trackNodes.current.forEach((n) => {
      try { n.source.stop(); n.source.disconnect(); } catch {}
    });
    trackNodes.current.clear();
    cancelAnimationFrame(rafRef.current);
  };

  const startFromOffset = useCallback(
    (offsetSec: number) => {
      if (tracks.length === 0) return;
      initAudio();
      stopNodes();
      const ctx = audioCtx.current!;
      const hasSolo = tracks.some((t) => t.isSoloed);

      tracks.forEach((track) => {
        const source = ctx.createBufferSource();
        source.buffer = track.buffer;
        source.loop = isLooping;
        source.playbackRate.value = track.pitch;

        const bass = ctx.createBiquadFilter();
        bass.type = 'lowshelf'; bass.frequency.value = 80; bass.gain.value = track.bass;

        const mid = ctx.createBiquadFilter();
        mid.type = 'peaking'; mid.frequency.value = 1000; mid.gain.value = track.mid;

        const treble = ctx.createBiquadFilter();
        treble.type = 'highshelf'; treble.frequency.value = 10000; treble.gain.value = track.treble;

        const lowpass = ctx.createBiquadFilter();
        lowpass.type = 'lowpass'; lowpass.frequency.value = track.lowpass;

        const gain = ctx.createGain();
        gain.gain.value = track.isMuted || (hasSolo && !track.isSoloed) ? 0 : track.volume;

        const panner = ctx.createStereoPanner();
        panner.pan.value = track.pan;

        source.connect(bass);
        bass.connect(mid);
        mid.connect(treble);
        treble.connect(lowpass);
        lowpass.connect(gain);
        gain.connect(panner);
        panner.connect(masterGain.current!);

        source.start(0, track.buffer.duration > 0 ? offsetSec % track.buffer.duration : 0);
        trackNodes.current.set(track.id, { source, gain, bass, mid, treble, lowpass, panner });
      });

      startTimeRef.current = ctx.currentTime - offsetSec;
      setIsPlaying(true);
    },
    [tracks, isLooping]
  );

  const togglePlay = () => {
    if (tracks.length === 0) return;
    if (isPlaying) {
      if (audioCtx.current) pauseOffsetRef.current = audioCtx.current.currentTime - startTimeRef.current;
      stopNodes();
      setIsPlaying(false);
    } else {
      startFromOffset(pauseOffsetRef.current);
    }
  };

  const stopAll = () => {
    stopNodes();
    pauseOffsetRef.current = 0;
    setCurrentTime(0);
    setIsPlaying(false);
  };

  const seekTo = (t: number) => {
    pauseOffsetRef.current = t;
    setCurrentTime(t);
    if (isPlaying) startFromOffset(t);
  };

  useEffect(() => {
    if (!audioCtx.current) return;
    const ctx = audioCtx.current;
    if (masterGain.current) masterGain.current.gain.setTargetAtTime(masterVolume, ctx.currentTime, 0.03);
    const hasSolo = tracks.some((t) => t.isSoloed);
    tracks.forEach((t) => {
      const n = trackNodes.current.get(t.id);
      if (n) {
        n.gain.gain.setTargetAtTime(t.isMuted || (hasSolo && !t.isSoloed) ? 0 : t.volume, ctx.currentTime, 0.03);
        n.source.playbackRate.setTargetAtTime(t.pitch, ctx.currentTime, 0.03);
        n.bass.gain.setTargetAtTime(t.bass, ctx.currentTime, 0.03);
        n.mid.gain.setTargetAtTime(t.mid, ctx.currentTime, 0.03);
        n.treble.gain.setTargetAtTime(t.treble, ctx.currentTime, 0.03);
        n.lowpass.frequency.setTargetAtTime(t.lowpass, ctx.currentTime, 0.03);
        n.panner.pan.setTargetAtTime(t.pan, ctx.currentTime, 0.03);
      }
    });
  }, [tracks, masterVolume]);

  useEffect(() => {
    if (!isPlaying) return;
    const tick = () => {
      if (audioCtx.current && maxDuration > 0) {
        const elapsed = audioCtx.current.currentTime - startTimeRef.current;
        if (!isLooping && elapsed >= maxDuration) {
          stopAll();
          return;
        }
        setCurrentTime(isLooping ? elapsed % maxDuration : Math.min(maxDuration, elapsed));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, isLooping, maxDuration]);

  useEffect(() => () => stopNodes(), []);

  const loadFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    initAudio();
    const added: AudioTrack[] = [];
    for (const file of Array.from(files)) {
      try {
        const buf = await audioCtx.current!.decodeAudioData(await file.arrayBuffer());
        added.push({
          id: Math.random().toString(36).slice(2, 8),
          name: file.name.replace(/\.[^/.]+$/, ''),
          buffer: buf,
          peaks: extractPeaks(buf),
          volume: 0.8,
          pitch: 1.0,
          bass: 0,
          mid: 0,
          treble: 0,
          lowpass: 20000,
          pan: 0,
          isMuted: false,
          isSoloed: false,
        });
      } catch {}
    }
    if (added.length > 0) {
      if (isPlaying) stopAll();
      setTracks((prev) => [...prev, ...added]);
    }
  };

  const exportMixdown = async () => {
    if (tracks.length === 0 || maxDuration === 0) return;
    const sr = 44100;
    const offline = new OfflineAudioContext(2, Math.ceil(maxDuration * sr), sr);
    const outMaster = offline.createGain();
    outMaster.gain.value = masterVolume;
    outMaster.connect(offline.destination);

    const hasSolo = tracks.some((t) => t.isSoloed);
    tracks.forEach((t) => {
      if (t.isMuted || (hasSolo && !t.isSoloed)) return;
      const src = offline.createBufferSource();
      src.buffer = t.buffer;
      src.playbackRate.value = t.pitch;
      const bass = offline.createBiquadFilter(); bass.type = 'lowshelf'; bass.frequency.value = 80; bass.gain.value = t.bass;
      const mid = offline.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1000; mid.gain.value = t.mid;
      const treb = offline.createBiquadFilter(); treb.type = 'highshelf'; treb.frequency.value = 10000; treb.gain.value = t.treble;
      const lpf = offline.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = t.lowpass;
      const gain = offline.createGain(); gain.gain.value = t.volume;
      const pan = offline.createStereoPanner(); pan.pan.value = t.pan;

      src.connect(bass); bass.connect(mid); mid.connect(treb); treb.connect(lpf); lpf.connect(gain); gain.connect(pan); pan.connect(outMaster);
      src.start(0);
    });

    const rendered = await offline.startRendering();
    const link = document.createElement('a');
    link.download = `mixdown-${Date.now()}.wav`;
    link.href = URL.createObjectURL(encodeWav(rendered));
    link.click();
  };

  const updateTrack = (id: string, patch: Partial<AudioTrack>) => {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const fmtTime = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${Math.floor(s % 60).toString().padStart(2, '0')}.${Math.floor((s % 1) * 10)}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-800">
        <h1 className="text-base font-semibold text-white">Audio Mixer</h1>
        <div className="flex items-center gap-2">
          <label className="px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200 cursor-pointer">
            Import Stems
            <input type="file" multiple accept="audio/*" onChange={loadFiles} className="hidden" />
          </label>
          {tracks.length > 0 && (
            <button
              onClick={exportMixdown}
              className="px-3.5 py-1.5 rounded bg-white hover:bg-zinc-200 text-black text-xs font-semibold"
            >
              Export WAV
            </button>
          )}
        </div>
      </div>

      {/* Transport Bar */}
      <div className="studio-panel rounded-lg p-3 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1.5">
          <button
            onClick={togglePlay}
            disabled={tracks.length === 0}
            className={`px-3.5 py-1.5 rounded text-xs font-semibold disabled:opacity-30 ${
              isPlaying ? 'bg-[#ff4f00] text-black' : 'bg-white text-black'
            }`}
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button
            onClick={stopAll}
            disabled={tracks.length === 0}
            className="px-2.5 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 disabled:opacity-30"
          >
            Stop
          </button>
          <button
            onClick={() => setIsLooping(!isLooping)}
            className={`px-2.5 py-1.5 rounded border text-xs font-mono ${
              isLooping ? 'bg-zinc-800 text-white border-zinc-600' : 'bg-zinc-900 text-zinc-500 border-zinc-800'
            }`}
          >
            Loop
          </button>
        </div>

        <span className="font-mono text-xs text-zinc-300">
          {fmtTime(currentTime)} / {fmtTime(maxDuration)}
        </span>

        <div className="flex-1 min-w-[140px]">
          <input
            type="range"
            min="0"
            max={maxDuration || 1}
            step="0.05"
            value={currentTime}
            disabled={tracks.length === 0}
            onChange={(e) => seekTo(parseFloat(e.target.value))}
          />
        </div>

        <div className="flex items-center gap-2 w-36">
          <span className="text-[10px] font-mono text-zinc-500">MASTER</span>
          <input
            type="range"
            min="0"
            max="1.2"
            step="0.01"
            value={masterVolume}
            onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
          />
        </div>
      </div>

      {/* Tracks */}
      {tracks.length === 0 ? (
        <label className="studio-panel rounded-lg p-12 flex flex-col items-center justify-center text-center cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">
          <i className="fas fa-plus text-lg mb-2"></i>
          <span>Click to import audio stems (WAV, MP3, OGG, FLAC)</span>
          <input type="file" multiple accept="audio/*" onChange={loadFiles} className="hidden" />
        </label>
      ) : (
        <div className="space-y-2.5">
          {tracks.map((t) => {
            const pct = t.buffer.duration > 0 ? ((currentTime % t.buffer.duration) / t.buffer.duration) * 100 : 0;
            return (
              <div key={t.id} className="studio-panel rounded-lg p-3.5 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
                <div className="lg:col-span-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-white truncate">{t.name}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => updateTrack(t.id, { isMuted: !t.isMuted })}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                          t.isMuted ? 'bg-red-500 text-black border-red-400 font-bold' : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                        }`}
                      >
                        M
                      </button>
                      <button
                        onClick={() => updateTrack(t.id, { isSoloed: !t.isSoloed })}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                          t.isSoloed ? 'bg-[#ff4f00] text-black border-[#ff4f00] font-bold' : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                        }`}
                      >
                        S
                      </button>
                      <button
                        onClick={() => {
                          if (isPlaying) stopAll();
                          setTracks((prev) => prev.filter((tr) => tr.id !== t.id));
                        }}
                        className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-red-400 text-[10px]"
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  <div
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      seekTo(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * t.buffer.duration);
                    }}
                    className="h-10 bg-[#070708] border border-zinc-800 rounded relative flex items-center px-1 gap-[1px] cursor-pointer overflow-hidden"
                  >
                    {t.peaks.map((pk, idx) => (
                      <div
                        key={idx}
                        style={{ height: `${Math.max(12, pk * 88)}%` }}
                        className={`flex-1 ${t.isMuted ? 'bg-zinc-800' : 'bg-zinc-500'}`}
                      />
                    ))}
                    <div style={{ left: `${pct}%` }} className="absolute inset-y-0 w-0.5 bg-[#ff4f00]" />
                  </div>
                </div>

                <div className="lg:col-span-4 grid grid-cols-3 gap-3">
                  <div>
                    <div className="flex justify-between text-[10px] font-mono text-zinc-400 mb-1">
                      <span>VOL</span>
                      <span>{Math.round(t.volume * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1.5"
                      step="0.01"
                      value={t.volume}
                      onChange={(e) => updateTrack(t.id, { volume: parseFloat(e.target.value) })}
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] font-mono text-zinc-400 mb-1">
                      <span>PAN</span>
                      <span>{t.pan === 0 ? 'C' : t.pan < 0 ? 'L' : 'R'}</span>
                    </div>
                    <input
                      type="range"
                      min="-1"
                      max="1"
                      step="0.02"
                      value={t.pan}
                      onChange={(e) => updateTrack(t.id, { pan: parseFloat(e.target.value) })}
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] font-mono text-zinc-400 mb-1">
                      <span>SPEED</span>
                      <span>{t.pitch.toFixed(2)}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.5"
                      max="2"
                      step="0.01"
                      value={t.pitch}
                      onChange={(e) => updateTrack(t.id, { pitch: parseFloat(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="lg:col-span-4 grid grid-cols-4 gap-2.5">
                  {[
                    { k: 'bass', l: 'LOW', min: -18, max: 18 },
                    { k: 'mid', l: 'MID', min: -18, max: 18 },
                    { k: 'treble', l: 'HIGH', min: -18, max: 18 },
                    { k: 'lowpass', l: 'CUT', min: 400, max: 20000 },
                  ].map((eq) => (
                    <div key={eq.k}>
                      <div className="flex justify-between text-[10px] font-mono text-zinc-500 mb-1">
                        <span>{eq.l}</span>
                      </div>
                      <input
                        type="range"
                        min={eq.min}
                        max={eq.max}
                        value={(t as any)[eq.k]}
                        onChange={(e) => updateTrack(t.id, { [eq.k]: parseFloat(e.target.value) })}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AudioMixer;
