export type ToolId =
  | 'image'
  | 'video'
  | 'paint-pro'
  | 'compress'
  | 'audio-mixer'
  | 'office-editor'
  | 'office-converter'
  | 'binary'
  | 'key'
  | 'audio'
  | 'spectrogram'
  | 'qr'
  | 'metadata'
  | 'units';

export interface ToolDefinition {
  id: ToolId;
  name: string;
  shortName: string;
  icon: string;
  category: 'Media' | 'Documents' | 'System';
  tags: string[];
}

export const TOOLS: ToolDefinition[] = [
  {
    id: 'image',
    name: 'Image Studio',
    shortName: 'Image',
    icon: 'fa-sliders',
    category: 'Media',
    tags: ['image', 'photo', 'filter', 'crop', 'color'],
  },
  {
    id: 'video',
    name: 'Video Editor',
    shortName: 'Video',
    icon: 'fa-film',
    category: 'Media',
    tags: ['video', 'cut', 'trim', 'transition', 'audio', 'fade', 'timeline'],
  },
  {
    id: 'paint-pro',
    name: 'Paint',
    shortName: 'Paint',
    icon: 'fa-pen-nib',
    category: 'Media',
    tags: ['paint', 'draw', 'canvas', 'vector', 'brush'],
  },
  {
    id: 'compress',
    name: 'Size Reducer',
    shortName: 'Compress',
    icon: 'fa-compress',
    category: 'Media',
    tags: ['compress', 'size', 'reduce', 'webp', 'jpeg'],
  },
  {
    id: 'audio-mixer',
    name: 'Audio Mixer',
    shortName: 'Mixer',
    icon: 'fa-wave-square',
    category: 'Media',
    tags: ['audio', 'mixer', 'daw', 'eq', 'wav'],
  },
  {
    id: 'office-editor',
    name: 'PDF Editor',
    shortName: 'PDF',
    icon: 'fa-file-pdf',
    category: 'Documents',
    tags: ['pdf', 'editor', 'document', 'docx', 'sign'],
  },
  {
    id: 'office-converter',
    name: 'File Converter',
    shortName: 'Convert',
    icon: 'fa-arrows-rotate',
    category: 'Documents',
    tags: ['convert', 'glb', 'gltf', 'obj', 'stl', 'ply', '3d', 'pdf', 'csv', 'json', 'wav', 'svg'],
  },
  {
    id: 'binary',
    name: 'Binary Tool',
    shortName: 'Binary',
    icon: 'fa-terminal',
    category: 'System',
    tags: ['binary', 'hex', 'ascii', 'octal', 'bytes'],
  },
  {
    id: 'key',
    name: 'Key Visual',
    shortName: 'Keys',
    icon: 'fa-keyboard',
    category: 'System',
    tags: ['keyboard', 'key', 'keycode', 'event', 'nkro'],
  },
  {
    id: 'audio',
    name: 'Signal Lab',
    shortName: 'Signal',
    icon: 'fa-chart-line',
    category: 'System',
    tags: ['signal', 'synth', 'oscillator', 'frequency', 'fft'],
  },
  {
    id: 'spectrogram',
    name: 'Spectrogram',
    shortName: 'Spectrum',
    icon: 'fa-water',
    category: 'System',
    tags: ['spectrogram', 'heatmap', 'frequency', 'fft', 'pitch', 'tuner', 'audio', 'waterfall'],
  },
  {
    id: 'qr',
    name: 'QR Gen',
    shortName: 'QR',
    icon: 'fa-qrcode',
    category: 'System',
    tags: ['qr', 'barcode', 'wifi', 'vcard', 'svg'],
  },
  {
    id: 'metadata',
    name: 'Metadata',
    shortName: 'Metadata',
    icon: 'fa-tags',
    category: 'System',
    tags: ['metadata', 'exif', 'gps', 'camera', 'strip'],
  },
  {
    id: 'units',
    name: 'Unit Converter',
    shortName: 'Units',
    icon: 'fa-scale-balanced',
    category: 'System',
    tags: ['unit', 'convert', 'length', 'mass', 'temperature', 'data'],
  },
];
