import React, { useState, useRef, useEffect, useCallback } from 'react';

declare const JSZip: any;
declare const mammoth: any;
declare const ImageTracer: any;

interface Mesh3D {
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

function computeNormalsAndBounds(positions: Float32Array, indices: Uint32Array) {
  const normals = new Float32Array(positions.length);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  }
  if (!isFinite(min[0])) {
    min[0] = min[1] = min[2] = 0;
    max[0] = max[1] = max[2] = 0;
  }

  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3, ib = indices[i + 1] * 3, ic = indices[i + 2] * 3;
    const ux = positions[ib] - positions[ia], uy = positions[ib + 1] - positions[ia + 1], uz = positions[ib + 2] - positions[ia + 2];
    const vx = positions[ic] - positions[ia], vy = positions[ic + 1] - positions[ia + 1], vz = positions[ic + 2] - positions[ia + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    normals[ia] += nx; normals[ia + 1] += ny; normals[ia + 2] += nz;
    normals[ib] += nx; normals[ib + 1] += ny; normals[ib + 2] += nz;
    normals[ic] += nx; normals[ic + 1] += ny; normals[ic + 2] += nz;
  }

  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= len; normals[i + 1] /= len; normals[i + 2] /= len;
  }
  return { normals, bounds: { min, max } };
}

function parseOBJ(text: string, name: string): Mesh3D {
  const verts: number[] = [];
  const faces: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'v' && parts.length >= 4) {
      verts.push(parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 0, parseFloat(parts[3]) || 0);
    } else if (parts[0] === 'f' && parts.length >= 4) {
      const poly: number[] = [];
      const vCount = verts.length / 3;
      for (let i = 1; i < parts.length; i++) {
        let idx = parseInt(parts[i].split('/')[0], 10);
        idx = idx < 0 ? vCount + idx : idx - 1;
        if (idx >= 0 && idx < vCount) poly.push(idx);
      }
      for (let i = 1; i < poly.length - 1; i++) faces.push(poly[0], poly[i], poly[i + 1]);
    }
  }
  const positions = new Float32Array(verts);
  const indices = new Uint32Array(faces);
  return { name, positions, indices, ...computeNormalsAndBounds(positions, indices) };
}

