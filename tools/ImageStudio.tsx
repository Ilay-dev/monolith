import React, { useState, useRef, useEffect, useCallback } from 'react';

interface FilterState {
  brightness: number;
  contrast: number;
  saturate: number;
  exposure: number;
  highlights: number;
  shadows: number;
  warmth: number;
  tint: number;
  gamma: number;
  hueRotate: number;
  grayscale: number;
  sepia: number;
  invert: number;
  blur: number;
  sharpen: number;
  vignette: number;
  noise: number;
  pixelate: number;
  chromatic: number;
  rotation: number;
  fineAngle: number;
  flipH: boolean;
  flipV: boolean;
  aspectRatio: 'free' | '1:1' | '16:9' | '4:3' | '3:2' | '9:16';
}

const DEFAULT_FILTERS: FilterState = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  exposure: 0,
  highlights: 0,
  shadows: 0,
  warmth: 0,
  tint: 0,
  gamma: 1.0,
  hueRotate: 0,
  grayscale: 0,
  sepia: 0,
  invert: 0,
  blur: 0,
  sharpen: 0,
  vignette: 0,
  noise: 0,
  pixelate: 0,
  chromatic: 0,
  rotation: 0,
  fineAngle: 0,
  flipH: false,
  flipV: false,
  aspectRatio: 'free',
};

const PRESETS: Record<string, { label: string; values: Partial<FilterState> }> = {
  neutral: { label: 'Neutral', values: { ...DEFAULT_FILTERS } },
  monoNoir: {
    label: 'Noir B&W',
    values: { grayscale: 100, contrast: 135, brightness: 95, shadows: -15, highlights: 10, vignette: 35, noise: 12 },
  },
  monoHigh: {
    label: 'Studio Mono',
    values: { grayscale: 100, contrast: 118, brightness: 104, sharpen: 25, gamma: 1.05 },
  },
  warmFilm: {
    label: 'Analog 35mm',
    values: { warmth: 25, contrast: 110, saturate: 88, shadows: 12, vignette: 20, noise: 15, sepia: 12 },
  },
  coldSteel: {
    label: 'Cold Steel',
    values: { warmth: -30, tint: -10, contrast: 122, saturate: 75, highlights: 15 },
  },
  matteFade: {
    label: 'Matte Fade',
    values: { contrast: 85, shadows: 28, brightness: 105, saturate: 85, vignette: 15 },
  },
  chrome: {
    label: 'Chrome',
    values: { contrast: 130, saturate: 135, sharpen: 35, chromatic: 4 },
  },
  inverted: {
    label: 'Negative',
    values: { invert: 100, grayscale: 100, contrast: 125 },
  },
};

