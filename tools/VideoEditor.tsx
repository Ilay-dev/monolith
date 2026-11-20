import React, { useState, useRef, useEffect, useCallback } from 'react';

type TransitionType = 'none' | 'fade' | 'slide' | 'zoom' | 'wipe';
type LayoutMode = 'full' | 'pip-br' | 'pip-tr' | 'split-l' | 'split-r';
type AspectPreset = '16:9' | '9:16' | '1:1';
type TextPosition = 'bottom' | 'center' | 'top' | 'lower-left';

interface VideoClip {
  id: string;
  kind: 'video';
  name: string;
  url: string;
  thumbnails: string[];
  sourceDuration: number;
  startTime: number;
  trimStart: number;
  trimEnd: number;
  speed: number;
  volume: number;
  muted: boolean;
  opacity: number;
  brightness: number;
  contrast: number;
  saturate: number;
  flipH: boolean;
  transition: TransitionType;
  transitionDuration: number;
  layout: LayoutMode;
  videoEl: HTMLVideoElement;
}

interface AudioClip {
  id: string;
  kind: 'audio';
  name: string;
  buffer: AudioBuffer;
  peaks: number[];
  sourceDuration: number;
  startTime: number;
  trimStart: number;
  trimEnd: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

interface TextClip {
  id: string;
  kind: 'text';
  text: string;
  startTime: number;
  duration: number;
  fontSize: number;
  color: string;
  bgBox: boolean;
  position: TextPosition;
  fade: boolean;
}

type DragAction = {
  id: string;
  kind: 'video' | 'audio' | 'text';
  mode: 'move' | 'trim-left' | 'trim-right' | 'fade-in' | 'fade-out';
  startX: number;
  initialStartTime: number;
  initialTrimStart: number;
  initialTrimEnd: number;
  initialDuration: number;
  initialFade: number;
};

const getVideoTimelineDuration = (v: VideoClip) =>
  Math.max(0.1, (v.trimEnd - v.trimStart) / (v.speed || 1));

const getAudioTimelineDuration = (a: AudioClip) =>
  Math.max(0.1, a.trimEnd - a.trimStart);

const extractPeaks = (buffer: AudioBuffer, count = 90): number[] => {
  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / count));
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    let max = 0;
    const start = i * step;
    for (let j = 0; j < step && start + j < data.length; j += 10) {
      const v = Math.abs(data[start + j]);
      if (v > max) max = v;
    }
    out.push(Math.min(1, max));
  }
  return out;
};

const generateVideoThumbnails = async (url: string, duration: number, count = 6): Promise<string[]> => {
  const v = document.createElement('video');
  v.src = url;
  v.crossOrigin = 'anonymous';
  v.muted = true;
  v.playsInline = true;

  await new Promise<void>((res) => {
    v.onloadeddata = () => res();
    v.onerror = () => res();
  });

  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 54;
  const ctx = c.getContext('2d');
  if (!ctx) return [];

  const thumbs: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = Math.min(duration - 0.05, Math.max(0, ((i + 0.5) / count) * duration));
    v.currentTime = t;
    await new Promise<void>((res) => {
      const onSeek = () => {
        v.removeEventListener('seeked', onSeek);
        res();
      };
      v.addEventListener('seeked', onSeek);
      setTimeout(res, 150);
    });
    try {
      ctx.drawImage(v, 0, 0, c.width, c.height);
      thumbs.push(c.toDataURL('image/jpeg', 0.5));
    } catch {}
  }
  return thumbs;
};