function parseSTL(buffer: ArrayBuffer, name: string): Mesh3D {
  const view = new DataView(buffer);
  const headerText = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(256, buffer.byteLength)));
  if (headerText.trim().startsWith('solid') && headerText.includes('facet')) {
    const text = new TextDecoder().decode(buffer);
    const verts: number[] = [], indices: number[] = [];
    const regex = /vertex\s+([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s+([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s+([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      indices.push(verts.length / 3);
      verts.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
    }
    const positions = new Float32Array(verts), idxArr = new Uint32Array(indices);
    return { name, positions, indices: idxArr, ...computeNormalsAndBounds(positions, idxArr) };
  }
  const triCount = view.byteLength >= 84 ? view.getUint32(80, true) : 0;
  const positions = new Float32Array(triCount * 9);
  const indices = new Uint32Array(triCount * 3);
  let offset = 84;
  for (let i = 0; i < triCount; i++) {
    if (offset + 50 > view.byteLength) break;
    offset += 12;
    for (let v = 0; v < 3; v++) {
      const vIdx = i * 3 + v;
      positions[vIdx * 3] = view.getFloat32(offset, true);
      positions[vIdx * 3 + 1] = view.getFloat32(offset + 4, true);
      positions[vIdx * 3 + 2] = view.getFloat32(offset + 8, true);
      indices[vIdx] = vIdx;
      offset += 12;
    }
    offset += 2;
  }
  return { name, positions, indices, ...computeNormalsAndBounds(positions, indices) };
}

function parsePLY(text: string, name: string): Mesh3D {
  const lines = text.split(/\r?\n/);
  let vCount = 0, fCount = 0, lineIdx = 0;
  for (; lineIdx < lines.length; lineIdx++) {
    const l = lines[lineIdx].trim();
    if (l.startsWith('element vertex')) vCount = parseInt(l.split(/\s+/)[2], 10) || 0;
    if (l.startsWith('element face')) fCount = parseInt(l.split(/\s+/)[2], 10) || 0;
    if (l === 'end_header') { lineIdx++; break; }
  }
  const verts: number[] = [], faces: number[] = [];
  for (let i = 0; i < vCount && lineIdx < lines.length; lineIdx++) {
    const l = lines[lineIdx].trim();
    if (!l) continue;
    const p = l.split(/\s+/).map(Number);
    verts.push(p[0] || 0, p[1] || 0, p[2] || 0);
    i++;
  }
  for (let i = 0; i < fCount && lineIdx < lines.length; lineIdx++) {
    const l = lines[lineIdx].trim();
    if (!l) continue;
    const p = l.split(/\s+/).map(Number);
    for (let k = 1; k < p[0] - 1; k++) faces.push(p[1], p[1 + k], p[2 + k]);
    i++;
  }
  const positions = new Float32Array(verts), indices = new Uint32Array(faces);
  return { name, positions, indices, ...computeNormalsAndBounds(positions, indices) };
}

function parseGLTFOrGLB(buffer: ArrayBuffer, name: string): Mesh3D {
  const view = new DataView(buffer);
  let json: any, binBuffer: ArrayBuffer | null = null;

  if (view.getUint32(0, true) === 0x46546c67) {
    let offset = 12;
    while (offset + 8 <= buffer.byteLength) {
      const len = view.getUint32(offset, true);
      const type = view.getUint32(offset + 4, true);
      offset += 8;
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, offset, len)));
      else if (type === 0x004e4942) binBuffer = buffer.slice(offset, offset + len);
      offset += len;
    }
  } else {
    json = JSON.parse(new TextDecoder().decode(buffer));
    const uri = json.buffers?.[0]?.uri;
    if (uri?.startsWith('data:')) {
      const bStr = atob(uri.split(',')[1]);
      const bytes = new Uint8Array(bStr.length);
      for (let i = 0; i < bStr.length; i++) bytes[i] = bStr.charCodeAt(i);
      binBuffer = bytes.buffer;
    }
  }
  if (!json || !binBuffer) throw new Error('Invalid GLB/GLTF buffer');

  const allPositions: number[] = [], allIndices: number[] = [];
  const readAccessor = (accIdx: number) => {
    const acc = json.accessors[accIdx];
    const bv = json.bufferViews[acc.bufferView];
    const byteOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const numComps = acc.type === 'VEC3' ? 3 : acc.type === 'VEC2' ? 2 : acc.type === 'VEC4' ? 4 : 1;
    const compType = acc.componentType;
    const elemSize = compType === 5126 || compType === 5125 ? 4 : compType === 5123 || compType === 5122 ? 2 : 1;
    const step = bv.byteStride || elemSize * numComps;
    const dv = new DataView(binBuffer!);
    const out: number[] = [];
    for (let i = 0; i < acc.count; i++) {
      const base = byteOffset + i * step;
      for (let c = 0; c < numComps; c++) {
        const pos = base + c * elemSize;
        if (compType === 5126) out.push(dv.getFloat32(pos, true));
        else if (compType === 5125) out.push(dv.getUint32(pos, true));
        else if (compType === 5123) out.push(dv.getUint16(pos, true));
        else if (compType === 5121) out.push(dv.getUint8(pos));
        else out.push(0);
      }
    }
    return out;
  };

  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const baseV = allPositions.length / 3;
      if (prim.attributes?.POSITION !== undefined) {
        const posData = readAccessor(prim.attributes.POSITION);
        for (const v of posData) allPositions.push(v);
        if (prim.indices !== undefined) {
          for (const idx of readAccessor(prim.indices)) allIndices.push(baseV + idx);
        } else {
          for (let i = 0; i < posData.length / 3; i++) allIndices.push(baseV + i);
        }
      }
    }
  }
  const positions = new Float32Array(allPositions), indices = new Uint32Array(allIndices);
  return { name, positions, indices, ...computeNormalsAndBounds(positions, indices) };
}

