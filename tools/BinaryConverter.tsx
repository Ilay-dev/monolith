import React, { useState } from 'react';

const BinaryConverter: React.FC = () => {
  const [bytes, setBytes] = useState<number[]>(() =>
    Array.from(new TextEncoder().encode('MONOLITH'))
  );

  const textVal = new TextDecoder().decode(new Uint8Array(bytes));
  const binVal = bytes.map((b) => b.toString(2).padStart(8, '0')).join(' ');
  const hexVal = bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  const decVal = bytes.map((b) => b.toString(10)).join(' ');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
        <h1 className="text-base font-semibold text-white">Binary Tool</h1>
        <button
          onClick={() => setBytes([])}
          className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 hover:text-white"
        >
          Clear
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="studio-panel rounded-lg p-3.5 space-y-2">
          <div className="flex justify-between text-xs font-mono text-zinc-400">
            <span>TEXT</span>
            <button onClick={() => navigator.clipboard.writeText(textVal)} className="hover:text-white">
              Copy
            </button>
          </div>
          <textarea
            value={textVal}
            onChange={(e) => setBytes(Array.from(new TextEncoder().encode(e.target.value)))}
            rows={4}
            placeholder="Text..."
            className="w-full bg-[#070708] border border-zinc-800 rounded p-2.5 text-xs font-mono text-white focus:outline-none resize-none select-text"
          />
        </div>

        <div className="studio-panel rounded-lg p-3.5 space-y-2">
          <div className="flex justify-between text-xs font-mono text-zinc-400">
            <span>BINARY</span>
            <button onClick={() => navigator.clipboard.writeText(binVal)} className="hover:text-white">
              Copy
            </button>
          </div>
          <textarea
            value={binVal}
            onChange={(e) => {
              const tokens = e.target.value.trim().split(/\s+/).filter(Boolean);
              setBytes(tokens.map((t) => parseInt(t.replace(/[^01]/g, '') || '0', 2) & 0xff));
            }}
            rows={4}
            placeholder="01001111..."
            className="w-full bg-[#070708] border border-zinc-800 rounded p-2.5 text-xs font-mono text-zinc-200 focus:outline-none resize-none select-text"
          />
        </div>

        <div className="studio-panel rounded-lg p-3.5 space-y-2">
          <div className="flex justify-between text-xs font-mono text-zinc-400">
            <span>HEX</span>
            <button onClick={() => navigator.clipboard.writeText(hexVal)} className="hover:text-white">
              Copy
            </button>
          </div>
          <textarea
            value={hexVal}
            onChange={(e) => {
              const clean = e.target.value.replace(/[^0-9a-fA-F]/g, '');
              const out: number[] = [];
              for (let i = 0; i < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16) & 0xff);
              setBytes(out);
            }}
            rows={3}
            placeholder="4F 4E 59 58..."
            className="w-full bg-[#070708] border border-zinc-800 rounded p-2.5 text-xs font-mono text-zinc-200 focus:outline-none resize-none select-text"
          />
        </div>

        <div className="studio-panel rounded-lg p-3.5 space-y-2">
          <div className="flex justify-between text-xs font-mono text-zinc-400">
            <span>DECIMAL</span>
            <button onClick={() => navigator.clipboard.writeText(decVal)} className="hover:text-white">
              Copy
            </button>
          </div>
          <textarea
            value={decVal}
            onChange={(e) => {
              const tokens = e.target.value.trim().split(/[\s,]+/).filter(Boolean);
              setBytes(tokens.map((t) => (parseInt(t, 10) || 0) & 0xff));
            }}
            rows={3}
            placeholder="79 78 89 88..."
            className="w-full bg-[#070708] border border-zinc-800 rounded p-2.5 text-xs font-mono text-zinc-200 focus:outline-none resize-none select-text"
          />
        </div>
      </div>
    </div>
  );
};

export default BinaryConverter;
