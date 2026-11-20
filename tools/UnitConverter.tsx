import React, { useState } from 'react';

interface UnitCategory {
  label: string;
  units: Record<string, { name: string; factor?: number }>;
  custom?: (val: number, from: string, to: string) => number;
}

const convertTemp = (v: number, from: string, to: string): number => {
  if (from === to) return v;
  let k = v;
  if (from === 'C') k = v + 273.15;
  else if (from === 'F') k = (v - 32) * (5 / 9) + 273.15;
  if (to === 'K') return k;
  if (to === 'C') return k - 273.15;
  if (to === 'F') return (k - 273.15) * (9 / 5) + 32;
  return k;
};

const CATEGORIES: Record<string, UnitCategory> = {
  length: {
    label: 'Length',
    units: {
      mm: { name: 'mm', factor: 0.001 },
      cm: { name: 'cm', factor: 0.01 },
      m: { name: 'm', factor: 1 },
      km: { name: 'km', factor: 1000 },
      in: { name: 'in', factor: 0.0254 },
      ft: { name: 'ft', factor: 0.3048 },
      yd: { name: 'yd', factor: 0.9144 },
      mi: { name: 'mi', factor: 1609.344 },
    },
  },
  mass: {
    label: 'Mass',
    units: {
      mg: { name: 'mg', factor: 0.001 },
      g: { name: 'g', factor: 1 },
      kg: { name: 'kg', factor: 1000 },
      t: { name: 't', factor: 1e6 },
      oz: { name: 'oz', factor: 28.3495 },
      lb: { name: 'lb', factor: 453.592 },
    },
  },
  temperature: {
    label: 'Temp',
    units: { C: { name: '°C' }, F: { name: '°F' }, K: { name: 'K' } },
    custom: convertTemp,
  },
  data: {
    label: 'Data',
    units: {
      B: { name: 'B', factor: 1 },
      KB: { name: 'KB', factor: 1024 },
      MB: { name: 'MB', factor: 1048576 },
      GB: { name: 'GB', factor: 1073741824 },
      TB: { name: 'TB', factor: 1099511627776 },
    },
  },
  time: {
    label: 'Time',
    units: {
      ms: { name: 'ms', factor: 0.001 },
      s: { name: 's', factor: 1 },
      min: { name: 'min', factor: 60 },
      hr: { name: 'hr', factor: 3600 },
      day: { name: 'day', factor: 86400 },
    },
  },
  volume: {
    label: 'Volume',
    units: {
      ml: { name: 'mL', factor: 0.001 },
      l: { name: 'L', factor: 1 },
      m3: { name: 'm³', factor: 1000 },
      floz: { name: 'fl oz', factor: 0.0295735 },
      cup: { name: 'cup', factor: 0.236588 },
      gal: { name: 'gal', factor: 3.78541 },
    },
  },
  speed: {
    label: 'Speed',
    units: {
      ms: { name: 'm/s', factor: 1 },
      kmh: { name: 'km/h', factor: 0.277778 },
      mph: { name: 'mph', factor: 0.44704 },
      kn: { name: 'knot', factor: 0.514444 },
    },
  },
  area: {
    label: 'Area',
    units: {
      cm2: { name: 'cm²', factor: 0.0001 },
      m2: { name: 'm²', factor: 1 },
      ha: { name: 'ha', factor: 10000 },
      km2: { name: 'km²', factor: 1e6 },
      ft2: { name: 'ft²', factor: 0.092903 },
      ac: { name: 'acre', factor: 4046.86 },
    },
  },
};

const UnitConverter: React.FC = () => {
  const [catKey, setCatKey] = useState('length');
  const [val, setVal] = useState('1');
  const [from, setFrom] = useState('m');

  const cat = CATEGORIES[catKey];
  const num = parseFloat(val) || 0;

  const convert = (to: string) => {
    if (cat.custom) return cat.custom(num, from, to);
    return (num * (cat.units[from]?.factor || 1)) / (cat.units[to]?.factor || 1);
  };

  const fmt = (n: number) => {
    if (!isFinite(n) || n === 0) return '0';
    if (Math.abs(n) < 1e-4 || Math.abs(n) >= 1e8) return n.toExponential(4);
    return Number(n.toPrecision(7)).toString();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-800">
        <h1 className="text-base font-semibold text-white">Unit Converter</h1>
        <div className="flex flex-wrap gap-1 bg-[#0b0b0d] p-1 rounded border border-zinc-800">
          {Object.entries(CATEGORIES).map(([k, c]) => (
            <button
              key={k}
              onClick={() => {
                setCatKey(k);
                setFrom(Object.keys(CATEGORIES[k].units)[0]);
              }}
              className={`px-2.5 py-1 rounded text-xs font-medium ${
                catKey === k ? 'bg-white text-black font-semibold' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="studio-panel rounded-lg p-4 flex flex-col sm:flex-row gap-3">
        <input
          type="number"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className="flex-1 bg-[#070708] border border-zinc-800 rounded p-2.5 text-base font-mono text-white focus:outline-none select-text"
        />
        <select
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="sm:w-36 bg-zinc-900 border border-zinc-800 rounded p-2.5 text-xs font-mono text-white focus:outline-none"
        >
          {Object.entries(cat.units).map(([uKey, uObj]) => (
            <option key={uKey} value={uKey}>
              {uObj.name}
            </option>
          ))}
        </select>
      </div>

      <div key={catKey} className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 tool-view-transition">
        {Object.entries(cat.units).map(([uKey, uObj]) => {
          const res = fmt(convert(uKey));
          return (
            <div
              key={uKey}
              onClick={() => navigator.clipboard.writeText(res)}
              className="studio-panel rounded-lg p-3 cursor-pointer hover:border-zinc-600 transition-colors"
              title="Click to copy"
            >
              <div className="text-[10px] font-mono text-zinc-500 uppercase">{uObj.name}</div>
              <div className="font-mono text-sm font-semibold text-white truncate mt-0.5">{res}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default UnitConverter;