function exportToGLB(mesh: Mesh3D): Blob {
  const posB = mesh.positions.byteLength, normB = mesh.normals.byteLength, idxB = mesh.indices.byteLength;
  const paddedBin = (posB + normB + idxB + 3) & ~3;
  const binChunk = new Uint8Array(paddedBin);
  binChunk.set(new Uint8Array(mesh.positions.buffer, mesh.positions.byteOffset, posB), 0);
  binChunk.set(new Uint8Array(mesh.normals.buffer, mesh.normals.byteOffset, normB), posB);
  binChunk.set(new Uint8Array(mesh.indices.buffer, mesh.indices.byteOffset, idxB), posB + normB);

  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: mesh.name }],
    meshes: [{ name: mesh.name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, mode: 4 }] }],
    buffers: [{ byteLength: paddedBin }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posB, target: 34962 },
      { buffer: 0, byteOffset: posB, byteLength: normB, target: 34962 },
      { buffer: 0, byteOffset: posB + normB, byteLength: idxB, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, byteOffset: 0, componentType: 5126, count: mesh.positions.length / 3, type: 'VEC3', min: mesh.bounds.min, max: mesh.bounds.max },
      { bufferView: 1, byteOffset: 0, componentType: 5126, count: mesh.normals.length / 3, type: 'VEC3' },
      { bufferView: 2, byteOffset: 0, componentType: 5125, count: mesh.indices.length, type: 'SCALAR' },
    ],
  };

  const jb = new TextEncoder().encode(JSON.stringify(gltf));
  const paddedJson = (jb.byteLength + 3) & ~3;
  const jsonChunk = new Uint8Array(paddedJson).fill(0x20);
  jsonChunk.set(jb);

  const total = 12 + 8 + paddedJson + 8 + paddedBin;
  const glb = new ArrayBuffer(total);
  const dv = new DataView(glb);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, paddedJson, true);
  dv.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(glb, 20, paddedJson).set(jsonChunk);
  const binOff = 20 + paddedJson;
  dv.setUint32(binOff, paddedBin, true);
  dv.setUint32(binOff + 4, 0x004e4942, true);
  new Uint8Array(glb, binOff + 8, paddedBin).set(binChunk);
  return new Blob([glb], { type: 'model/gltf-binary' });
}

function exportToOBJ(mesh: Mesh3D): Blob {
  const lines = [`o ${mesh.name}`];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    lines.push(`v ${mesh.positions[i].toFixed(5)} ${mesh.positions[i + 1].toFixed(5)} ${mesh.positions[i + 2].toFixed(5)}`);
  }
  for (let i = 0; i < mesh.indices.length; i += 3) {
    lines.push(`f ${mesh.indices[i] + 1} ${mesh.indices[i + 1] + 1} ${mesh.indices[i + 2] + 1}`);
  }
  return new Blob([lines.join('\n')], { type: 'text/plain' });
}

function exportToSTL(mesh: Mesh3D): Blob {
  const triCount = Math.floor(mesh.indices.length / 3);
  const buf = new ArrayBuffer(84 + triCount * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, triCount, true);
  let off = 84;
  for (let i = 0; i < triCount; i++) {
    const ia = mesh.indices[i * 3] * 3, ib = mesh.indices[i * 3 + 1] * 3, ic = mesh.indices[i * 3 + 2] * 3;
    dv.setFloat32(off, mesh.normals[ia], true);
    dv.setFloat32(off + 4, mesh.normals[ia + 1], true);
    dv.setFloat32(off + 8, mesh.normals[ia + 2], true);
    off += 12;
    for (const idx of [ia, ib, ic]) {
      dv.setFloat32(off, mesh.positions[idx], true);
      dv.setFloat32(off + 4, mesh.positions[idx + 1], true);
      dv.setFloat32(off + 8, mesh.positions[idx + 2], true);
      off += 12;
    }
    off += 2;
  }
  return new Blob([buf], { type: 'application/sla' });
}

function exportToPLY(mesh: Mesh3D): Blob {
  const vCount = mesh.positions.length / 3, fCount = Math.floor(mesh.indices.length / 3);
  const lines = [
    'ply', 'format ascii 1.0', `element vertex ${vCount}`,
    'property float x', 'property float y', 'property float z',
    `element face ${fCount}`, 'property list uchar int vertex_indices', 'end_header',
  ];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    lines.push(`${mesh.positions[i].toFixed(5)} ${mesh.positions[i + 1].toFixed(5)} ${mesh.positions[i + 2].toFixed(5)}`);
  }
  for (let i = 0; i < mesh.indices.length; i += 3) {
    lines.push(`3 ${mesh.indices[i]} ${mesh.indices[i + 1]} ${mesh.indices[i + 2]}`);
  }
  return new Blob([lines.join('\n')], { type: 'text/plain' });
}