const ImageStudio: React.FC = () => {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('image');
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [activeTab, setActiveTab] = useState<'light' | 'effects' | 'geometry' | 'presets'>('light');
  const [showOriginal, setShowOriginal] = useState(false);
  const [exportFormat, setExportFormat] = useState<'image/png' | 'image/jpeg' | 'image/webp'>('image/png');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadedImageRef = useRef<HTMLImageElement | null>(null);
  const rafRef = useRef<number>(0);

  const updateFilter = <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const applyPreset = (key: string) => {
    const preset = PRESETS[key];
    if (!preset) return;
    setFilters((prev) => ({
      ...DEFAULT_FILTERS,
      rotation: prev.rotation,
      fineAngle: prev.fineAngle,
      flipH: prev.flipH,
      flipV: prev.flipV,
      aspectRatio: prev.aspectRatio,
      ...preset.values,
    }));
  };

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = loadedImageRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const activeFilters = showOriginal ? DEFAULT_FILTERS : filters;

    let srcX = 0, srcY = 0, srcW = img.naturalWidth, srcH = img.naturalHeight;
    if (activeFilters.aspectRatio !== 'free') {
      const [rw, rh] = activeFilters.aspectRatio.split(':').map(Number);
      const targetRatio = rw / rh;
      const currentRatio = srcW / srcH;
      if (currentRatio > targetRatio) {
        srcW = Math.round(srcH * targetRatio);
        srcX = Math.round((img.naturalWidth - srcW) / 2);
      } else {
        srcH = Math.round(srcW / targetRatio);
        srcY = Math.round((img.naturalHeight - srcH) / 2);
      }
    }

    const isRotated90 = Math.abs(activeFilters.rotation / 90) % 2 === 1;
    const outW = isRotated90 ? srcH : srcW;
    const outH = isRotated90 ? srcW : srcH;

    canvas.width = outW;
    canvas.height = outH;

    ctx.save();
    ctx.clearRect(0, 0, outW, outH);
    ctx.filter = `
      brightness(${Math.max(0, activeFilters.brightness + activeFilters.exposure)}%)
      contrast(${activeFilters.contrast}%)
      grayscale(${activeFilters.grayscale}%)
      sepia(${activeFilters.sepia}%)
      saturate(${activeFilters.saturate}%)
      hue-rotate(${activeFilters.hueRotate}deg)
      invert(${activeFilters.invert}%)
      blur(${activeFilters.blur}px)
    `;

    ctx.translate(outW / 2, outH / 2);
    ctx.rotate(((activeFilters.rotation + activeFilters.fineAngle) * Math.PI) / 180);
    ctx.scale(activeFilters.flipH ? -1 : 1, activeFilters.flipV ? -1 : 1);
    ctx.drawImage(img, srcX, srcY, srcW, srcH, -srcW / 2, -srcH / 2, srcW, srcH);
    ctx.restore();
    ctx.filter = 'none';

    const needsPixelPass =
      activeFilters.warmth !== 0 ||
      activeFilters.tint !== 0 ||
      activeFilters.highlights !== 0 ||
      activeFilters.shadows !== 0 ||
      activeFilters.gamma !== 1.0 ||
      activeFilters.pixelate > 0 ||
      activeFilters.noise > 0 ||
      activeFilters.vignette > 0 ||
      activeFilters.chromatic > 0 ||
      activeFilters.sharpen > 0;

    if (!needsPixelPass) return;

    const imageData = ctx.getImageData(0, 0, outW, outH);
    const data = imageData.data;

    if (activeFilters.pixelate > 0) {
      const blockSize = Math.max(2, Math.floor(activeFilters.pixelate));
      for (let y = 0; y < outH; y += blockSize) {
        for (let x = 0; x < outW; x += blockSize) {
          const idx = (y * outW + x) * 4;
          const r = data[idx], g = data[idx + 1], b = data[idx + 2];
          for (let dy = 0; dy < blockSize && y + dy < outH; dy++) {
            for (let dx = 0; dx < blockSize && x + dx < outW; dx++) {
              const nIdx = ((y + dy) * outW + (x + dx)) * 4;
              data[nIdx] = r; data[nIdx + 1] = g; data[nIdx + 2] = b;
            }
          }
        }
      }
    }

    if (activeFilters.chromatic > 0) {
      const shift = Math.round(activeFilters.chromatic * 2);
      const copy = new Uint8ClampedArray(data);
      for (let y = 0; y < outH; y++) {
        for (let x = 0; x < outW; x++) {
          const idx = (y * outW + x) * 4;
          data[idx] = copy[(y * outW + Math.max(0, x - shift)) * 4];
          data[idx + 2] = copy[(y * outW + Math.min(outW - 1, x + shift)) * 4 + 2];
        }
      }
    }

    if (activeFilters.sharpen > 0) {
      const amt = activeFilters.sharpen / 100;
      const copy = new Uint8ClampedArray(data);
      for (let y = 1; y < outH - 1; y++) {
        for (let x = 1; x < outW - 1; x++) {
          const idx = (y * outW + x) * 4;
          const up = ((y - 1) * outW + x) * 4;
          const down = ((y + 1) * outW + x) * 4;
          const left = (y * outW + (x - 1)) * 4;
          const right = (y * outW + (x + 1)) * 4;
          for (let c = 0; c < 3; c++) {
            const lap = 5 * copy[idx + c] - copy[up + c] - copy[down + c] - copy[left + c] - copy[right + c];
            data[idx + c] = Math.min(255, Math.max(0, copy[idx + c] * (1 - amt) + lap * amt));
          }
        }
      }
    }

    const invGamma = 1 / Math.max(0.2, activeFilters.gamma);
    const warmth = activeFilters.warmth * 1.1;
    const tint = activeFilters.tint * 1.1;
    const shadows = activeFilters.shadows * 1.2;
    const highlights = activeFilters.highlights * 1.2;
    const centerX = outW / 2;
    const centerY = outH / 2;
    const maxDistSq = centerX * centerX + centerY * centerY || 1;
    const vigStrength = activeFilters.vignette / 100;
    const noiseAmp = activeFilters.noise * 1.8;

    if (
      activeFilters.gamma !== 1.0 ||
      warmth !== 0 ||
      tint !== 0 ||
      shadows !== 0 ||
      highlights !== 0 ||
      noiseAmp > 0 ||
      vigStrength > 0
    ) {
      for (let y = 0; y < outH; y++) {
        const dySq = (y - centerY) * (y - centerY);
        for (let x = 0; x < outW; x++) {
          const i = (y * outW + x) * 4;
          let r = data[i], g = data[i + 1], b = data[i + 2];

          if (shadows !== 0 || highlights !== 0) {
            const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            const delta = shadows * (1 - luma) * (1 - luma) + highlights * luma * luma;
            r += delta; g += delta; b += delta;
          }

          if (warmth !== 0 || tint !== 0) {
            r += warmth + tint * 0.4;
            g -= tint * 0.7;
            b -= warmth;
          }

          if (activeFilters.gamma !== 1.0) {
            r = 255 * Math.pow(Math.max(0, Math.min(255, r)) / 255, invGamma);
            g = 255 * Math.pow(Math.max(0, Math.min(255, g)) / 255, invGamma);
            b = 255 * Math.pow(Math.max(0, Math.min(255, b)) / 255, invGamma);
          }

          if (vigStrength > 0) {
            const dx = x - centerX;
            const factor = Math.max(0, 1 - ((dx * dx + dySq) / maxDistSq) * vigStrength);
            r *= factor; g *= factor; b *= factor;
          }

          if (noiseAmp > 0) {
            const n = (Math.random() - 0.5) * noiseAmp;
            r += n; g += n; b += n;
          }

          data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
          data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
          data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }, [filters, showOriginal]);

  useEffect(() => {
    if (!imageSrc) return;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(renderCanvas);
    return () => cancelAnimationFrame(rafRef.current);
  }, [imageSrc, filters, showOriginal, renderCanvas]);

  const handleFileUpload = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      if (!src) return;
      const img = new Image();
      img.onload = () => {
        loadedImageRef.current = img;
        setImageSrc(src);
        setFileName(file.name.replace(/\.[^/.]+$/, ''));
        setFilters(DEFAULT_FILTERS);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const downloadImage = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ext = exportFormat === 'image/png' ? 'png' : exportFormat === 'image/webp' ? 'webp' : 'jpg';
    const link = document.createElement('a');
    link.download = `${fileName}-edited.${ext}`;
    link.href = canvas.toDataURL(exportFormat, 0.92);
    link.click();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-800">
        <h1 className="text-base font-semibold text-white">Image Studio</h1>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200"
          >
            Open Image
          </button>

          {imageSrc && (
            <>
              <button
                onMouseDown={() => setShowOriginal(true)}
                onMouseUp={() => setShowOriginal(false)}
                onMouseLeave={() => setShowOriginal(false)}
                onTouchStart={() => setShowOriginal(true)}
                onTouchEnd={() => setShowOriginal(false)}
                className="px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-300"
              >
                Compare
              </button>

              <button
                onClick={() => setFilters(DEFAULT_FILTERS)}
                className="px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-400 hover:text-white"
              >
                Reset
              </button>

              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as any)}
                className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs font-mono text-zinc-200 focus:outline-none"
              >
                <option value="image/png">PNG</option>
                <option value="image/jpeg">JPEG</option>
                <option value="image/webp">WebP</option>
              </select>

              <button
                onClick={downloadImage}
                className="px-3.5 py-1.5 rounded bg-white hover:bg-zinc-200 text-black text-xs font-semibold"
              >
                Export
              </button>
            </>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="image/*"
        onChange={(e) => handleFileUpload(e.target.files?.[0])}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFileUpload(e.dataTransfer.files?.[0]);
          }}
          className="lg:col-span-8 studio-panel rounded-lg checkerboard flex items-center justify-center p-4 min-h-[420px] sm:min-h-[520px] overflow-hidden"
        >
          {imageSrc ? (
            <canvas
              ref={canvasRef}
              className="max-w-full max-h-[68vh] object-contain border border-zinc-800"
            />
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-center p-8 text-xs text-zinc-500 hover:text-zinc-300"
            >
              <i className="fas fa-plus block text-lg mb-2"></i>
              Drop image or click to open
            </button>
          )}
        </div>

        <div className="lg:col-span-4 studio-panel rounded-lg overflow-hidden">
          <div className="grid grid-cols-4 border-b border-zinc-800 bg-[#0b0b0d]">
            {[
              { id: 'light', label: 'Color' },
              { id: 'effects', label: 'Optics' },
              { id: 'geometry', label: 'Crop' },
              { id: 'presets', label: 'Presets' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id as any)}
                className={`py-2 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === t.id
                    ? 'border-white text-white'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div key={activeTab} className="p-4 space-y-3.5 max-h-[64vh] overflow-y-auto custom-scrollbar tool-view-transition">
            {activeTab === 'light' &&
              [
                { k: 'brightness', l: 'Brightness', min: 20, max: 200, step: 1 },
                { k: 'contrast', l: 'Contrast', min: 20, max: 200, step: 1 },
                { k: 'exposure', l: 'Exposure', min: -80, max: 80, step: 1 },
                { k: 'highlights', l: 'Highlights', min: -100, max: 100, step: 1 },
                { k: 'shadows', l: 'Shadows', min: -100, max: 100, step: 1 },
                { k: 'saturate', l: 'Saturation', min: 0, max: 200, step: 1 },
                { k: 'warmth', l: 'Temperature', min: -100, max: 100, step: 1 },
                { k: 'tint', l: 'Tint', min: -100, max: 100, step: 1 },
                { k: 'gamma', l: 'Gamma', min: 0.3, max: 2.5, step: 0.05 },
                { k: 'hueRotate', l: 'Hue', min: -180, max: 180, step: 1 },
              ].map((cfg) => (
                <div key={cfg.k} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-300">{cfg.l}</span>
                    <span className="font-mono text-zinc-400">{(filters as any)[cfg.k]}</span>
                  </div>
                  <input
                    type="range"
                    min={cfg.min}
                    max={cfg.max}
                    step={cfg.step}
                    value={(filters as any)[cfg.k]}
                    onChange={(e) => updateFilter(cfg.k as keyof FilterState, parseFloat(e.target.value))}
                  />
                </div>
              ))}

            {activeTab === 'effects' &&
              [
                { k: 'sharpen', l: 'Sharpen', min: 0, max: 100, step: 1 },
                { k: 'blur', l: 'Blur', min: 0, max: 24, step: 0.5 },
                { k: 'vignette', l: 'Vignette', min: 0, max: 100, step: 1 },
                { k: 'noise', l: 'Grain', min: 0, max: 100, step: 1 },
                { k: 'chromatic', l: 'Aberration', min: 0, max: 15, step: 1 },
                { k: 'pixelate', l: 'Pixelate', min: 0, max: 40, step: 1 },
                { k: 'grayscale', l: 'Grayscale', min: 0, max: 100, step: 1 },
                { k: 'sepia', l: 'Sepia', min: 0, max: 100, step: 1 },
                { k: 'invert', l: 'Invert', min: 0, max: 100, step: 1 },
              ].map((cfg) => (
                <div key={cfg.k} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-300">{cfg.l}</span>
                    <span className="font-mono text-zinc-400">{(filters as any)[cfg.k]}</span>
                  </div>
                  <input
                    type="range"
                    min={cfg.min}
                    max={cfg.max}
                    step={cfg.step}
                    value={(filters as any)[cfg.k]}
                    onChange={(e) => updateFilter(cfg.k as keyof FilterState, parseFloat(e.target.value))}
                  />
                </div>
              ))}

            {activeTab === 'geometry' && (
              <div className="space-y-4">
                <div className="grid grid-cols-4 gap-1.5">
                  <button
                    onClick={() => updateFilter('rotation', (filters.rotation - 90) % 360)}
                    className="py-2 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200"
                  >
                    -90°
                  </button>
                  <button
                    onClick={() => updateFilter('rotation', (filters.rotation + 90) % 360)}
                    className="py-2 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200"
                  >
                    +90°
                  </button>
                  <button
                    onClick={() => updateFilter('flipH', !filters.flipH)}
                    className={`py-2 rounded border text-xs ${
                      filters.flipH ? 'bg-white text-black border-white font-semibold' : 'bg-zinc-900 text-zinc-200 border-zinc-800'
                    }`}
                  >
                    Flip H
                  </button>
                  <button
                    onClick={() => updateFilter('flipV', !filters.flipV)}
                    className={`py-2 rounded border text-xs ${
                      filters.flipV ? 'bg-white text-black border-white font-semibold' : 'bg-zinc-900 text-zinc-200 border-zinc-800'
                    }`}
                  >
                    Flip V
                  </button>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-300">Angle</span>
                    <span className="font-mono text-zinc-400">{filters.fineAngle}°</span>
                  </div>
                  <input
                    type="range"
                    min="-45"
                    max="45"
                    step="0.5"
                    value={filters.fineAngle}
                    onChange={(e) => updateFilter('fineAngle', parseFloat(e.target.value))}
                  />
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  {(['free', '1:1', '16:9', '4:3', '3:2', '9:16'] as const).map((ratio) => (
                    <button
                      key={ratio}
                      onClick={() => updateFilter('aspectRatio', ratio)}
                      className={`py-1.5 rounded border text-xs font-mono uppercase ${
                        filters.aspectRatio === ratio
                          ? 'bg-white text-black border-white font-semibold'
                          : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                      }`}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'presets' && (
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(PRESETS).map(([key, preset]) => (
                  <button
                    key={key}
                    onClick={() => applyPreset(key)}
                    className="p-2.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200 text-left"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImageStudio;
