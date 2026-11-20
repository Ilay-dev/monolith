import React, { useState, useEffect, useRef, useCallback } from 'react';

declare const QRCode: any;

type DotStyle = 'square' | 'rounded' | 'dots' | 'diamond' | 'bars-v' | 'classy';
type EyeStyle = 'square' | 'rounded' | 'circle';

const QRGenerator: React.FC = () => {
  const [text, setText] = useState('https://monolith.studio');
  const [dotStyle, setDotStyle] = useState<DotStyle>('rounded');
  const [eyeStyle, setEyeStyle] = useState<EyeStyle>('rounded');
  const [fgColor, setFgColor] = useState('#09090b');
  const [bgColor, setBgColor] = useState('#ffffff');
  const [transparentBg, setTransparentBg] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const matrixRef = useRef<boolean[][]>([]);
  const size = 640;

  const isFinder = (r: number, c: number, count: number) =>
    (r < 7 && c < 7) || (r < 7 && c >= count - 7) || (r >= count - 7 && c < 7);

  const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  };

  const renderQR = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof QRCode === 'undefined') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const temp = document.createElement('div');
    let modules: boolean[][] = [];
    try {
      const qr = new QRCode(temp, { text: text || ' ', width: 128, height: 128, correctLevel: QRCode.CorrectLevel.H });
      if (qr?._oQRCode?.modules) modules = qr._oQRCode.modules;
    } catch {}
    matrixRef.current = modules;
    const count = modules.length;
    if (count === 0) return;

    canvas.width = size;
    canvas.height = size;
    ctx.clearRect(0, 0, size, size);

    if (!transparentBg) {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, size, size);
    }

    const margin = 3;
    const cell = size / (count + margin * 2);
    const off = margin * cell;

    ctx.fillStyle = fgColor;
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (!modules[r][c] || isFinder(r, c, count)) continue;
        const x = off + c * cell, y = off + r * cell;

        if (dotStyle === 'square') {
          ctx.fillRect(x, y, cell + 0.4, cell + 0.4);
        } else if (dotStyle === 'rounded') {
          roundRect(ctx, x + cell * 0.06, y + cell * 0.06, cell * 0.88, cell * 0.88, cell * 0.3);
          ctx.fill();
        } else if (dotStyle === 'dots') {
          ctx.beginPath();
          ctx.arc(x + cell / 2, y + cell / 2, cell * 0.44, 0, Math.PI * 2);
          ctx.fill();
        } else if (dotStyle === 'diamond') {
          ctx.beginPath();
          ctx.moveTo(x + cell / 2, y + cell * 0.05);
          ctx.lineTo(x + cell * 0.95, y + cell / 2);
          ctx.lineTo(x + cell / 2, y + cell * 0.95);
          ctx.lineTo(x + cell * 0.05, y + cell / 2);
          ctx.closePath();
          ctx.fill();
        } else if (dotStyle === 'bars-v') {
          const top = r > 0 && modules[r - 1][c] && !isFinder(r - 1, c, count);
          const bot = r < count - 1 && modules[r + 1][c] && !isFinder(r + 1, c, count);
          const pad = cell * 0.12, w = cell - pad * 2;
          if (top || bot) ctx.fillRect(x + pad, y - (top ? 0.5 : 0), w, cell + (bot ? 0.5 : 0));
          else { roundRect(ctx, x + pad, y + pad, w, w, w / 2); ctx.fill(); }
        } else {
          roundRect(ctx, x + cell * 0.04, y + cell * 0.04, cell * 0.92, cell * 0.92, cell * 0.42);
          ctx.fill();
        }
      }
    }

    // Finder Eyes
    [
      { r: 0, c: 0 },
      { r: 0, c: count - 7 },
      { r: count - 7, c: 0 },
    ].forEach((orig) => {
      const ex = off + orig.c * cell, ey = off + orig.r * cell;
      const outer = 7 * cell, pupil = 3 * cell;
      ctx.save();
      ctx.strokeStyle = fgColor;
      ctx.fillStyle = fgColor;
      ctx.lineWidth = cell;
      const inset = cell / 2, ring = outer - cell;

      if (eyeStyle === 'square') {
        ctx.strokeRect(ex + inset, ey + inset, ring, ring);
        ctx.fillRect(ex + 2 * cell, ey + 2 * cell, pupil, pupil);
      } else if (eyeStyle === 'rounded') {
        roundRect(ctx, ex + inset, ey + inset, ring, ring, cell * 1.5);
        ctx.stroke();
        roundRect(ctx, ex + 2 * cell, ey + 2 * cell, pupil, pupil, cell * 0.7);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(ex + outer / 2, ey + outer / 2, ring / 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(ex + outer / 2, ey + outer / 2, pupil / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  }, [text, dotStyle, eyeStyle, fgColor, bgColor, transparentBg]);

  useEffect(() => {
    renderQR();
  }, [renderQR]);

  const exportPNG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `qr-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const exportSVG = () => {
    const modules = matrixRef.current;
    const count = modules.length;
    if (count === 0) return;
    const margin = 3;
    const cell = size / (count + margin * 2);
    const off = margin * cell;
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`];
    if (!transparentBg) parts.push(`<rect width="100%" height="100%" fill="${bgColor}" />`);
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (!modules[r][c]) continue;
        const x = (off + c * cell).toFixed(2), y = (off + r * cell).toFixed(2), s = cell.toFixed(2);
        if (dotStyle === 'dots' && !isFinder(r, c, count)) {
          parts.push(`<circle cx="${(off + (c + 0.5) * cell).toFixed(2)}" cy="${(off + (r + 0.5) * cell).toFixed(2)}" r="${(cell * 0.44).toFixed(2)}" fill="${fgColor}" />`);
        } else {
          const rx = dotStyle === 'rounded' || dotStyle === 'classy' ? (cell * 0.3).toFixed(2) : '0';
          parts.push(`<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${rx}" fill="${fgColor}" />`);
        }
      }
    }
    parts.push('</svg>');
    const link = document.createElement('a');
    link.download = `qr-${Date.now()}.svg`;
    link.href = URL.createObjectURL(new Blob([parts.join('\n')], { type: 'image/svg+xml' }));
    link.click();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
        <h1 className="text-base font-semibold text-white">QR Gen</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={exportSVG}
            className="px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200"
          >
            Export SVG
          </button>
          <button
            onClick={exportPNG}
            className="px-3.5 py-1.5 rounded bg-white hover:bg-zinc-200 text-black text-xs font-semibold"
          >
            Export PNG
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-7 studio-panel rounded-lg p-4 space-y-4">
          <div>
            <label className="block text-[10px] font-mono uppercase text-zinc-500 mb-1">Content / URL</label>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="https://..."
              className="w-full bg-[#070708] border border-zinc-800 rounded p-2.5 text-xs font-mono text-white focus:outline-none select-text"
            />
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase text-zinc-500 mb-1.5">Dot Pattern</label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
              {[
                { id: 'square', label: 'Square' },
                { id: 'rounded', label: 'Rounded' },
                { id: 'dots', label: 'Dots' },
                { id: 'diamond', label: 'Diamond' },
                { id: 'bars-v', label: 'Liquid' },
                { id: 'classy', label: 'Classy' },
              ].map((s) => (
                <button
                  key={s.id}
                  onClick={() => setDotStyle(s.id as DotStyle)}
                  className={`py-1.5 rounded text-xs font-mono border ${
                    dotStyle === s.id
                      ? 'bg-white text-black border-white font-semibold'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase text-zinc-500 mb-1.5">Corner Eyes</label>
            <div className="grid grid-cols-3 gap-1.5">
              {(['square', 'rounded', 'circle'] as const).map((es) => (
                <button
                  key={es}
                  onClick={() => setEyeStyle(es)}
                  className={`py-1.5 rounded text-xs font-mono capitalize border ${
                    eyeStyle === es
                      ? 'bg-white text-black border-white font-semibold'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                  }`}
                >
                  {es}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-1">
            <div>
              <label className="block text-[10px] font-mono uppercase text-zinc-500 mb-1">Foreground</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={fgColor}
                  onChange={(e) => setFgColor(e.target.value)}
                  className="w-7 h-7 rounded"
                />
                <span className="font-mono text-xs text-zinc-300">{fgColor}</span>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-mono uppercase text-zinc-500 mb-1">Background</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={bgColor}
                  onChange={(e) => {
                    setBgColor(e.target.value);
                    setTransparentBg(false);
                  }}
                  className="w-7 h-7 rounded"
                />
                <button
                  onClick={() => setTransparentBg(!transparentBg)}
                  className={`px-2 py-1 rounded text-[10px] font-mono border ${
                    transparentBg
                      ? 'bg-white text-black border-white font-semibold'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                  }`}
                >
                  {transparentBg ? 'Transparent' : 'Solid'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 studio-panel rounded-lg p-6 flex items-center justify-center checkerboard min-h-[300px]">
          <canvas ref={canvasRef} className="w-60 h-60 rounded block shadow-lg" />
        </div>
      </div>
    </div>
  );
};

export default QRGenerator;
