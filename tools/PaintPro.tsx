import React, { useState, useRef, useEffect, useCallback } from 'react';

type PaintTool =
  | 'select'
  | 'brush'
  | 'highlighter'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'circle'
  | 'polygon'
  | 'eraser'
  | 'text'
  | 'eyedropper';

interface PaintElement {
  id: string;
  name: string;
  type: PaintTool;
  x: number;
  y: number;
  width: number;
  height: number;
  points?: { x: number; y: number }[];
  strokeColor: string;
  fillColor: string;
  filled: boolean;
  strokeWidth: number;
  opacity: number;
  text?: string;
  visible: boolean;
  img?: HTMLImageElement;
}

const PaintPro: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [activeTool, setActiveTool] = useState<PaintTool>('brush');
  const [elements, setElements] = useState<PaintElement[]>([]);
  const [history, setHistory] = useState<PaintElement[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [strokeColor, setStrokeColor] = useState('#ffffff');
  const [fillColor, setFillColor] = useState('#ff4f00');
  const [filled, setFilled] = useState(false);
  const [strokeWidth, setStrokeWidth] = useState(6);
  const [opacity, setOpacity] = useState(100);
  const [bgColor, setBgColor] = useState<'#09090b' | '#000000' | '#ffffff' | 'transparent'>('#09090b');

  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentElement, setCurrentElement] = useState<PaintElement | null>(null);

  const canvasSize = { width: 1600, height: 1000 };

  const commitElements = useCallback(
    (next: PaintElement[]) => {
      setElements(next);
      setHistory((prev) => [...prev.slice(0, historyIndex + 1).slice(-25), next]);
      setHistoryIndex((prev) => Math.min(25, prev + 1));
    },
    [historyIndex]
  );

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const idx = historyIndex - 1;
      setHistoryIndex(idx);
      setElements(history[idx]);
      setSelectedId(null);
    }
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const idx = historyIndex + 1;
      setHistoryIndex(idx);
      setElements(history[idx]);
      setSelectedId(null);
    }
  }, [history, historyIndex]);

  const getBounds = (el: PaintElement) => {
    if (el.points && el.points.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of el.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return { x: minX, y: minY, w: Math.max(20, maxX - minX), h: Math.max(20, maxY - minY) };
    }
    return {
      x: Math.min(el.x, el.x + el.width),
      y: Math.min(el.y, el.y + el.height),
      w: Math.max(20, Math.abs(el.width)),
      h: Math.max(20, Math.abs(el.height)),
    };
  };

  const drawElement = (ctx: CanvasRenderingContext2D, el: PaintElement) => {
    if (!el.visible) return;
    ctx.save();
    ctx.globalAlpha = (el.opacity ?? 100) / 100;
    ctx.lineWidth = el.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = el.strokeColor;
    ctx.fillStyle = el.fillColor;

    switch (el.type) {
      case 'brush':
      case 'highlighter':
      case 'eraser': {
        if (el.points && el.points.length > 0) {
          ctx.beginPath();
          if (el.type === 'eraser') ctx.strokeStyle = bgColor === 'transparent' ? '#09090b' : bgColor;
          else if (el.type === 'highlighter') ctx.globalAlpha = 0.35;
          ctx.moveTo(el.points[0].x, el.points[0].y);
          for (let i = 1; i < el.points.length; i++) ctx.lineTo(el.points[i].x, el.points[i].y);
          ctx.stroke();
        }
        break;
      }
      case 'line': {
        ctx.beginPath();
        ctx.moveTo(el.x, el.y);
        ctx.lineTo(el.x + el.width, el.y + el.height);
        ctx.stroke();
        break;
      }
      case 'arrow': {
        const ex = el.x + el.width, ey = el.y + el.height;
        const angle = Math.atan2(ey - el.y, ex - el.x);
        const head = Math.max(14, el.strokeWidth * 3.5);
        ctx.beginPath();
        ctx.moveTo(el.x, el.y);
        ctx.lineTo(ex, ey);
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - head * Math.cos(angle - Math.PI / 6), ey - head * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - head * Math.cos(angle + Math.PI / 6), ey - head * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
        break;
      }
      case 'rect': {
        if (el.filled) ctx.fillRect(el.x, el.y, el.width, el.height);
        ctx.strokeRect(el.x, el.y, el.width, el.height);
        break;
      }
      case 'circle': {
        ctx.beginPath();
        ctx.ellipse(el.x + el.width / 2, el.y + el.height / 2, Math.abs(el.width / 2), Math.abs(el.height / 2), 0, 0, Math.PI * 2);
        if (el.filled) ctx.fill();
        ctx.stroke();
        break;
      }
      case 'polygon': {
        ctx.beginPath();
        ctx.moveTo(el.x + el.width / 2, el.y);
        ctx.lineTo(el.x + el.width, el.y + el.height);
        ctx.lineTo(el.x, el.y + el.height);
        ctx.closePath();
        if (el.filled) ctx.fill();
        ctx.stroke();
        break;
      }
      case 'text': {
        const fs = Math.max(14, el.strokeWidth * 4);
        ctx.font = `600 ${fs}px Inter, sans-serif`;
        ctx.fillStyle = el.strokeColor;
        ctx.fillText(el.text || 'Text', el.x, el.y + fs);
        break;
      }
      case 'select': {
        if (el.img) ctx.drawImage(el.img, el.x, el.y, el.width, el.height);
        break;
      }
    }
    ctx.restore();
  };

  const renderCanvas = useCallback(
    (includeOverlay = true) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (bgColor !== 'transparent') {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      [...elements, currentElement].filter(Boolean).forEach((el) => {
        drawElement(ctx, el!);
        if (includeOverlay && el?.id === selectedId) {
          const b = getBounds(el!);
          ctx.save();
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = '#ff4f00';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12);
          ctx.restore();
        }
      });
    },
    [elements, currentElement, bgColor, selectedId]
  );

  useEffect(() => {
    renderCanvas(true);
  }, [renderCanvas]);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const cx = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const cy = 'touches' in e ? e.touches[0].clientY : e.clientY;
    return {
      x: Math.round((cx - rect.left) * (canvasSize.width / rect.width)),
      y: Math.round((cy - rect.top) * (canvasSize.height / rect.height)),
    };
  };

  const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
    if ('touches' in e && e.touches.length > 1) return;
    const pos = getPos(e);
    setStartPos(pos);

    if (activeTool === 'eyedropper') {
      const p = canvasRef.current?.getContext('2d')?.getImageData(pos.x, pos.y, 1, 1).data;
      if (p) {
        setStrokeColor('#' + [p[0], p[1], p[2]].map((v) => v.toString(16).padStart(2, '0')).join(''));
        setActiveTool('brush');
      }
      return;
    }

    if (activeTool === 'select') {
      const clicked = [...elements].reverse().find((el) => {
        if (!el.visible) return false;
        const b = getBounds(el);
        return pos.x >= b.x - 10 && pos.x <= b.x + b.w + 10 && pos.y >= b.y - 10 && pos.y <= b.y + b.h + 10;
      });
      setSelectedId(clicked ? clicked.id : null);
      if (clicked) setIsDrawing(true);
      return;
    }

    if (activeTool === 'text') {
      const id = Math.random().toString(36).slice(2, 8);
      commitElements([
        ...elements,
        {
          id,
          name: `Text #${elements.length + 1}`,
          type: 'text',
          x: pos.x,
          y: pos.y,
          width: 200,
          height: strokeWidth * 4,
          text: 'Text',
          strokeColor,
          fillColor,
          filled,
          strokeWidth,
          opacity,
          visible: true,
        },
      ]);
      setSelectedId(id);
      setActiveTool('select');
      return;
    }

    setIsDrawing(true);
    setCurrentElement({
      id: Math.random().toString(36).slice(2, 8),
      name: `${activeTool} #${elements.length + 1}`,
      type: activeTool,
      x: pos.x,
      y: pos.y,
      width: 0,
      height: 0,
      points: ['brush', 'highlighter', 'eraser'].includes(activeTool) ? [pos] : undefined,
      strokeColor,
      fillColor,
      filled,
      strokeWidth,
      opacity,
      visible: true,
    });
  };

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    if ('touches' in e && e.touches.length > 1) return;
    const pos = getPos(e);

    if (activeTool === 'select' && selectedId) {
      const dx = pos.x - startPos.x, dy = pos.y - startPos.y;
      setElements((prev) =>
        prev.map((el) =>
          el.id !== selectedId
            ? el
            : el.points
            ? { ...el, points: el.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
            : { ...el, x: el.x + dx, y: el.y + dy }
        )
      );
      setStartPos(pos);
      return;
    }

    if (!currentElement) return;
    if (['brush', 'highlighter', 'eraser'].includes(activeTool)) {
      setCurrentElement({ ...currentElement, points: [...(currentElement.points || []), pos] });
    } else {
      setCurrentElement({ ...currentElement, width: pos.x - startPos.x, height: pos.y - startPos.y });
    }
  };

  const handleEnd = () => {
    if (activeTool === 'select') {
      if (isDrawing) commitElements([...elements]);
      setIsDrawing(false);
      return;
    }
    if (currentElement) {
      commitElements([...elements, currentElement]);
      setCurrentElement(null);
    }
    setIsDrawing(false);
  };

  const updateSelected = (updates: Partial<PaintElement>) => {
    if (!selectedId) return;
    commitElements(elements.map((el) => (el.id === selectedId ? { ...el, ...updates } : el)));
  };

  const exportPNG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderCanvas(false);
    const link = document.createElement('a');
    link.download = `canvas-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    renderCanvas(true);
  };

  const selectedElement = elements.find((el) => el.id === selectedId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-800">
        <h1 className="text-base font-semibold text-white">Paint</h1>

        <div className="flex items-center gap-2">
          <button
            onClick={undo}
            disabled={historyIndex <= 0}
            className="px-2.5 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 disabled:opacity-30"
          >
            Undo
          </button>
          <button
            onClick={redo}
            disabled={historyIndex >= history.length - 1}
            className="px-2.5 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 disabled:opacity-30"
          >
            Redo
          </button>
          <button
            onClick={() => {
              commitElements([]);
              setSelectedId(null);
            }}
            className="px-2.5 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 hover:text-red-400"
          >
            Clear
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
        {/* Tools */}
        <div className="lg:col-span-1 studio-panel rounded-lg p-1.5 flex flex-row lg:flex-col gap-1 overflow-x-auto no-scrollbar">
          {[
            { id: 'select', icon: 'fa-arrow-pointer', label: 'Select' },
            { id: 'brush', icon: 'fa-paintbrush', label: 'Brush' },
            { id: 'highlighter', icon: 'fa-highlighter', label: 'Marker' },
            { id: 'line', icon: 'fa-minus', label: 'Line' },
            { id: 'arrow', icon: 'fa-arrow-up-right-from-square', label: 'Arrow' },
            { id: 'rect', icon: 'fa-vector-square', label: 'Rect' },
            { id: 'circle', icon: 'fa-circle-dot', label: 'Circle' },
            { id: 'polygon', icon: 'fa-play', label: 'Triangle' },
            { id: 'text', icon: 'fa-font', label: 'Text' },
            { id: 'eyedropper', icon: 'fa-eye-dropper', label: 'Picker' },
            { id: 'eraser', icon: 'fa-eraser', label: 'Eraser' },
          ].map((tool) => (
            <button
              key={tool.id}
              onClick={() => {
                setActiveTool(tool.id as PaintTool);
                if (tool.id !== 'select') setSelectedId(null);
              }}
              className={`w-9 h-9 lg:w-full flex-shrink-0 rounded flex items-center justify-center ${
                activeTool === tool.id
                  ? 'bg-white text-black'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
              }`}
              title={tool.label}
            >
              <i className={`fas ${tool.icon} text-xs`}></i>
            </button>
          ))}
        </div>

        {/* Canvas */}
        <div className="lg:col-span-8 studio-panel rounded-lg overflow-hidden checkerboard touch-none">
          <canvas
            ref={canvasRef}
            width={canvasSize.width}
            height={canvasSize.height}
            onMouseDown={handleStart}
            onMouseMove={handleMove}
            onMouseUp={handleEnd}
            onTouchStart={handleStart}
            onTouchMove={handleMove}
            onTouchEnd={handleEnd}
            className={`w-full h-auto block ${
              activeTool === 'select' ? 'cursor-move' : 'cursor-crosshair'
            }`}
          />
        </div>

        {/* Minimal Inspector */}
        <div className="lg:col-span-3 space-y-3">
          <div className="studio-panel rounded-lg p-3.5 space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-mono uppercase text-zinc-500 mb-1">Stroke</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={selectedElement?.strokeColor || strokeColor}
                    onChange={(e) => {
                      setStrokeColor(e.target.value);
                      updateSelected({ strokeColor: e.target.value });
                    }}
                    className="w-7 h-7 rounded"
                  />
                  <span className="font-mono text-xs text-zinc-300">
                    {selectedElement?.strokeColor || strokeColor}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono uppercase text-zinc-500 mb-1">Fill</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={selectedElement?.fillColor || fillColor}
                    onChange={(e) => {
                      setFillColor(e.target.value);
                      updateSelected({ fillColor: e.target.value });
                    }}
                    className="w-7 h-7 rounded"
                  />
                  <button
                    onClick={() => {
                      const next = !(selectedElement ? selectedElement.filled : filled);
                      setFilled(next);
                      updateSelected({ filled: next });
                    }}
                    className={`px-2 py-1 rounded text-[10px] font-mono border ${
                      (selectedElement ? selectedElement.filled : filled)
                        ? 'bg-white text-black border-white font-semibold'
                        : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                    }`}
                  >
                    {(selectedElement ? selectedElement.filled : filled) ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Size</span>
                <span className="font-mono text-zinc-200">{selectedElement?.strokeWidth || strokeWidth}px</span>
              </div>
              <input
                type="range"
                min="1"
                max="120"
                value={selectedElement?.strokeWidth || strokeWidth}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  setStrokeWidth(v);
                  updateSelected({ strokeWidth: v });
                }}
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Opacity</span>
                <span className="font-mono text-zinc-200">{selectedElement?.opacity ?? opacity}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="100"
                value={selectedElement?.opacity ?? opacity}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  setOpacity(v);
                  updateSelected({ opacity: v });
                }}
              />
            </div>

            <div>
              <label className="block text-[10px] font-mono uppercase text-zinc-500 mb-1">Canvas</label>
              <div className="grid grid-cols-4 gap-1">
                {(
                  [
                    { id: '#09090b', label: 'Dark' },
                    { id: '#000000', label: 'Black' },
                    { id: '#ffffff', label: 'White' },
                    { id: 'transparent', label: 'Alpha' },
                  ] as const
                ).map((bg) => (
                  <button
                    key={bg.id}
                    onClick={() => setBgColor(bg.id)}
                    className={`py-1 rounded text-[10px] font-mono border ${
                      bgColor === bg.id
                        ? 'bg-white text-black border-white font-semibold'
                        : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                    }`}
                  >
                    {bg.label}
                  </button>
                ))}
              </div>
            </div>

            {selectedElement?.type === 'text' && (
              <input
                type="text"
                value={selectedElement.text || ''}
                onChange={(e) => updateSelected({ text: e.target.value })}
                className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-xs text-white focus:outline-none"
                placeholder="Text..."
              />
            )}
          </div>

          {elements.length > 0 && (
            <div className="studio-panel rounded-lg p-3 space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
              {[...elements].reverse().map((el) => (
                <div
                  key={el.id}
                  onClick={() => {
                    setSelectedId(el.id);
                    setActiveTool('select');
                  }}
                  className={`flex items-center justify-between px-2 py-1 rounded text-xs cursor-pointer ${
                    selectedId === el.id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-900'
                  }`}
                >
                  <span className="truncate font-mono text-[11px]">{el.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      commitElements(elements.filter((item) => item.id !== el.id));
                      if (selectedId === el.id) setSelectedId(null);
                    }}
                    className="text-zinc-500 hover:text-red-400 px-1"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PaintPro;