const VideoEditor: React.FC = () => {
  const [videoClips, setVideoClips] = useState<VideoClip[]>([]);
  const [audioClips, setAudioClips] = useState<AudioClip[]>([]);
  const [textClips, setTextClips] = useState<TextClip[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [aspect, setAspect] = useState<AspectPreset>('16:9');
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [hoverTimeLabel, setHoverTimeLabel] = useState<string | null>(null);

  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const timelineTrackAreaRef = useRef<HTMLDivElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const activeAudioNodesRef = useRef<Map<string, { source: AudioBufferSourceNode; gain: GainNode }>>(new Map());
  const videoAudioNodesRef = useRef<Map<string, { source: MediaElementAudioSourceNode; gain: GainNode }>>(new Map());

  const playStartWallRef = useRef<number>(0);
  const pauseOffsetRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const dragRef = useRef<DragAction | null>(null);

  const canvasDims =
    aspect === '16:9'
      ? { w: 1280, h: 720 }
      : aspect === '9:16'
      ? { w: 720, h: 1280 }
      : { w: 1080, h: 1080 };

  const totalDuration = Math.max(
    6,
    ...videoClips.map((v) => v.startTime + getVideoTimelineDuration(v)),
    ...audioClips.map((a) => a.startTime + getAudioTimelineDuration(a)),
    ...textClips.map((t) => t.startTime + t.duration)
  );

  const ensureAudioContext = () => {
    if (!audioCtxRef.current) {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = ctx;
      masterDestRef.current = ctx.createMediaStreamDestination();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  // Add Videos
  const handleAddVideos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    let nextStart = videoClips.reduce((max, v) => Math.max(max, v.startTime + getVideoTimelineDuration(v)), 0);

    const added: VideoClip[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('video/')) continue;
      const url = URL.createObjectURL(file);
      const videoEl = document.createElement('video');
      videoEl.src = url;
      videoEl.crossOrigin = 'anonymous';
      videoEl.preload = 'auto';
      videoEl.playsInline = true;

      const dur = await new Promise<number>((resolve) => {
        videoEl.onloadedmetadata = () => resolve(isFinite(videoEl.duration) ? videoEl.duration : 5);
        videoEl.onerror = () => resolve(5);
      });

      const thumbs = await generateVideoThumbnails(url, dur, 6);
      const id = 'v_' + Math.random().toString(36).slice(2, 8);
      added.push({
        id,
        kind: 'video',
        name: file.name.replace(/\.[^/.]+$/, ''),
        url,
        thumbnails: thumbs,
        sourceDuration: dur,
        startTime: Number(nextStart.toFixed(2)),
        trimStart: 0,
        trimEnd: Number(dur.toFixed(2)),
        speed: 1,
        volume: 1,
        muted: false,
        opacity: 1,
        brightness: 100,
        contrast: 100,
        saturate: 100,
        flipH: false,
        transition: added.length > 0 || videoClips.length > 0 ? 'fade' : 'none',
        transitionDuration: 0.6,
        layout: 'full',
        videoEl,
      });
      nextStart += dur;
    }

    if (added.length > 0) {
      setVideoClips((prev) => [...prev, ...added]);
      setSelectedId(added[0].id);
    }
  };

  // Add Audios
  const handleAddAudios = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const ctx = ensureAudioContext();
    const added: AudioClip[] = [];

    for (const file of Array.from(files)) {
      if (!file.type.startsWith('audio/') && !file.type.startsWith('video/')) continue;
      try {
        const buf = await ctx.decodeAudioData(await file.arrayBuffer());
        const id = 'a_' + Math.random().toString(36).slice(2, 8);
        added.push({
          id,
          kind: 'audio',
          name: file.name.replace(/\.[^/.]+$/, ''),
          buffer: buf,
          peaks: extractPeaks(buf),
          sourceDuration: buf.duration,
          startTime: 0,
          trimStart: 0,
          trimEnd: Number(buf.duration.toFixed(2)),
          volume: 0.9,
          fadeIn: 1.0,
          fadeOut: 1.5,
        });
      } catch {}
    }

    if (added.length > 0) {
      setAudioClips((prev) => [...prev, ...added]);
      setSelectedId(added[0].id);
    }
  };

  // Add Text Overlay
  const handleAddText = () => {
    const id = 't_' + Math.random().toString(36).slice(2, 8);
    const newText: TextClip = {
      id,
      kind: 'text',
      text: 'TITLE OVERLAY',
      startTime: Number(currentTime.toFixed(2)),
      duration: 3.0,
      fontSize: 48,
      color: '#ffffff',
      bgBox: true,
      position: 'bottom',
      fade: true,
    };
    setTextClips((prev) => [...prev, newText]);
    setSelectedId(id);
  };

  // Render composite frame at timestamp `t`
  const renderFrameAt = useCallback(
    (t: number, playing: boolean) => {
      const canvas = previewCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);

      // 1. Render Video Clips (Full first, then Overlays)
      const sortedVideos = [...videoClips].sort((a, b) => {
        if (a.layout === 'full' && b.layout !== 'full') return -1;
        if (a.layout !== 'full' && b.layout === 'full') return 1;
        return a.startTime - b.startTime;
      });

      sortedVideos.forEach((vc) => {
        const dur = getVideoTimelineDuration(vc);
        const clipEnd = vc.startTime + dur;
        const isActive = t >= vc.startTime && t <= clipEnd;

        if (!isActive) {
          if (!vc.videoEl.paused) vc.videoEl.pause();
          return;
        }

        const localTime = t - vc.startTime;
        const targetVideoTime = vc.trimStart + localTime * vc.speed;

        vc.videoEl.playbackRate = vc.speed;
        vc.videoEl.muted = vc.muted;
        vc.videoEl.volume = vc.muted ? 0 : Math.min(1, vc.volume);

        if (playing) {
          if (Math.abs(vc.videoEl.currentTime - targetVideoTime) > 0.28) {
            vc.videoEl.currentTime = targetVideoTime;
          }
          if (vc.videoEl.paused) vc.videoEl.play().catch(() => {});
        } else {
          if (!vc.videoEl.paused) vc.videoEl.pause();
          if (Math.abs(vc.videoEl.currentTime - targetVideoTime) > 0.03) {
            vc.videoEl.currentTime = targetVideoTime;
          }
        }

        let alpha = vc.opacity;
        let offsetX = 0;
        let scale = 1;
        let wipeRatio = 1;
        const td = Math.min(vc.transitionDuration, dur / 2);

        if (vc.transition !== 'none' && td > 0) {
          if (localTime < td) {
            const p = localTime / td;
            if (vc.transition === 'fade') alpha *= p;
            else if (vc.transition === 'slide') offsetX = -(1 - p) * w;
            else if (vc.transition === 'zoom') {
              scale = 0.72 + 0.28 * p;
              alpha *= p;
            } else if (vc.transition === 'wipe') {
              wipeRatio = p;
            }
          } else if (dur - localTime < td && vc.transition === 'fade') {
            alpha *= Math.max(0, (dur - localTime) / td);
          }
        }

        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.filter = `brightness(${vc.brightness}%) contrast(${vc.contrast}%) saturate(${vc.saturate}%)`;

        let dx = 0, dy = 0, dw = w, dh = h;
        if (vc.layout === 'pip-br') {
          dw = w * 0.35; dh = h * 0.35; dx = w - dw - 24; dy = h - dh - 24;
        } else if (vc.layout === 'pip-tr') {
          dw = w * 0.35; dh = h * 0.35; dx = w - dw - 24; dy = 24;
        } else if (vc.layout === 'split-l') {
          dw = w / 2; dh = h; dx = 0; dy = 0;
        } else if (vc.layout === 'split-r') {
          dw = w / 2; dh = h; dx = w / 2; dy = 0;
        }

        if (wipeRatio < 1) {
          ctx.beginPath();
          ctx.rect(dx, dy, dw * wipeRatio, dh);
          ctx.clip();
        }

        ctx.translate(dx + dw / 2 + offsetX, dy + dh / 2);
        ctx.scale(vc.flipH ? -scale : scale, scale);

        const vw = vc.videoEl.videoWidth || 1280;
        const vh = vc.videoEl.videoHeight || 720;
        const fit = Math.min(dw / vw, dh / vh);
        const rw = vw * fit;
        const rh = vh * fit;

        try {
          ctx.drawImage(vc.videoEl, -rw / 2, -rh / 2, rw, rh);
        } catch {}

        if (vc.layout.startsWith('pip')) {
          ctx.filter = 'none';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.strokeRect(-rw / 2, -rh / 2, rw, rh);
        }
        ctx.restore();
      });

      // 2. Render Text / Subtitle Overlays
      textClips.forEach((tc) => {
        if (t < tc.startTime || t > tc.startTime + tc.duration) return;
        const local = t - tc.startTime;
        let alpha = 1;
        if (tc.fade) {
          const fd = Math.min(0.4, tc.duration / 3);
          if (local < fd) alpha = local / fd;
          else if (tc.duration - local < fd) alpha = (tc.duration - local) / fd;
        }

        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.font = `700 ${tc.fontSize}px Inter, sans-serif`;
        ctx.textAlign = tc.position === 'lower-left' ? 'left' : 'center';
        ctx.textBaseline = 'middle';

        const tx = tc.position === 'lower-left' ? 60 : w / 2;
        const ty =
          tc.position === 'top'
            ? h * 0.12
            : tc.position === 'center'
            ? h * 0.5
            : tc.position === 'lower-left'
            ? h * 0.82
            : h * 0.86;

        const metrics = ctx.measureText(tc.text);
        const padX = 20, padY = 12;
        const boxW = metrics.width + padX * 2;
        const boxH = tc.fontSize + padY * 2;
        const boxX = tc.position === 'lower-left' ? tx - padX : tx - boxW / 2;

        if (tc.bgBox) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
          ctx.fillRect(boxX, ty - boxH / 2, boxW, boxH);
        }
        ctx.fillStyle = tc.color;
        ctx.fillText(tc.text, tx, ty);
        ctx.restore();
      });
    },
    [videoClips, textClips]
  );

  // Audio Playback with Fade-In & Fade-Out Envelopes
  const startAudioPlayback = useCallback(
    (startOffset: number) => {
      const ctx = ensureAudioContext();
      activeAudioNodesRef.current.forEach((n) => {
        try { n.source.stop(); n.source.disconnect(); } catch {}
      });
      activeAudioNodesRef.current.clear();

      videoClips.forEach((vc) => {
        if (!videoAudioNodesRef.current.has(vc.id)) {
          try {
            const src = ctx.createMediaElementSource(vc.videoEl);
            const g = ctx.createGain();
            src.connect(g);
            g.connect(ctx.destination);
            if (masterDestRef.current) g.connect(masterDestRef.current);
            videoAudioNodesRef.current.set(vc.id, { source: src, gain: g });
          } catch {}
        }
      });

      const now = ctx.currentTime;

      audioClips.forEach((ac) => {
        const dur = getAudioTimelineDuration(ac);
        const clipEnd = ac.startTime + dur;
        if (startOffset >= clipEnd) return;

        const source = ctx.createBufferSource();
        source.buffer = ac.buffer;
        const gain = ctx.createGain();
        source.connect(gain);
        gain.connect(ctx.destination);
        if (masterDestRef.current) gain.connect(masterDestRef.current);

        const delayUntilStart = Math.max(0, ac.startTime - startOffset);
        const offsetInsideClip = Math.max(0, startOffset - ac.startTime);
        const remainingDur = dur - offsetInsideClip;
        if (remainingDur <= 0) return;

        const absClipStart = now + delayUntilStart - offsetInsideClip;
        const absClipEnd = absClipStart + dur;
        const fadeInEnd = absClipStart + Math.min(ac.fadeIn, dur);
        const fadeOutStart = Math.max(fadeInEnd, absClipEnd - Math.min(ac.fadeOut, dur));

        gain.gain.setValueAtTime(0.0001, now);
        if (ac.fadeIn > 0 && offsetInsideClip < ac.fadeIn) {
          const initialRatio = offsetInsideClip / ac.fadeIn;
          gain.gain.setValueAtTime(Math.max(0.0001, initialRatio * ac.volume), now + delayUntilStart);
          gain.gain.linearRampToValueAtTime(ac.volume, fadeInEnd);
        } else {
          gain.gain.setValueAtTime(ac.volume, now + delayUntilStart);
        }

        if (ac.fadeOut > 0) {
          gain.gain.setValueAtTime(ac.volume, Math.max(now + delayUntilStart, fadeOutStart));
          gain.gain.linearRampToValueAtTime(0.0001, absClipEnd);
        }

        source.start(now + delayUntilStart, ac.trimStart + offsetInsideClip, remainingDur);
        activeAudioNodesRef.current.set(ac.id, { source, gain });
      });
    },
    [audioClips, videoClips]
  );

  const stopPlayback = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    activeAudioNodesRef.current.forEach((n) => {
      try { n.source.stop(); n.source.disconnect(); } catch {}
    });
    activeAudioNodesRef.current.clear();
    videoClips.forEach((vc) => {
      if (!vc.videoEl.paused) vc.videoEl.pause();
    });
    setIsPlaying(false);
  }, [videoClips]);

  const startPlayback = useCallback(
    (fromTime: number) => {
      stopPlayback();
      const startT = fromTime >= totalDuration ? 0 : fromTime;
      pauseOffsetRef.current = startT;
      playStartWallRef.current = performance.now() - startT * 1000;
      startAudioPlayback(startT);
      setIsPlaying(true);
    },
    [stopPlayback, totalDuration, startAudioPlayback]
  );

  useEffect(() => {
    if (!isPlaying) {
      renderFrameAt(currentTime, false);
      return;
    }
    const loop = () => {
      const elapsed = (performance.now() - playStartWallRef.current) / 1000;
      if (elapsed >= totalDuration) {
        stopPlayback();
        setCurrentTime(totalDuration);
        pauseOffsetRef.current = 0;
        if (recorderRef.current && recorderRef.current.state === 'recording') {
          recorderRef.current.stop();
        }
        return;
      }
      setCurrentTime(elapsed);
      renderFrameAt(elapsed, true);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, totalDuration, renderFrameAt, stopPlayback]);

  // Split selected clip at playhead
  const splitSelectedAtPlayhead = useCallback(() => {
    if (!selectedId) return;
    const vClip = videoClips.find((v) => v.id === selectedId);
    if (vClip) {
      const dur = getVideoTimelineDuration(vClip);
      if (currentTime <= vClip.startTime + 0.1 || currentTime >= vClip.startTime + dur - 0.1) return;
      const timelineDelta = currentTime - vClip.startTime;
      const splitSourcePoint = Number((vClip.trimStart + timelineDelta * vClip.speed).toFixed(2));

      const vEl2 = document.createElement('video');
      vEl2.src = vClip.url;
      vEl2.crossOrigin = 'anonymous';
      vEl2.preload = 'auto';
      vEl2.playsInline = true;

      const secondHalf: VideoClip = {
        ...vClip,
        id: 'v_' + Math.random().toString(36).slice(2, 8),
        name: `${vClip.name} (2)`,
        startTime: Number(currentTime.toFixed(2)),
        trimStart: splitSourcePoint,
        videoEl: vEl2,
      };

      setVideoClips((prev) =>
        prev.flatMap((item) =>
          item.id === vClip.id ? [{ ...item, trimEnd: splitSourcePoint }, secondHalf] : [item]
        )
      );
      setSelectedId(secondHalf.id);
      return;
    }

    const aClip = audioClips.find((a) => a.id === selectedId);
    if (aClip) {
      const dur = getAudioTimelineDuration(aClip);
      if (currentTime <= aClip.startTime + 0.1 || currentTime >= aClip.startTime + dur - 0.1) return;
      const splitSource = Number((aClip.trimStart + (currentTime - aClip.startTime)).toFixed(2));

      const secondHalf: AudioClip = {
        ...aClip,
        id: 'a_' + Math.random().toString(36).slice(2, 8),
        name: `${aClip.name} (2)`,
        startTime: Number(currentTime.toFixed(2)),
        trimStart: splitSource,
        fadeIn: 0,
      };

      setAudioClips((prev) =>
        prev.flatMap((item) =>
          item.id === aClip.id ? [{ ...item, trimEnd: splitSource, fadeOut: 0 }, secondHalf] : [item]
        )
      );
      setSelectedId(secondHalf.id);
      return;
    }

    const tClip = textClips.find((t) => t.id === selectedId);
    if (tClip) {
      if (currentTime <= tClip.startTime + 0.1 || currentTime >= tClip.startTime + tClip.duration - 0.1) return;
      const firstDur = Number((currentTime - tClip.startTime).toFixed(2));
      const secondDur = Number((tClip.duration - firstDur).toFixed(2));
      const secondText: TextClip = {
        ...tClip,
        id: 't_' + Math.random().toString(36).slice(2, 8),
        startTime: Number(currentTime.toFixed(2)),
        duration: secondDur,
      };
      setTextClips((prev) =>
        prev.flatMap((item) =>
          item.id === tClip.id ? [{ ...item, duration: firstDur }, secondText] : [item]
        )
      );
      setSelectedId(secondText.id);
    }
  }, [selectedId, videoClips, audioClips, textClips, currentTime]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    setVideoClips((p) => p.filter((v) => v.id !== selectedId));
    setAudioClips((p) => p.filter((a) => a.id !== selectedId));
    setTextClips((p) => p.filter((t) => t.id !== selectedId));
    setSelectedId(null);
  }, [selectedId]);

  // Keyboard shortcuts (Space, S, Delete, Arrows)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (isPlaying) stopPlayback();
        else startPlayback(currentTime);
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        splitSelectedAtPlayhead();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stopPlayback();
        setCurrentTime((t) => Math.max(0, Number((t - (e.shiftKey ? 0.5 : 0.04)).toFixed(2))));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stopPlayback();
        setCurrentTime((t) => Math.min(totalDuration, Number((t + (e.shiftKey ? 0.5 : 0.04)).toFixed(2))));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPlaying, currentTime, totalDuration, stopPlayback, startPlayback, splitSelectedAtPlayhead, deleteSelected]);

  // Magnetic snapping helper
  const snapTime = useCallback(
    (rawT: number, excludeId: string): number => {
      if (!snapEnabled) return Math.max(0, Number(rawT.toFixed(2)));
      const points = [0, currentTime];
      videoClips.forEach((v) => {
        if (v.id !== excludeId) points.push(v.startTime, v.startTime + getVideoTimelineDuration(v));
      });
      audioClips.forEach((a) => {
        if (a.id !== excludeId) points.push(a.startTime, a.startTime + getAudioTimelineDuration(a));
      });
      textClips.forEach((t) => {
        if (t.id !== excludeId) points.push(t.startTime, t.startTime + t.duration);
      });

      const threshold = 0.18 / timelineZoom;
      for (const pt of points) {
        if (Math.abs(rawT - pt) <= threshold) {
          return Number(pt.toFixed(2));
        }
      }
      return Math.max(0, Number(rawT.toFixed(2)));
    },
    [snapEnabled, currentTime, videoClips, audioClips, textClips, timelineZoom]
  );

  // Direct Timeline Dragging & Left/Right Edge Trimming
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      const area = timelineTrackAreaRef.current;
      if (!drag || !area) return;

      const rect = area.getBoundingClientRect();
      const deltaSec = ((e.clientX - drag.startX) / rect.width) * totalDuration;

      if (drag.kind === 'video') {
        setVideoClips((prev) =>
          prev.map((v) => {
            if (v.id !== drag.id) return v;
            const speed = v.speed || 1;
            if (drag.mode === 'move') {
              const targetStart = snapTime(Math.max(0, drag.initialStartTime + deltaSec), v.id);
              setHoverTimeLabel(`Start: ${targetStart.toFixed(2)}s`);
              return { ...v, startTime: targetStart };
            }
            if (drag.mode === 'trim-left') {
              // Max delta is limited by source 0 on left and (trimEnd - 0.15) on right
              const minDelta = Math.max(-drag.initialStartTime, -drag.initialTrimStart / speed);
              const maxDelta = (drag.initialTrimEnd - drag.initialTrimStart) / speed - 0.15;
              const clampedDelta = Math.max(minDelta, Math.min(maxDelta, deltaSec));
              const nextStart = snapTime(drag.initialStartTime + clampedDelta, v.id);
              const actualDelta = nextStart - drag.initialStartTime;
              const nextTrimStart = Number(Math.max(0, drag.initialTrimStart + actualDelta * speed).toFixed(2));
              setHoverTimeLabel(`Trim In: ${nextTrimStart.toFixed(2)}s`);
              return { ...v, startTime: nextStart, trimStart: nextTrimStart };
            }
            if (drag.mode === 'trim-right') {
              const rawEndOnTimeline = drag.initialStartTime + (drag.initialTrimEnd - drag.initialTrimStart) / speed + deltaSec;
              const snappedEnd = snapTime(rawEndOnTimeline, v.id);
              const newTimelineDur = Math.max(0.15, snappedEnd - drag.initialStartTime);
              const nextTrimEnd = Number(
                Math.min(v.sourceDuration, Math.max(v.trimStart + 0.15, v.trimStart + newTimelineDur * speed)).toFixed(2)
              );
              setHoverTimeLabel(`Trim Out: ${nextTrimEnd.toFixed(2)}s`);
              return { ...v, trimEnd: nextTrimEnd };
            }
            return v;
          })
        );
      } else if (drag.kind === 'audio') {
        setAudioClips((prev) =>
          prev.map((a) => {
            if (a.id !== drag.id) return a;
            if (drag.mode === 'move') {
              const targetStart = snapTime(Math.max(0, drag.initialStartTime + deltaSec), a.id);
              setHoverTimeLabel(`Start: ${targetStart.toFixed(2)}s`);
              return { ...a, startTime: targetStart };
            }
            if (drag.mode === 'trim-left') {
              const minDelta = Math.max(-drag.initialStartTime, -drag.initialTrimStart);
              const maxDelta = drag.initialTrimEnd - drag.initialTrimStart - 0.15;
              const clampedDelta = Math.max(minDelta, Math.min(maxDelta, deltaSec));
              const nextStart = snapTime(drag.initialStartTime + clampedDelta, a.id);
              const actualDelta = nextStart - drag.initialStartTime;
              const nextTrimStart = Number(Math.max(0, drag.initialTrimStart + actualDelta).toFixed(2));
              setHoverTimeLabel(`Trim In: ${nextTrimStart.toFixed(2)}s`);
              return { ...a, startTime: nextStart, trimStart: nextTrimStart };
            }
            if (drag.mode === 'trim-right') {
              const rawEnd = drag.initialStartTime + (drag.initialTrimEnd - drag.initialTrimStart) + deltaSec;
              const snappedEnd = snapTime(rawEnd, a.id);
              const newDur = Math.max(0.15, snappedEnd - drag.initialStartTime);
              const nextTrimEnd = Number(
                Math.min(a.sourceDuration, Math.max(a.trimStart + 0.15, a.trimStart + newDur)).toFixed(2)
              );
              setHoverTimeLabel(`Trim Out: ${nextTrimEnd.toFixed(2)}s`);
              return { ...a, trimEnd: nextTrimEnd };
            }
            if (drag.mode === 'fade-in') {
              const dur = getAudioTimelineDuration(a);
              const nextFade = Number(Math.max(0, Math.min(dur, drag.initialFade + deltaSec)).toFixed(2));
              setHoverTimeLabel(`Fade In: ${nextFade.toFixed(2)}s`);
              return { ...a, fadeIn: nextFade };
            }
            if (drag.mode === 'fade-out') {
              const dur = getAudioTimelineDuration(a);
              const nextFade = Number(Math.max(0, Math.min(dur, drag.initialFade - deltaSec)).toFixed(2));
              setHoverTimeLabel(`Fade Out: ${nextFade.toFixed(2)}s`);
              return { ...a, fadeOut: nextFade };
            }
            return a;
          })
        );
      } else if (drag.kind === 'text') {
        setTextClips((prev) =>
          prev.map((tc) => {
            if (tc.id !== drag.id) return tc;
            if (drag.mode === 'move') {
              const nextStart = snapTime(Math.max(0, drag.initialStartTime + deltaSec), tc.id);
              setHoverTimeLabel(`Start: ${nextStart.toFixed(2)}s`);
              return { ...tc, startTime: nextStart };
            }
            if (drag.mode === 'trim-left') {
              const clamped = Math.max(-drag.initialStartTime, Math.min(drag.initialDuration - 0.2, deltaSec));
              const nextStart = snapTime(drag.initialStartTime + clamped, tc.id);
              const nextDur = Number(Math.max(0.2, drag.initialDuration - (nextStart - drag.initialStartTime)).toFixed(2));
              setHoverTimeLabel(`Duration: ${nextDur.toFixed(2)}s`);
              return { ...tc, startTime: nextStart, duration: nextDur };
            }
            if (drag.mode === 'trim-right') {
              const rawEnd = drag.initialStartTime + drag.initialDuration + deltaSec;
              const snappedEnd = snapTime(rawEnd, tc.id);
              const nextDur = Number(Math.max(0.2, snappedEnd - drag.initialStartTime).toFixed(2));
              setHoverTimeLabel(`Duration: ${nextDur.toFixed(2)}s`);
              return { ...tc, duration: nextDur };
            }
            return tc;
          })
        );
      }
    };

    const onUp = () => {
      dragRef.current = null;
      setHoverTimeLabel(null);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [totalDuration, snapTime]);

  const snapVideosSequentially = () => {
    let cursor = 0;
    setVideoClips((prev) =>
      prev.map((v) => {
        const updated = { ...v, startTime: Number(cursor.toFixed(2)) };
        cursor += getVideoTimelineDuration(v);
        return updated;
      })
    );
  };

  const exportVideo = () => {
    const canvas = previewCanvasRef.current;
    if (!canvas || (videoClips.length === 0 && audioClips.length === 0)) return;
    ensureAudioContext();

    const canvasStream = canvas.captureStream(30);
    const tracks = [...canvasStream.getVideoTracks()];
    if (masterDestRef.current) tracks.push(...masterDestRef.current.stream.getAudioTracks());
    const mixedStream = new MediaStream(tracks);

    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : 'video/webm';
    const recorder = new MediaRecorder(mixedStream, { mimeType: mime, videoBitsPerSecond: 6_500_000 });
    const chunks: BlobPart[] = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      setIsExporting(false);
      const blob = new Blob(chunks, { type: 'video/webm' });
      const link = document.createElement('a');
      link.download = `monolith-render-${Date.now()}.webm`;
      link.href = URL.createObjectURL(blob);
      link.click();
    };

    recorderRef.current = recorder;
    setIsExporting(true);
    recorder.start();
    startPlayback(0);
  };

  const selectedVideo = videoClips.find((v) => v.id === selectedId);
  const selectedAudio = audioClips.find((a) => a.id === selectedId);
  const selectedText = textClips.find((t) => t.id === selectedId);

  const fmtTime = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${Math.floor(s % 60).toString().padStart(2, '0')}.${Math.floor((s % 1) * 10)}`;

  return (
    <div className="space-y-4">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-white">Video Editor</h1>
          <div className="flex bg-[#0b0b0d] p-0.5 rounded border border-zinc-800">
            {(['16:9', '9:16', '1:1'] as const).map((ar) => (
              <button
                key={ar}
                onClick={() => setAspect(ar)}
                className={`px-2 py-0.5 rounded text-[11px] font-mono ${
                  aspect === ar ? 'bg-white text-black font-semibold' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {ar}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => videoInputRef.current?.click()}
            className="px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200"
          >
            + Video
          </button>
          <button
            onClick={() => audioInputRef.current?.click()}
            className="px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200"
          >
            + Audio
          </button>
          <button
            onClick={handleAddText}
            className="px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200"
          >
            + Title
          </button>

          {selectedId && (
            <button
              onClick={splitSelectedAtPlayhead}
              className="px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200"
              title="Split selected clip at Playhead (S)"
            >
              Split (S)
            </button>
          )}

          {videoClips.length > 1 && (
            <button
              onClick={snapVideosSequentially}
              className="px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-300"
            >
              Close Gaps
            </button>
          )}

          {(videoClips.length > 0 || audioClips.length > 0) && (
            <button
              onClick={exportVideo}
              disabled={isExporting}
              className="px-3.5 py-1.5 rounded bg-white hover:bg-zinc-200 text-black text-xs font-semibold disabled:opacity-40"
            >
              {isExporting ? 'Rendering...' : 'Export Video'}
            </button>
          )}
        </div>
      </div>

      <input
        ref={videoInputRef}
        type="file"
        multiple
        accept="video/*"
        onChange={(e) => handleAddVideos(e.target.files)}
        className="hidden"
      />
      <input
        ref={audioInputRef}
        type="file"
        multiple
        accept="audio/*,video/*"
        onChange={(e) => handleAddAudios(e.target.files)}
        className="hidden"
      />

      {/* Preview Monitor & Clip Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleAddVideos(e.dataTransfer.files);
            handleAddAudios(e.dataTransfer.files);
          }}
          className="lg:col-span-8 studio-panel rounded-lg overflow-hidden"
        >
          <div className="h-[340px] sm:h-[400px] bg-black flex items-center justify-center relative p-2">
            <canvas
              ref={previewCanvasRef}
              width={canvasDims.w}
              height={canvasDims.h}
              className="max-w-full max-h-full object-contain border border-zinc-900 block"
            />
            {videoClips.length === 0 && audioClips.length === 0 && textClips.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-500 pointer-events-none">
                Drop video & audio files here
              </div>
            )}
          </div>

          {/* Transport Bar */}
          <div className="p-2.5 bg-[#0b0b0d] border-t border-zinc-800 flex items-center gap-3">
            <button
              onClick={() => (isPlaying ? stopPlayback() : startPlayback(currentTime))}
              className={`px-3 py-1 rounded text-xs font-semibold ${
                isPlaying ? 'bg-[#ff4f00] text-black' : 'bg-white text-black'
              }`}
            >
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            <button
              onClick={() => {
                stopPlayback();
                setCurrentTime(0);
                pauseOffsetRef.current = 0;
              }}
              className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-xs text-zinc-300"
            >
              00:00
            </button>
            <span className="font-mono text-xs text-zinc-300">
              {fmtTime(currentTime)} / {fmtTime(totalDuration)}
            </span>
            <input
              type="range"
              min="0"
              max={totalDuration}
              step="0.02"
              value={currentTime}
              onChange={(e) => {
                const t = parseFloat(e.target.value);
                stopPlayback();
                setCurrentTime(t);
                pauseOffsetRef.current = t;
              }}
              className="flex-1"
            />
          </div>
        </div>

        {/* Minimal Clip Inspector */}
        <div className="lg:col-span-4 studio-panel rounded-lg p-4 space-y-3.5 max-h-[455px] overflow-y-auto custom-scrollbar">
          {selectedVideo ? (
            <>
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <span className="font-mono text-xs text-white truncate">{selectedVideo.name}</span>
                <button onClick={deleteSelected} className="text-xs text-red-400 hover:underline">
                  Delete
                </button>
              </div>

              <div>
                <label className="block text-[10px] font-mono uppercase text-zinc-500 mb-1">Transition</label>
                <div className="grid grid-cols-5 gap-1">
                  {(['none', 'fade', 'slide', 'zoom', 'wipe'] as const).map((tr) => (
                    <button
                      key={tr}
                      onClick={() =>
                        setVideoClips((p) => p.map((v) => (v.id === selectedVideo.id ? { ...v, transition: tr } : v)))
                      }
                      className={`py-1 rounded text-[11px] font-mono capitalize border ${
                        selectedVideo.transition === tr
                          ? 'bg-white text-black border-white font-semibold'
                          : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                      }`}
                    >
                      {tr}
                    </button>
                  ))}
                </div>
              </div>

              {selectedVideo.transition !== 'none' && (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Transition Time</span>
                    <span className="font-mono text-zinc-200">{selectedVideo.transitionDuration}s</span>
                  </div>
                  <input
                    type="range"
                    min="0.2"
                    max="2.5"
                    step="0.1"
                    value={selectedVideo.transitionDuration}
                    onChange={(e) =>
                      setVideoClips((p) =>
                        p.map((v) => (v.id === selectedVideo.id ? { ...v, transitionDuration: parseFloat(e.target.value) } : v))
                      )
                    }
                  />
                </div>
              )}

              <div>
                <label className="block text-[10px] font-mono uppercase text-zinc-500 mb-1">Layout / Overlay</label>
                <div className="grid grid-cols-5 gap-1">
                  {[
                    { id: 'full', label: 'Full' },
                    { id: 'pip-br', label: 'PiP BR' },
                    { id: 'pip-tr', label: 'PiP TR' },
                    { id: 'split-l', label: 'Left' },
                    { id: 'split-r', label: 'Right' },
                  ].map((ly) => (
                    <button
                      key={ly.id}
                      onClick={() =>
                        setVideoClips((p) => p.map((v) => (v.id === selectedVideo.id ? { ...v, layout: ly.id as LayoutMode } : v)))
                      }
                      className={`py-1 rounded text-[11px] font-mono border ${
                        selectedVideo.layout === ly.id
                          ? 'bg-white text-black border-white font-semibold'
                          : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                      }`}
                    >
                      {ly.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono uppercase text-zinc-500 mb-1">Playback Speed</label>
                <div className="grid grid-cols-4 gap-1">
                  {[0.5, 1, 1.5, 2].map((sp) => (
                    <button
                      key={sp}
                      onClick={() =>
                        setVideoClips((p) => p.map((v) => (v.id === selectedVideo.id ? { ...v, speed: sp } : v)))
                      }
                      className={`py-1 rounded text-xs font-mono border ${
                        selectedVideo.speed === sp
                          ? 'bg-white text-black border-white font-semibold'
                          : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                      }`}
                    >
                      {sp}x
                    </button>
                  ))}
                </div>
              </div>

              {[
                { k: 'opacity', l: 'Opacity', min: 0.1, max: 1, step: 0.05, fmt: (v: number) => `${Math.round(v * 100)}%` },
                { k: 'brightness', l: 'Brightness', min: 40, max: 160, step: 1, fmt: (v: number) => `${v}%` },
                { k: 'contrast', l: 'Contrast', min: 40, max: 160, step: 1, fmt: (v: number) => `${v}%` },
                { k: 'saturate', l: 'Saturation', min: 0, max: 200, step: 1, fmt: (v: number) => `${v}%` },
              ].map((s) => (
                <div key={s.k} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">{s.l}</span>
                    <span className="font-mono text-zinc-200">{s.fmt((selectedVideo as any)[s.k])}</span>
                  </div>
                  <input
                    type="range"
                    min={s.min}
                    max={s.max}
                    step={s.step}
                    value={(selectedVideo as any)[s.k]}
                    onChange={(e) =>
                      setVideoClips((p) =>
                        p.map((v) => (v.id === selectedVideo.id ? { ...v, [s.k]: parseFloat(e.target.value) } : v))
                      )
                    }
                  />
                </div>
              ))}

              <div className="space-y-1 pt-1 border-t border-zinc-800">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-400">Original Video Audio</span>
                  <button
                    onClick={() =>
                      setVideoClips((p) => p.map((v) => (v.id === selectedVideo.id ? { ...v, muted: !v.muted } : v)))
                    }
                    className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                      selectedVideo.muted ? 'bg-red-500 text-black font-bold' : 'bg-zinc-800 text-zinc-300'
                    }`}
                  >
                    {selectedVideo.muted ? 'MUTED' : `${Math.round(selectedVideo.volume * 100)}%`}
                  </button>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.02"
                  value={selectedVideo.muted ? 0 : selectedVideo.volume}
                  onChange={(e) =>
                    setVideoClips((p) =>
                      p.map((v) =>
                        v.id === selectedVideo.id ? { ...v, volume: parseFloat(e.target.value), muted: false } : v
                      )
                    )
                  }
                />
              </div>
            </>
          ) : selectedAudio ? (
            <>
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <span className="font-mono text-xs text-white truncate">{selectedAudio.name}</span>
                <button onClick={deleteSelected} className="text-xs text-red-400 hover:underline">
                  Delete
                </button>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-400">Fade In</span>
                  <span className="font-mono text-zinc-200">{selectedAudio.fadeIn}s</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.1"
                  value={selectedAudio.fadeIn}
                  onChange={(e) =>
                    setAudioClips((p) =>
                      p.map((a) => (a.id === selectedAudio.id ? { ...a, fadeIn: parseFloat(e.target.value) } : a))
                    )
                  }
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-400">Fade Out</span>
                  <span className="font-mono text-zinc-200">{selectedAudio.fadeOut}s</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.1"
                  value={selectedAudio.fadeOut}
                  onChange={(e) =>
                    setAudioClips((p) =>
                      p.map((a) => (a.id === selectedAudio.id ? { ...a, fadeOut: parseFloat(e.target.value) } : a))
                    )
                  }
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-400">Volume</span>
                  <span className="font-mono text-zinc-200">{Math.round(selectedAudio.volume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1.5"
                  step="0.02"
                  value={selectedAudio.volume}
                  onChange={(e) =>
                    setAudioClips((p) =>
                      p.map((a) => (a.id === selectedAudio.id ? { ...a, volume: parseFloat(e.target.value) } : a))
                    )
                  }
                />
              </div>
            </>
          ) : selectedText ? (
            <>
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <span className="font-mono text-xs text-white">Title Overlay</span>
                <button onClick={deleteSelected} className="text-xs text-red-400 hover:underline">
                  Delete
                </button>
              </div>

              <div>
                <label className="block text-[10px] font-mono uppercase text-zinc-500 mb-1">Text</label>
                <input
                  type="text"
                  value={selectedText.text}
                  onChange={(e) =>
                    setTextClips((p) => p.map((t) => (t.id === selectedText.id ? { ...t, text: e.target.value } : t)))
                  }
                  className="w-full bg-[#070708] border border-zinc-800 rounded p-2 text-xs text-white focus:outline-none select-text"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono uppercase text-zinc-500 mb-1">Position</label>
                <div className="grid grid-cols-4 gap-1">
                  {[
                    { id: 'bottom', label: 'Bottom' },
                    { id: 'center', label: 'Center' },
                    { id: 'top', label: 'Top' },
                    { id: 'lower-left', label: 'Lower L' },
                  ].map((pos) => (
                    <button
                      key={pos.id}
                      onClick={() =>
                        setTextClips((p) =>
                          p.map((t) => (t.id === selectedText.id ? { ...t, position: pos.id as TextPosition } : t))
                        )
                      }
                      className={`py-1 rounded text-[11px] font-mono border ${
                        selectedText.position === pos.id
                          ? 'bg-white text-black border-white font-semibold'
                          : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                      }`}
                    >
                      {pos.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-400">Font Size</span>
                  <span className="font-mono text-zinc-200">{selectedText.fontSize}px</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="110"
                  value={selectedText.fontSize}
                  onChange={(e) =>
                    setTextClips((p) =>
                      p.map((t) => (t.id === selectedText.id ? { ...t, fontSize: parseInt(e.target.value) } : t))
                    )
                  }
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={selectedText.color}
                    onChange={(e) =>
                      setTextClips((p) => p.map((t) => (t.id === selectedText.id ? { ...t, color: e.target.value } : t)))
                    }
                    className="w-7 h-7 rounded"
                  />
                  <span className="text-xs text-zinc-400">Color</span>
                </div>
                <button
                  onClick={() =>
                    setTextClips((p) => p.map((t) => (t.id === selectedText.id ? { ...t, bgBox: !t.bgBox } : t)))
                  }
                  className={`px-2.5 py-1 rounded text-xs font-mono border ${
                    selectedText.bgBox
                      ? 'bg-white text-black border-white font-semibold'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                  }`}
                >
                  Backdrop Box
                </button>
              </div>
            </>
          ) : (
            <div className="py-12 text-center text-xs text-zinc-500">
              Click any clip on the timeline to edit, or drag the left/right edges of a clip directly on the timeline to trim it.
            </div>
          )}
        </div>
      </div>

      {/* Timeline Panel with Direct Edge Trimming & Zoom */}
      <div className="studio-panel rounded-lg p-3 space-y-2 select-none">
        {/* Timeline Header Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSnapEnabled(!snapEnabled)}
              className={`px-2.5 py-1 rounded font-mono text-[11px] border ${
                snapEnabled
                  ? 'bg-white text-black border-white font-semibold'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-800'
              }`}
            >
              Magnet Snap: {snapEnabled ? 'ON' : 'OFF'}
            </button>
            {hoverTimeLabel && (
              <span className="px-2 py-0.5 rounded bg-[#ff4f00] text-black font-mono font-bold text-[11px]">
                {hoverTimeLabel}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-zinc-500">ZOOM</span>
            <input
              type="range"
              min="1"
              max="4"
              step="0.25"
              value={timelineZoom}
              onChange={(e) => setTimelineZoom(parseFloat(e.target.value))}
              className="w-24"
            />
          </div>
        </div>

        {/* Scrollable Multi-Track Area */}
        <div className="overflow-x-auto custom-scrollbar">
          <div
            ref={timelineTrackAreaRef}
            style={{ width: `${timelineZoom * 100}%` }}
            onClick={(e) => {
              if (dragRef.current) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              const nextT = ratio * totalDuration;
              stopPlayback();
              setCurrentTime(nextT);
              pauseOffsetRef.current = nextT;
            }}
            className="relative bg-[#070708] border border-zinc-800 rounded overflow-hidden cursor-pointer min-w-full"
          >
            {/* Time Ruler */}
            <div className="h-6 border-b border-zinc-800/80 flex items-center justify-between px-2 font-mono text-[10px] text-zinc-500">
              <span>0.0s</span>
              <span>{(totalDuration * 0.25).toFixed(1)}s</span>
              <span>{(totalDuration * 0.5).toFixed(1)}s</span>
              <span>{(totalDuration * 0.75).toFixed(1)}s</span>
              <span>{totalDuration.toFixed(1)}s</span>
            </div>

            {/* Title / Text Track */}
            {textClips.length > 0 && (
              <div className="p-1.5 space-y-1 border-b border-zinc-800/60">
                {textClips.map((tc) => {
                  const leftPct = (tc.startTime / totalDuration) * 100;
                  const widthPct = Math.max(1.5, (tc.duration / totalDuration) * 100);
                  const isSel = selectedId === tc.id;

                  return (
                    <div key={tc.id} className="relative h-8 bg-zinc-950/60 rounded">
                      <div
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setSelectedId(tc.id);
                          dragRef.current = {
                            id: tc.id,
                            kind: 'text',
                            mode: 'move',
                            startX: e.clientX,
                            initialStartTime: tc.startTime,
                            initialTrimStart: 0,
                            initialTrimEnd: 0,
                            initialDuration: tc.duration,
                            initialFade: 0,
                          };
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(tc.id);
                        }}
                        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                        className={`absolute inset-y-0 rounded flex items-center justify-between text-[11px] font-mono cursor-grab active:cursor-grabbing border group ${
                          isSel
                            ? 'bg-zinc-800 text-white border-white'
                            : 'bg-zinc-900 text-zinc-300 border-zinc-700'
                        }`}
                      >
                        {/* Left Edge Trim Handle */}
                        <div
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setSelectedId(tc.id);
                            dragRef.current = {
                              id: tc.id,
                              kind: 'text',
                              mode: 'trim-left',
                              startX: e.clientX,
                              initialStartTime: tc.startTime,
                              initialTrimStart: 0,
                              initialTrimEnd: 0,
                              initialDuration: tc.duration,
                              initialFade: 0,
                            };
                          }}
                          className="w-2.5 h-full bg-white/20 hover:bg-[#ff4f00] cursor-ew-resize flex-shrink-0 rounded-l"
                          title="Drag to trim start"
                        />
                        <span className="truncate px-1.5">T: {tc.text}</span>
                        {/* Right Edge Trim Handle */}
                        <div
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setSelectedId(tc.id);
                            dragRef.current = {
                              id: tc.id,
                              kind: 'text',
                              mode: 'trim-right',
                              startX: e.clientX,
                              initialStartTime: tc.startTime,
                              initialTrimStart: 0,
                              initialTrimEnd: 0,
                              initialDuration: tc.duration,
                              initialFade: 0,
                            };
                          }}
                          className="w-2.5 h-full bg-white/20 hover:bg-[#ff4f00] cursor-ew-resize flex-shrink-0 rounded-r"
                          title="Drag to trim end"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Video Tracks with Left/Right Edge Trimming Handles & Filmstrip */}
            <div className="p-1.5 space-y-1.5 border-b border-zinc-800/60 min-h-[56px]">
              {videoClips.map((vc) => {
                const dur = getVideoTimelineDuration(vc);
                const leftPct = (vc.startTime / totalDuration) * 100;
                const widthPct = Math.max(1.5, (dur / totalDuration) * 100);
                const isSel = selectedId === vc.id;

                return (
                  <div key={vc.id} className="relative h-12 bg-zinc-950/80 rounded overflow-hidden">
                    <div
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setSelectedId(vc.id);
                        dragRef.current = {
                          id: vc.id,
                          kind: 'video',
                          mode: 'move',
                          startX: e.clientX,
                          initialStartTime: vc.startTime,
                          initialTrimStart: vc.trimStart,
                          initialTrimEnd: vc.trimEnd,
                          initialDuration: dur,
                          initialFade: 0,
                        };
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedId(vc.id);
                      }}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      className={`absolute inset-y-0 rounded overflow-hidden flex items-center justify-between text-[11px] font-mono cursor-grab active:cursor-grabbing border ${
                        isSel
                          ? 'border-white ring-1 ring-white text-white'
                          : 'border-zinc-700 hover:border-zinc-500 text-zinc-200'
                      }`}
                    >
                      {/* Filmstrip Thumbnails Background */}
                      <div className="absolute inset-0 flex opacity-35 pointer-events-none">
                        {vc.thumbnails.map((th, idx) => (
                          <img key={idx} src={th} alt="" className="flex-1 h-full object-cover" />
                        ))}
                      </div>

                      {/* LEFT EDGE TRIM HANDLE */}
                      <div
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setSelectedId(vc.id);
                          dragRef.current = {
                            id: vc.id,
                            kind: 'video',
                            mode: 'trim-left',
                            startX: e.clientX,
                            initialStartTime: vc.startTime,
                            initialTrimStart: vc.trimStart,
                            initialTrimEnd: vc.trimEnd,
                            initialDuration: dur,
                            initialFade: 0,
                          };
                        }}
                        className="relative z-20 w-3 h-full bg-white/25 hover:bg-[#ff4f00] cursor-ew-resize flex items-center justify-center flex-shrink-0 transition-colors"
                        title="Drag edge to trim video start"
                      >
                        <div className="w-0.5 h-4 bg-black/70 rounded" />
                      </div>

                      <div className="relative z-10 flex items-center justify-between w-full px-2 min-w-0 pointer-events-none">
                        <span className="truncate font-semibold drop-shadow">{vc.name}</span>
                        <span className="text-[10px] text-zinc-300 ml-1.5 flex-shrink-0">
                          {vc.speed !== 1 ? `${vc.speed}x • ` : ''}
                          {dur.toFixed(1)}s
                        </span>
                      </div>

                      {/* RIGHT EDGE TRIM HANDLE */}
                      <div
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setSelectedId(vc.id);
                          dragRef.current = {
                            id: vc.id,
                            kind: 'video',
                            mode: 'trim-right',
                            startX: e.clientX,
                            initialStartTime: vc.startTime,
                            initialTrimStart: vc.trimStart,
                            initialTrimEnd: vc.trimEnd,
                            initialDuration: dur,
                            initialFade: 0,
                          };
                        }}
                        className="relative z-20 w-3 h-full bg-white/25 hover:bg-[#ff4f00] cursor-ew-resize flex items-center justify-center flex-shrink-0 transition-colors"
                        title="Drag edge to trim video end"
                      >
                        <div className="w-0.5 h-4 bg-black/70 rounded" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Audio Tracks with Left/Right Edge Trimming Handles & Interactive Fade Ramps */}
            <div className="p-1.5 space-y-1.5 min-h-[52px]">
              {audioClips.map((ac) => {
                const dur = getAudioTimelineDuration(ac);
                const leftPct = (ac.startTime / totalDuration) * 100;
                const widthPct = Math.max(1.5, (dur / totalDuration) * 100);
                const fadeInPct = Math.min(50, (ac.fadeIn / dur) * 100);
                const fadeOutPct = Math.min(50, (ac.fadeOut / dur) * 100);
                const isSel = selectedId === ac.id;

                return (
                  <div key={ac.id} className="relative h-11 bg-zinc-950/80 rounded overflow-hidden">
                    <div
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setSelectedId(ac.id);
                        dragRef.current = {
                          id: ac.id,
                          kind: 'audio',
                          mode: 'move',
                          startX: e.clientX,
                          initialStartTime: ac.startTime,
                          initialTrimStart: ac.trimStart,
                          initialTrimEnd: ac.trimEnd,
                          initialDuration: dur,
                          initialFade: 0,
                        };
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedId(ac.id);
                      }}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      className={`absolute inset-y-0 rounded overflow-hidden flex items-center justify-between text-[11px] font-mono cursor-grab active:cursor-grabbing border ${
                        isSel
                          ? 'bg-zinc-900 text-white border-[#ff4f00] ring-1 ring-[#ff4f00]'
                          : 'bg-zinc-900/90 text-zinc-300 border-zinc-700 hover:border-zinc-500'
                      }`}
                    >
                      {/* Waveform Bars */}
                      <div className="absolute inset-0 flex items-center px-3 gap-[1px] opacity-25 pointer-events-none">
                        {ac.peaks.map((pk, idx) => (
                          <div key={idx} style={{ height: `${Math.max(12, pk * 90)}%` }} className="flex-1 bg-white" />
                        ))}
                      </div>

                      {/* Shaded Fade-In Ramp */}
                      {fadeInPct > 0 && (
                        <div
                          style={{
                            width: `${fadeInPct}%`,
                            background: 'linear-gradient(to bottom right, rgba(255,79,0,0.45) 50%, transparent 50%)',
                          }}
                          className="absolute inset-y-0 left-3 pointer-events-none"
                        />
                      )}

                      {/* Shaded Fade-Out Ramp */}
                      {fadeOutPct > 0 && (
                        <div
                          style={{
                            width: `${fadeOutPct}%`,
                            background: 'linear-gradient(to bottom left, rgba(255,79,0,0.45) 50%, transparent 50%)',
                          }}
                          className="absolute inset-y-0 right-3 pointer-events-none"
                        />
                      )}

                      {/* LEFT EDGE TRIM HANDLE */}
                      <div
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setSelectedId(ac.id);
                          dragRef.current = {
                            id: ac.id,
                            kind: 'audio',
                            mode: 'trim-left',
                            startX: e.clientX,
                            initialStartTime: ac.startTime,
                            initialTrimStart: ac.trimStart,
                            initialTrimEnd: ac.trimEnd,
                            initialDuration: dur,
                            initialFade: 0,
                          };
                        }}
                        className="relative z-20 w-3 h-full bg-white/25 hover:bg-[#ff4f00] cursor-ew-resize flex items-center justify-center flex-shrink-0 transition-colors"
                        title="Drag edge to trim audio start"
                      >
                        <div className="w-0.5 h-4 bg-black/70 rounded" />
                      </div>

                      <div className="relative z-10 flex items-center justify-between w-full px-2 min-w-0 pointer-events-none">
                        <span className="truncate">{ac.name}</span>
                        <span className="text-[10px] text-zinc-400 ml-1.5 flex-shrink-0">
                          ↗{ac.fadeIn}s ↘{ac.fadeOut}s • {dur.toFixed(1)}s
                        </span>
                      </div>

                      {/* RIGHT EDGE TRIM HANDLE */}
                      <div
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setSelectedId(ac.id);
                          dragRef.current = {
                            id: ac.id,
                            kind: 'audio',
                            mode: 'trim-right',
                            startX: e.clientX,
                            initialStartTime: ac.startTime,
                            initialTrimStart: ac.trimStart,
                            initialTrimEnd: ac.trimEnd,
                            initialDuration: dur,
                            initialFade: 0,
                          };
                        }}
                        className="relative z-20 w-3 h-full bg-white/25 hover:bg-[#ff4f00] cursor-ew-resize flex items-center justify-center flex-shrink-0 transition-colors"
                        title="Drag edge to trim audio end"
                      >
                        <div className="w-0.5 h-4 bg-black/70 rounded" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Playhead Cursor Line */}
            <div
              style={{ left: `${Math.min(100, (currentTime / totalDuration) * 100)}%` }}
              className="absolute inset-y-0 w-0.5 bg-[#ff4f00] pointer-events-none z-30"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoEditor;
