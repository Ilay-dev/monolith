import React, { useState, useRef, useEffect, useCallback } from 'react';

declare const JSZip: any;

interface CompressedItem {
  id: string;
  name: string;
  originalUrl: string;
  originalSize: number;
  outUrl: string;
  outBlob: Blob | null;
  outSize: number;
  outWidth: number;
  outHeight: number;
}

const ImageCompressor: React.FC = () => {
  const [items, setItems] = useState<CompressedItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [quality, setQuality] = useState(0.8);
  const [scale, setScale] = useState(100);
  const [format, setFormat] = useState<'image/webp' | 'image/jpeg' | 'image/png'>('image/webp');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const compressSingle = useCallback(
    async (item: CompressedItem, q: number, s: number, fmt: string): Promise<CompressedItem> =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const w = Math.max(1, Math.round(img.naturalWidth * (s / 100)));
          const h = Math.max(1, Math.round(img.naturalHeight * (s / 100)));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d')!;
          if (fmt === 'image/jpeg') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
          }
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(
            (blob) => {
              resolve({
                ...item,
                outUrl: blob ? URL.createObjectURL(blob) : item.originalUrl,
                outBlob: blob,
                outSize: blob ? blob.size : item.originalSize,
                outWidth: w,
                outHeight: h,
              });
            },
            fmt,
            q
          );
        };
        img.src = item.originalUrl;
      }),
    []
  );

  const reprocessAll = useCallback(
    async (list: CompressedItem[], q: number, s: number, fmt: string) => {
      if (list.length === 0) return;
      const updated: CompressedItem[] = [];
      for (const it of list) {
        updated.push(await compressSingle(it, q, s, fmt));
      }
      setItems(updated);
    },
    [compressSingle]
  );

  useEffect(() => {
    if (items.length > 0) {
      const t = setTimeout(() => reprocessAll(items, quality, scale, format), 100);
      return () => clearTimeout(t);
    }
  }, [quality, scale, format]);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList) return;
    const raw: CompressedItem[] = Array.from(fileList)
      .filter((f) => f.type.startsWith('image/'))
      .map((f) => ({
        id: Math.random().toString(36).slice(2, 8),
        name: f.name,
        originalUrl: URL.createObjectURL(f),
        originalSize: f.size,
        outUrl: '',
        outBlob: null,
        outSize: f.size,
        outWidth: 0,
        outHeight: 0,
      }));
    if (raw.length === 0) return;
    if (!activeId) setActiveId(raw[0].id);
    await reprocessAll([...items, ...raw], quality, scale, format);
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const i = Math.min(2, Math.floor(Math.log(bytes) / Math.log(1024)));
    return parseFloat((bytes / Math.pow(1024, i)).toFixed(1)) + ' ' + ['B', 'KB', 'MB'][i];
  };

  const ext = format === 'image/webp' ? 'webp' : format === 'image/png' ? 'png' : 'jpg';

  const downloadSingle = (item: CompressedItem) => {
    const link = document.createElement('a');
    link.download = `${item.name.replace(/\.[^/.]+$/, '')}-min.${ext}`;
    link.href = item.outUrl;
    link.click();
  };

  const downloadAll = async () => {
    if (items.length === 1 || typeof JSZip === 'undefined') {
      items.forEach(downloadSingle);
      return;
    }
    const zip = new JSZip();
    items.forEach((it) => {
      if (it.outBlob) zip.file(`${it.name.replace(/\.[^/.]+$/, '')}-min.${ext}`, it.outBlob);
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.download = `compressed-${Date.now()}.zip`;
    link.href = URL.createObjectURL(blob);
    link.click();
  };

  const totalOrig = items.reduce((a, i) => a + i.originalSize, 0);
  const totalOut = items.reduce((a, i) => a + i.outSize, 0);
  const savedPct = totalOrig > 0 ? Math.round((1 - totalOut / totalOrig) * 100) : 0;
  const activeItem = items.find((i) => i.id === activeId) || items[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-white">Size Reducer</h1>
          {items.length > 0 && (
            <span className="font-mono text-xs text-zinc-400">
              {formatSize(totalOrig)} → <span className="text-white">{formatSize(totalOut)}</span> (
              {savedPct > 0 ? `-${savedPct}%` : '0%'})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200"
          >
            Add Images
          </button>
          {items.length > 0 && (
            <>
              <button
                onClick={() => setItems([])}
                className="px-2.5 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 hover:text-red-400"
              >
                Clear
              </button>
              <button
                onClick={downloadAll}
                className="px-3.5 py-1.5 rounded bg-white hover:bg-zinc-200 text-black text-xs font-semibold"
              >
                Export {items.length > 1 ? `ZIP (${items.length})` : ''}
              </button>
            </>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        onChange={(e) => handleFiles(e.target.files)}
        className="hidden"
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-4 space-y-3">
          <div className="studio-panel rounded-lg p-4 space-y-4">
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { id: 'image/webp', label: 'WebP' },
                { id: 'image/jpeg', label: 'JPEG' },
                { id: 'image/png', label: 'PNG' },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFormat(f.id as any)}
                  className={`py-1.5 rounded text-xs font-mono border ${
                    format === f.id
                      ? 'bg-white text-black border-white font-semibold'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {format !== 'image/png' && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-400">Quality</span>
                  <span className="font-mono text-zinc-200">{Math.round(quality * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="1"
                  step="0.01"
                  value={quality}
                  onChange={(e) => setQuality(parseFloat(e.target.value))}
                />
              </div>
            )}

            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Scale</span>
                <span className="font-mono text-zinc-200">{scale}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="100"
                step="5"
                value={scale}
                onChange={(e) => setScale(parseInt(e.target.value))}
              />
            </div>
          </div>

          {items.length > 0 && (
            <div className="studio-panel rounded-lg p-2.5 space-y-1 max-h-64 overflow-y-auto custom-scrollbar">
              {items.map((item) => (
                <div
                  key={item.id}
                  onClick={() => setActiveId(item.id)}
                  className={`flex items-center justify-between px-2.5 py-1.5 rounded text-xs cursor-pointer ${
                    activeItem?.id === item.id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-900'
                  }`}
                >
                  <span className="truncate pr-2">{item.name}</span>
                  <span className="font-mono text-[11px] flex-shrink-0">{formatSize(item.outSize)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFiles(e.dataTransfer.files);
          }}
          className="lg:col-span-8 studio-panel rounded-lg checkerboard min-h-[380px] flex items-center justify-center p-4"
        >
          {activeItem ? (
            <div className="text-center space-y-2">
              <img
                src={activeItem.outUrl}
                alt="Preview"
                className="max-h-[56vh] object-contain rounded border border-zinc-800 mx-auto"
              />
              <div className="font-mono text-[11px] text-zinc-400">
                {activeItem.outWidth}×{activeItem.outHeight}px • {formatSize(activeItem.originalSize)} →{' '}
                {formatSize(activeItem.outSize)}
              </div>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-center p-8 text-xs text-zinc-500 hover:text-zinc-300"
            >
              <i className="fas fa-plus block text-lg mb-2"></i>
              Drop images or click to add
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImageCompressor;
