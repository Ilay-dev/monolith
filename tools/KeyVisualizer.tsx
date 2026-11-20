import React, { useState, useEffect } from 'react';

const KEYBOARD_ROWS: Array<Array<{ code: string; label: string; w?: string }>> = [
  [
    { code: 'Escape', label: 'ESC' }, { code: 'F1', label: 'F1' }, { code: 'F2', label: 'F2' },
    { code: 'F3', label: 'F3' }, { code: 'F4', label: 'F4' }, { code: 'F5', label: 'F5' },
    { code: 'F6', label: 'F6' }, { code: 'F7', label: 'F7' }, { code: 'F8', label: 'F8' },
    { code: 'F9', label: 'F9' }, { code: 'F10', label: 'F10' }, { code: 'F11', label: 'F11' },
    { code: 'F12', label: 'F12' }, { code: 'Delete', label: 'DEL' },
  ],
  [
    { code: 'Backquote', label: '`' }, { code: 'Digit1', label: '1' }, { code: 'Digit2', label: '2' },
    { code: 'Digit3', label: '3' }, { code: 'Digit4', label: '4' }, { code: 'Digit5', label: '5' },
    { code: 'Digit6', label: '6' }, { code: 'Digit7', label: '7' }, { code: 'Digit8', label: '8' },
    { code: 'Digit9', label: '9' }, { code: 'Digit0', label: '0' }, { code: 'Minus', label: '-' },
    { code: 'Equal', label: '=' }, { code: 'Backspace', label: 'BACK', w: 'flex-[2]' },
  ],
  [
    { code: 'Tab', label: 'TAB', w: 'flex-[1.5]' }, { code: 'KeyQ', label: 'Q' }, { code: 'KeyW', label: 'W' },
    { code: 'KeyE', label: 'E' }, { code: 'KeyR', label: 'R' }, { code: 'KeyT', label: 'T' },
    { code: 'KeyY', label: 'Y' }, { code: 'KeyU', label: 'U' }, { code: 'KeyI', label: 'I' },
    { code: 'KeyO', label: 'O' }, { code: 'KeyP', label: 'P' }, { code: 'BracketLeft', label: '[' },
    { code: 'BracketRight', label: ']' }, { code: 'Backslash', label: '\\', w: 'flex-[1.5]' },
  ],
  [
    { code: 'CapsLock', label: 'CAPS', w: 'flex-[1.8]' }, { code: 'KeyA', label: 'A' }, { code: 'KeyS', label: 'S' },
    { code: 'KeyD', label: 'D' }, { code: 'KeyF', label: 'F' }, { code: 'KeyG', label: 'G' },
    { code: 'KeyH', label: 'H' }, { code: 'KeyJ', label: 'J' }, { code: 'KeyK', label: 'K' },
    { code: 'KeyL', label: 'L' }, { code: 'Semicolon', label: ';' }, { code: 'Quote', label: "'" },
    { code: 'Enter', label: 'ENTER', w: 'flex-[2.2]' },
  ],
  [
    { code: 'ShiftLeft', label: 'SHIFT', w: 'flex-[2.3]' }, { code: 'KeyZ', label: 'Z' }, { code: 'KeyX', label: 'X' },
    { code: 'KeyC', label: 'C' }, { code: 'KeyV', label: 'V' }, { code: 'KeyB', label: 'B' },
    { code: 'KeyN', label: 'N' }, { code: 'KeyM', label: 'M' }, { code: 'Comma', label: ',' },
    { code: 'Period', label: '.' }, { code: 'Slash', label: '/' }, { code: 'ShiftRight', label: 'SHIFT', w: 'flex-[2.5]' },
  ],
  [
    { code: 'ControlLeft', label: 'CTRL', w: 'flex-[1.4]' }, { code: 'MetaLeft', label: 'META', w: 'flex-[1.4]' },
    { code: 'AltLeft', label: 'ALT', w: 'flex-[1.4]' }, { code: 'Space', label: 'SPACE', w: 'flex-[6]' },
    { code: 'AltRight', label: 'ALT', w: 'flex-[1.4]' }, { code: 'ControlRight', label: 'CTRL', w: 'flex-[1.4]' },
    { code: 'ArrowLeft', label: '←' }, { code: 'ArrowUp', label: '↑' },
    { code: 'ArrowDown', label: '↓' }, { code: 'ArrowRight', label: '→' },
  ],
];

const KeyVisualizer: React.FC = () => {
  const [pressed, setPressed] = useState<Set<string>>(new Set());
  const [tested, setTested] = useState<Set<string>>(new Set());
  const [last, setLast] = useState<{ key: string; code: string; which: number } | null>(null);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      e.preventDefault();
      setPressed((p) => new Set(p).add(e.code));
      setTested((p) => new Set(p).add(e.code));
      setLast({ key: e.key === ' ' ? 'Space' : e.key, code: e.code, which: e.which || e.keyCode });
    };
    const onUp = (e: KeyboardEvent) => {
      setPressed((p) => {
        const next = new Set(p);
        next.delete(e.code);
        return next;
      });
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
        <h1 className="text-base font-semibold text-white">Key Visual</h1>
        <button
          onClick={() => {
            setTested(new Set());
            setLast(null);
          }}
          className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 hover:text-white"
        >
          Reset
        </button>
      </div>

      {/* Direct Readout Bar */}
      <div className="grid grid-cols-3 gap-3 font-mono text-xs">
        <div className="studio-panel rounded-lg p-3">
          <div className="text-[10px] text-zinc-500">KEY</div>
          <div className="text-lg font-bold text-white mt-0.5">{last?.key || '—'}</div>
        </div>
        <div className="studio-panel rounded-lg p-3">
          <div className="text-[10px] text-zinc-500">CODE</div>
          <div className="text-lg font-bold text-white mt-0.5">{last?.code || '—'}</div>
        </div>
        <div className="studio-panel rounded-lg p-3">
          <div className="text-[10px] text-zinc-500">KEYCODE</div>
          <div className="text-lg font-bold text-white mt-0.5">{last?.which || '—'}</div>
        </div>
      </div>

      {/* Keyboard Matrix */}
      <div className="studio-panel rounded-lg p-3 sm:p-4 overflow-x-auto">
        <div className="min-w-[640px] space-y-1.5">
          {KEYBOARD_ROWS.map((row, idx) => (
            <div key={idx} className="flex gap-1.5">
              {row.map((k) => {
                const isDown = pressed.has(k.code);
                const isHit = tested.has(k.code);
                return (
                  <div
                    key={k.code}
                    className={`${
                      k.w || 'flex-1'
                    } h-10 rounded flex items-center justify-center font-mono text-[11px] border transition-colors ${
                      isDown
                        ? 'bg-[#ff4f00] text-black border-[#ff4f00] font-bold'
                        : isHit
                        ? 'bg-zinc-800 text-white border-zinc-600'
                        : 'bg-[#070708] text-zinc-500 border-zinc-800'
                    }`}
                  >
                    {k.label}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default KeyVisualizer;