function parseDataInput(text: string): any[] {
  const t = text.trim();
  if (!t) return [];
  if (t.startsWith('[') || t.startsWith('{')) {
    const p = JSON.parse(t);
    return Array.isArray(p) ? p : [p];
  }
  const sep = t.includes('\t') ? '\t' : ',';
  const lines = t.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [{ value: t }];
  const headers = lines[0].split(sep).map((h) => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((l) => {
    const cols = l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
    const obj: Record<string, any> = {};
    headers.forEach((h, i) => {
      const v = cols[i] ?? '';
      obj[h] = v !== '' && !isNaN(Number(v)) ? Number(v) : v;
    });
    return obj;
  });
}

function formatDataRecords(records: any[], target: 'csv' | 'json' | 'yaml' | 'xml' | 'sql' | 'md'): string {
  if (records.length === 0) return '';
  const keys = Array.from(new Set(records.flatMap((r) => Object.keys(r))));
  if (target === 'json') return JSON.stringify(records, null, 2);
  if (target === 'csv') {
    return [keys.join(','), ...records.map((r) => keys.map((k) => String(r[k] ?? '')).join(','))].join('\n');
  }
  if (target === 'yaml') {
    return records.map((r) => keys.map((k, i) => `${i === 0 ? '- ' : '  '}${k}: ${JSON.stringify(r[k] ?? '')}`).join('\n')).join('\n');
  }
  if (target === 'xml') {
    return `<dataset>\n${records.map((r) => `  <item>\n${keys.map((k) => `    <${k}>${r[k] ?? ''}</${k}>`).join('\n')}\n  </item>`).join('\n')}\n</dataset>`;
  }
  if (target === 'sql') {
    const cols = keys.join(', ');
    return records.map((r) => `INSERT INTO data (${cols}) VALUES (${keys.map((k) => (typeof r[k] === 'number' ? r[k] : `'${String(r[k] ?? '')}'`)).join(', ')});`).join('\n');
  }
  return [
    `| ${keys.join(' | ')} |`,
    `| ${keys.map(() => '---').join(' | ')} |`,
    ...records.map((r) => `| ${keys.map((k) => String(r[k] ?? '')).join(' | ')} |`),
  ].join('\n');
}

type ConverterMode = '3d' | 'image' | 'audio' | 'data' | 'document';

const OfficeConverter: React.FC = () => {
  const [mode, setMode] = useState<ConverterMode>('3d');

  // 3D
  const [mesh, setMesh] = useState<Mesh3D | null>(null);
  const [target3D, setTarget3D] = useState<'glb' | 'obj' | 'stl' | 'ply'>('glb');
  const [rot3D, setRot3D] = useState({ x: 0.4, y: 0.6 });
  const isDragging3D = useRef(false);
  const lastMouse3D = useRef({ x: 0, y: 0 });
  const canvas3DRef = useRef<HTMLCanvasElement>(null);
  const file3DRef = useRef<HTMLInputElement>(null);

  // Image
  const [imgFiles, setImgFiles] = useState<File[]>([]);
  const [targetImg, setTargetImg] = useState<'webp' | 'png' | 'jpeg' | 'svg' | 'ico' | 'pdf'>('webp');
  const fileImgRef = useRef<HTMLInputElement>(null);

  // Audio
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [targetAudio, setTargetAudio] = useState<'wav16' | 'wav32' | 'mono'>('wav16');
  const fileAudioRef = useRef<HTMLInputElement>(null);

  // Data
  const [dataInput, setDataInput] = useState('[{"id":1,"name":"Item A"},{"id":2,"name":"Item B"}]');
  const [targetData, setTargetData] = useState<'csv' | 'json' | 'yaml' | 'xml' | 'sql' | 'md'>('csv');
  const [dataOutput, setDataOutput] = useState('');

  // Docs
  const [docFiles, setDocFiles] = useState<File[]>([]);
  const [targetDoc, setTargetDoc] = useState<'pdf' | 'txt' | 'html' | 'zip'>('pdf');
  const fileDocRef = useRef<HTMLInputElement>(null);

  const render3D = useCallback(() => {
    const canvas = canvas3DRef.current;
    if (!canvas || !mesh) return;
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = '#070708';
    ctx.fillRect(0, 0, w, h);

    const pos = mesh.positions, idx = mesh.indices;
    if (pos.length === 0) return;

    const cx = (mesh.bounds.min[0] + mesh.bounds.max[0]) / 2;
    const cy = (mesh.bounds.min[1] + mesh.bounds.max[1]) / 2;
    const cz = (mesh.bounds.min[2] + mesh.bounds.max[2]) / 2;
    const span = Math.max(mesh.bounds.max[0] - mesh.bounds.min[0], mesh.bounds.max[1] - mesh.bounds.min[1], mesh.bounds.max[2] - mesh.bounds.min[2]) || 1;
    const sc = (Math.min(w, h) * 0.36) / span;
    const cosX = Math.cos(rot3D.x), sinX = Math.sin(rot3D.x), cosY = Math.cos(rot3D.y), sinY = Math.sin(rot3D.y);

    const vCount = pos.length / 3;
    const px = new Float32Array(vCount), py = new Float32Array(vCount);
    for (let i = 0; i < vCount; i++) {
      const x0 = (pos[i * 3] - cx) * sc, y0 = (pos[i * 3 + 1] - cy) * sc, z0 = (pos[i * 3 + 2] - cz) * sc;
      const x1 = x0 * cosY - z0 * sinY, z1 = x0 * sinY + z0 * cosY;
      const y2 = y0 * cosX - z1 * sinX, z2 = y0 * sinX + z1 * cosX;
      const fov = 500 / (500 + z2 * 0.4);
      px[i] = w / 2 + x1 * fov;
      py[i] = h / 2 - y2 * fov;
    }

    const step = Math.max(1, Math.floor(idx.length / 3 / 3000)) * 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = 0; i < idx.length; i += step) {
      const a = idx[i], b = idx[i + 1], c = idx[i + 2];
      ctx.moveTo(px[a], py[a]);
      ctx.lineTo(px[b], py[b]);
      ctx.lineTo(px[c], py[c]);
      ctx.closePath();
    }
    ctx.stroke();
  }, [mesh, rot3D]);

  useEffect(() => {
    if (mode === '3d' && mesh) render3D();
  }, [mode, mesh, render3D]);

  useEffect(() => {
    try {
      setDataOutput(formatDataRecords(parseDataInput(dataInput), targetData));
    } catch {
      setDataOutput('Invalid input format');
    }
  }, [dataInput, targetData]);

  const handle3DFile = async (file?: File) => {
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const base = file.name.replace(/\.[^/.]+$/, '');
    try {
      if (ext === 'glb' || ext === 'gltf') setMesh(parseGLTFOrGLB(await file.arrayBuffer(), base));
      else if (ext === 'obj') setMesh(parseOBJ(await file.text(), base));
      else if (ext === 'stl') setMesh(parseSTL(await file.arrayBuffer(), base));
      else if (ext === 'ply') setMesh(parsePLY(await file.text(), base));
    } catch {}
  };

  const export3D = () => {
    if (!mesh) return;
    const blob =
      target3D === 'glb'
        ? exportToGLB(mesh)
        : target3D === 'obj'
        ? exportToOBJ(mesh)
        : target3D === 'stl'
        ? exportToSTL(mesh)
        : exportToPLY(mesh);
    const link = document.createElement('a');
    link.download = `${mesh.name}.${target3D}`;
    link.href = URL.createObjectURL(blob);
    link.click();
  };

  const convertImages = async () => {
    if (imgFiles.length === 0) return;
    const jsPDF = (window as any).jspdf?.jsPDF;

    if (targetImg === 'pdf' && jsPDF) {
      const pdf = new jsPDF();
      for (let i = 0; i < imgFiles.length; i++) {
        if (i > 0) pdf.addPage();
        const img = await new Promise<HTMLImageElement>((res) => {
          const el = new Image();
          el.onload = () => res(el);
          el.src = URL.createObjectURL(imgFiles[i]);
        });
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d')!.drawImage(img, 0, 0);
        pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 10, 10, 190, Math.min(270, (190 * img.naturalHeight) / img.naturalWidth));
      }
      pdf.save(`converted-${Date.now()}.pdf`);
      return;
    }

    for (const file of imgFiles) {
      const base = file.name.replace(/\.[^/.]+$/, '');
      const img = await new Promise<HTMLImageElement>((res) => {
        const el = new Image();
        el.onload = () => res(el);
        el.src = URL.createObjectURL(file);
      });
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d')!.drawImage(img, 0, 0);

      if (targetImg === 'svg' && typeof ImageTracer !== 'undefined') {
        ImageTracer.imageToSVG(c.toDataURL('image/png'), (svg: string) => {
          const link = document.createElement('a');
          link.download = `${base}.svg`;
          link.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
          link.click();
        });
      } else {
        const link = document.createElement('a');
        link.download = `${base}.${targetImg === 'jpeg' ? 'jpg' : targetImg}`;
        link.href = c.toDataURL(`image/${targetImg === 'ico' ? 'png' : targetImg}`, 0.92);
        link.click();
      }
    }
  };

  const convertAudio = async () => {
    if (!audioFile) return;
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const decoded = await ctx.decodeAudioData(await audioFile.arrayBuffer());
    const outCh = targetAudio === 'mono' ? 1 : decoded.numberOfChannels;
    const sr = 44100;
    const offline = new OfflineAudioContext(outCh, Math.ceil(decoded.duration * sr), sr);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start(0);
    const rendered = await offline.startRendering();

    const isFloat = targetAudio === 'wav32';
    const bps = isFloat ? 4 : 2;
    const dataLen = rendered.length * outCh * bps;
    const buf = new ArrayBuffer(44 + dataLen);
    const dv = new DataView(buf);
    const wStr = (p: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(p + i, s.charCodeAt(i)); };

    wStr(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); wStr(8, 'WAVE'); wStr(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, isFloat ? 3 : 1, true); dv.setUint16(22, outCh, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * outCh * bps, true);
    dv.setUint16(32, outCh * bps, true); dv.setUint16(34, bps * 8, true); wStr(36, 'data'); dv.setUint32(40, dataLen, true);

    let off = 44;
    for (let i = 0; i < rendered.length; i++) {
      for (let c = 0; c < outCh; c++) {
        const s = Math.max(-1, Math.min(1, rendered.getChannelData(c)[i]));
        if (isFloat) { dv.setFloat32(off, s, true); off += 4; }
        else { dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); off += 2; }
      }
    }
    const link = document.createElement('a');
    link.download = `${audioFile.name.replace(/\.[^/.]+$/, '')}.wav`;
    link.href = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    link.click();
  };

  const convertDocs = async () => {
    if (docFiles.length === 0) return;
    if (targetDoc === 'zip' && typeof JSZip !== 'undefined') {
      const zip = new JSZip();
      for (const f of docFiles) zip.file(f.name, await f.arrayBuffer());
      const blob = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.download = `archive-${Date.now()}.zip`;
      link.href = URL.createObjectURL(blob);
      link.click();
      return;
    }

    const jsPDF = (window as any).jspdf?.jsPDF;
    const pdf = targetDoc === 'pdf' && jsPDF ? new jsPDF() : null;

    for (let i = 0; i < docFiles.length; i++) {
      const f = docFiles[i];
      const base = f.name.replace(/\.[^/.]+$/, '');
      const text =
        f.name.endsWith('.docx') && typeof mammoth !== 'undefined'
          ? (await mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() })).value
          : await f.text();

      if (targetDoc === 'pdf' && pdf) {
        if (i > 0) pdf.addPage();
        pdf.setFontSize(11);
        pdf.text(pdf.splitTextToSize(text, 180), 14, 20);
      } else {
        const out = targetDoc === 'html' ? `<pre>${text}</pre>` : text;
        const link = document.createElement('a');
        link.download = `${base}.${targetDoc}`;
        link.href = URL.createObjectURL(new Blob([out], { type: 'text/plain' }));
        link.click();
      }
    }
    if (targetDoc === 'pdf' && pdf) pdf.save(`documents-${Date.now()}.pdf`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-800">
        <h1 className="text-base font-semibold text-white">File Converter</h1>

        <div className="flex flex-wrap gap-1 bg-[#0b0b0d] p-1 rounded border border-zinc-800">
          {[
            { id: '3d', label: '3D (GLB/OBJ/STL)' },
            { id: 'image', label: 'Images' },
            { id: 'audio', label: 'Audio' },
            { id: 'data', label: 'Data' },
            { id: 'document', label: 'Docs & ZIP' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setMode(t.id as ConverterMode)}
              className={`px-2.5 py-1 rounded text-xs font-medium ${
                mode === t.id ? 'bg-white text-black font-semibold' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {mode === '3d' && (
        <div key="3d" className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start tool-view-transition">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handle3DFile(e.dataTransfer.files?.[0]);
            }}
            className="lg:col-span-8 studio-panel rounded-lg overflow-hidden min-h-[380px] flex items-center justify-center bg-[#070708]"
          >
            {mesh ? (
              <canvas
                ref={canvas3DRef}
                width={680}
                height={380}
                onMouseDown={(e) => {
                  isDragging3D.current = true;
                  lastMouse3D.current = { x: e.clientX, y: e.clientY };
                }}
                onMouseMove={(e) => {
                  if (!isDragging3D.current) return;
                  const dx = e.clientX - lastMouse3D.current.x;
                  const dy = e.clientY - lastMouse3D.current.y;
                  lastMouse3D.current = { x: e.clientX, y: e.clientY };
                  setRot3D((p) => ({ x: p.x + dy * 0.01, y: p.y + dx * 0.01 }));
                }}
                onMouseUp={() => { isDragging3D.current = false; }}
                className="w-full h-[380px] cursor-grab block"
              />
            ) : (
              <button
                onClick={() => file3DRef.current?.click()}
                className="text-center p-8 text-xs text-zinc-500 hover:text-zinc-300"
              >
                <i className="fas fa-cube block text-lg mb-2"></i>
                Drop .GLB, .GLTF, .OBJ, .STL or .PLY file
              </button>
            )}
            <input
              ref={file3DRef}
              type="file"
              accept=".glb,.gltf,.obj,.stl,.ply"
              onChange={(e) => handle3DFile(e.target.files?.[0])}
              className="hidden"
            />
          </div>

          <div className="lg:col-span-4 studio-panel rounded-lg p-4 space-y-4">
            <button
              onClick={() => file3DRef.current?.click()}
              className="w-full py-2 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200"
            >
              Select 3D File
            </button>

            {mesh && (
              <div className="font-mono text-xs text-zinc-400 flex justify-between">
                <span className="truncate text-white">{mesh.name}</span>
                <span>{Math.floor(mesh.indices.length / 3)} tris</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-1.5">
              {(['glb', 'obj', 'stl', 'ply'] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setTarget3D(fmt)}
                  className={`py-2 rounded border text-xs font-mono uppercase ${
                    target3D === fmt ? 'bg-white text-black border-white font-semibold' : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                  }`}
                >
                  .{fmt}
                </button>
              ))}
            </div>

            <button
              onClick={export3D}
              disabled={!mesh}
              className="w-full py-2 rounded bg-white hover:bg-zinc-200 text-black font-semibold text-xs disabled:opacity-30"
            >
              Export .{target3D.toUpperCase()}
            </button>
          </div>
        </div>
      )}

      {mode === 'image' && (
        <div key="image" className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start tool-view-transition">
          <div
            onClick={() => fileImgRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files) setImgFiles(Array.from(e.dataTransfer.files));
            }}
            className="lg:col-span-8 studio-panel rounded-lg p-12 text-center cursor-pointer text-xs text-zinc-500 hover:text-zinc-300"
          >
            <i className="fas fa-image block text-lg mb-2"></i>
            {imgFiles.length > 0 ? `${imgFiles.length} image(s) selected` : 'Drop images or click to select'}
            <input
              ref={fileImgRef}
              type="file"
              multiple
              accept="image/*"
              onChange={(e) => e.target.files && setImgFiles(Array.from(e.target.files))}
              className="hidden"
            />
          </div>

          <div className="lg:col-span-4 studio-panel rounded-lg p-4 space-y-4">
            <div className="grid grid-cols-3 gap-1.5">
              {(['webp', 'png', 'jpeg', 'svg', 'ico', 'pdf'] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setTargetImg(fmt)}
                  className={`py-2 rounded border text-xs font-mono uppercase ${
                    targetImg === fmt ? 'bg-white text-black border-white font-semibold' : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                  }`}
                >
                  .{fmt}
                </button>
              ))}
            </div>
            <button
              onClick={convertImages}
              disabled={imgFiles.length === 0}
              className="w-full py-2 rounded bg-white hover:bg-zinc-200 text-black font-semibold text-xs disabled:opacity-30"
            >
              Convert to .{targetImg.toUpperCase()}
            </button>
          </div>
        </div>
      )}

      {mode === 'audio' && (
        <div key="audio" className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start tool-view-transition">
          <div
            onClick={() => fileAudioRef.current?.click()}
            className="lg:col-span-8 studio-panel rounded-lg p-12 text-center cursor-pointer text-xs text-zinc-500 hover:text-zinc-300"
          >
            <i className="fas fa-wave-square block text-lg mb-2"></i>
            {audioFile ? audioFile.name : 'Click to select audio file (MP3, WAV, FLAC, OGG, M4A)'}
            <input
              ref={fileAudioRef}
              type="file"
              accept="audio/*"
              onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
              className="hidden"
            />
          </div>

          <div className="lg:col-span-4 studio-panel rounded-lg p-4 space-y-4">
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { id: 'wav16', label: '16-Bit' },
                { id: 'wav32', label: '32-Bit' },
                { id: 'mono', label: 'Mono' },
              ].map((fmt) => (
                <button
                  key={fmt.id}
                  onClick={() => setTargetAudio(fmt.id as any)}
                  className={`py-2 rounded border text-xs font-mono ${
                    targetAudio === fmt.id ? 'bg-white text-black border-white font-semibold' : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                  }`}
                >
                  {fmt.label}
                </button>
              ))}
            </div>
            <button
              onClick={convertAudio}
              disabled={!audioFile}
              className="w-full py-2 rounded bg-white hover:bg-zinc-200 text-black font-semibold text-xs disabled:opacity-30"
            >
              Convert to WAV
            </button>
          </div>
        </div>
      )}

      {mode === 'data' && (
        <div key="data" className="grid grid-cols-1 lg:grid-cols-2 gap-4 tool-view-transition">
          <div className="studio-panel rounded-lg p-3 space-y-2">
            <div className="text-xs font-mono text-zinc-400">Input (JSON / CSV)</div>
            <textarea
              value={dataInput}
              onChange={(e) => setDataInput(e.target.value)}
              className="w-full h-72 bg-[#070708] border border-zinc-800 rounded p-3 font-mono text-xs text-zinc-200 focus:outline-none resize-none select-text"
            />
          </div>

          <div className="studio-panel rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex gap-1">
                {(['csv', 'json', 'yaml', 'xml', 'sql', 'md'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => setTargetData(fmt)}
                    className={`px-2 py-0.5 rounded text-[11px] font-mono uppercase border ${
                      targetData === fmt ? 'bg-white text-black border-white font-semibold' : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
              <button
                onClick={() => navigator.clipboard.writeText(dataOutput)}
                className="text-xs font-mono text-zinc-400 hover:text-white"
              >
                Copy
              </button>
            </div>
            <textarea
              readOnly
              value={dataOutput}
              className="w-full h-72 bg-[#070708] border border-zinc-800 rounded p-3 font-mono text-xs text-zinc-300 focus:outline-none resize-none select-text"
            />
          </div>
        </div>
      )}

      {mode === 'document' && (
        <div key="document" className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start tool-view-transition">
          <div
            onClick={() => fileDocRef.current?.click()}
            className="lg:col-span-8 studio-panel rounded-lg p-12 text-center cursor-pointer text-xs text-zinc-500 hover:text-zinc-300"
          >
            <i className="fas fa-file-lines block text-lg mb-2"></i>
            {docFiles.length > 0 ? `${docFiles.length} file(s) selected` : 'Select DOCX, TXT, MD or HTML files'}
            <input
              ref={fileDocRef}
              type="file"
              multiple
              onChange={(e) => e.target.files && setDocFiles(Array.from(e.target.files))}
              className="hidden"
            />
          </div>

          <div className="lg:col-span-4 studio-panel rounded-lg p-4 space-y-4">
            <div className="grid grid-cols-2 gap-1.5">
              {(['pdf', 'txt', 'html', 'zip'] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setTargetDoc(fmt)}
                  className={`py-2 rounded border text-xs font-mono uppercase ${
                    targetDoc === fmt ? 'bg-white text-black border-white font-semibold' : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                  }`}
                >
                  .{fmt}
                </button>
              ))}
            </div>
            <button
              onClick={convertDocs}
              disabled={docFiles.length === 0}
              className="w-full py-2 rounded bg-white hover:bg-zinc-200 text-black font-semibold text-xs disabled:opacity-30"
            >
              Export .{targetDoc.toUpperCase()}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default OfficeConverter;
