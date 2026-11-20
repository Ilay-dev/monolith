import React, { useState, useRef, useMemo } from 'react';

declare const piexif: any;

type IfdName = '0th' | 'Exif' | 'GPS' | 'Interop' | '1st';

interface TagEntry {
  key: string;       // `${ifd}:${tagId}`
  ifd: IfdName;
  tagId: number;
  name: string;
  piexifType: number; // 1=Byte, 2=Ascii, 3=Short, 4=Long, 5=Rational, 7=Undefined, 9=SLong, 10=SRational
  rawValue: any;
  editValue: string;
  isPresentInFile: boolean;
}

// Default standard tags from 0th, Exif, and GPS so they are always available to edit
const STANDARD_TAGS: Array<{ ifd: IfdName; tagId: number; name: string }> = [
  // 0th IFD (Image)
  { ifd: '0th', tagId: 271, name: 'Make' },
  { ifd: '0th', tagId: 272, name: 'Model' },
  { ifd: '0th', tagId: 274, name: 'Orientation' },
  { ifd: '0th', tagId: 282, name: 'XResolution' },
  { ifd: '0th', tagId: 283, name: 'YResolution' },
  { ifd: '0th', tagId: 296, name: 'ResolutionUnit' },
  { ifd: '0th', tagId: 305, name: 'Software' },
  { ifd: '0th', tagId: 306, name: 'DateTime' },
  { ifd: '0th', tagId: 531, name: 'YCbCrPositioning' },
  { ifd: '0th', tagId: 315, name: 'Artist' },
  { ifd: '0th', tagId: 33432, name: 'Copyright' },
  { ifd: '0th', tagId: 270, name: 'ImageDescription' },
  // Exif IFD
  { ifd: 'Exif', tagId: 33434, name: 'ExposureTime' },
  { ifd: 'Exif', tagId: 33437, name: 'FNumber' },
  { ifd: 'Exif', tagId: 34850, name: 'ExposureProgram' },
  { ifd: 'Exif', tagId: 34855, name: 'ISOSpeedRatings' },
  { ifd: 'Exif', tagId: 36864, name: 'ExifVersion' },
  { ifd: 'Exif', tagId: 36867, name: 'DateTimeOriginal' },
  { ifd: 'Exif', tagId: 36868, name: 'DateTimeDigitized' },
  { ifd: 'Exif', tagId: 37377, name: 'ShutterSpeedValue' },
  { ifd: 'Exif', tagId: 37378, name: 'ApertureValue' },
  { ifd: 'Exif', tagId: 37379, name: 'BrightnessValue' },
  { ifd: 'Exif', tagId: 37380, name: 'ExposureBiasValue' },
  { ifd: 'Exif', tagId: 37381, name: 'MaxApertureValue' },
  { ifd: 'Exif', tagId: 37383, name: 'MeteringMode' },
  { ifd: 'Exif', tagId: 37385, name: 'Flash' },
  { ifd: 'Exif', tagId: 37386, name: 'FocalLength' },
  { ifd: 'Exif', tagId: 37520, name: 'SubSecTime' },
  { ifd: 'Exif', tagId: 37521, name: 'SubSecTimeOriginal' },
  { ifd: 'Exif', tagId: 37522, name: 'SubSecTimeDigitized' },
  { ifd: 'Exif', tagId: 40960, name: 'FlashpixVersion' },
  { ifd: 'Exif', tagId: 40961, name: 'ColorSpace' },
  { ifd: 'Exif', tagId: 40962, name: 'PixelXDimension' },
  { ifd: 'Exif', tagId: 40963, name: 'PixelYDimension' },
  { ifd: 'Exif', tagId: 41986, name: 'ExposureMode' },
  { ifd: 'Exif', tagId: 41987, name: 'WhiteBalance' },
  { ifd: 'Exif', tagId: 41988, name: 'DigitalZoomRatio' },
  { ifd: 'Exif', tagId: 41989, name: 'FocalLengthIn35mmFilm' },
  { ifd: 'Exif', tagId: 41990, name: 'SceneCaptureType' },
  { ifd: 'Exif', tagId: 42016, name: 'ImageUniqueID' },
  { ifd: 'Exif', tagId: 42035, name: 'LensMake' },
  { ifd: 'Exif', tagId: 42036, name: 'LensModel' },
  // GPS IFD
  { ifd: 'GPS', tagId: 1, name: 'GPSLatitudeRef' },
  { ifd: 'GPS', tagId: 2, name: 'GPSLatitude' },
  { ifd: 'GPS', tagId: 3, name: 'GPSLongitudeRef' },
  { ifd: 'GPS', tagId: 4, name: 'GPSLongitude' },
  { ifd: 'GPS', tagId: 5, name: 'GPSAltitudeRef' },
  { ifd: 'GPS', tagId: 6, name: 'GPSAltitude' },
];

// Pointer tags managed internally by piexif.dump (still displayed & editable if needed, but handled safely)
const INTERNAL_POINTER_TAGS = new Set(['0th:34665', '0th:34853', 'Exif:40965']);

const formatTagValueForInput = (val: any): string => {
  if (val === undefined || val === null) return '';
  if (typeof val === 'string') return val.replace(/\0+$/g, '');
  if (typeof val === 'number') return String(val);
  return JSON.stringify(val);
};

// Format human-readable hint for rational arrays like [180,100] -> "= 1.8" or GPS [[48,1],[7,1],[48228239,1000000]] -> "= 48.130063°"
const getHumanHint = (name: string, editValue: string): string | null => {
  const trimmed = editValue.trim();
  if (!trimmed.startsWith('[')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'number' &&
      typeof parsed[1] === 'number' &&
      parsed[1] !== 0
    ) {
      const dec = parsed[0] / parsed[1];
      if (name === 'ExposureTime' && dec < 1 && dec > 0) {
        return `≈ 1/${Math.round(1 / dec)}s (${dec.toFixed(5)}s)`;
      }
      if (name === 'FNumber') return `= f/${dec.toFixed(2)}`;
      if (name === 'FocalLength') return `= ${dec.toFixed(2)} mm`;
      return `= ${Number(dec.toFixed(4))}`;
    }
    if (
      Array.isArray(parsed) &&
      parsed.length === 3 &&
      Array.isArray(parsed[0]) &&
      Array.isArray(parsed[1]) &&
      Array.isArray(parsed[2])
    ) {
      const d = parsed[0][0] / (parsed[0][1] || 1);
      const m = parsed[1][0] / (parsed[1][1] || 1);
      const s = parsed[2][0] / (parsed[2][1] || 1);
      return `= ${(d + m / 60 + s / 3600).toFixed(6)}°`;
    }
  } catch {}
  return null;
};

const decimalToDmsRational = (decVal: number) => {
  const abs = Math.abs(decVal);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = Math.round((minFloat - min) * 60 * 1000000);
  return [
    [deg, 1],
    [min, 1],
    [sec, 1000000],
  ];
};

// Parse user-edited string back into the exact type expected by piexif.dump
const parseInputToPiexifValue = (entry: TagEntry): any => {
  const rawStr = entry.editValue.trim();
  if (rawStr === '') return undefined;

  const t = entry.piexifType;

  // Type 2 = Ascii, Type 7 = Undefined (byte string like "0220" or "0100")
  if (t === 2 || t === 7) {
    return entry.editValue;
  }

  // If user entered JSON array (e.g. [180,100] or [[48,1],[7,1],[...]])
  if (rawStr.startsWith('[')) {
    try {
      return JSON.parse(rawStr);
    } catch {}
  }

  // Type 5 = Rational, Type 10 = SRational
  if (t === 5 || t === 10) {
    // Check if GPS coordinate entered as decimal number (e.g. "48.130063")
    if (entry.ifd === 'GPS' && (entry.tagId === 2 || entry.tagId === 4)) {
      const dec = parseFloat(rawStr);
      if (!isNaN(dec)) return decimalToDmsRational(dec);
    }
    // Check if fraction "1/250" or "180/100"
    if (rawStr.includes('/')) {
      const [num, den] = rawStr.split('/').map((n) => parseInt(n.trim(), 10));
      if (!isNaN(num) && !isNaN(den) && den !== 0) return [num, den];
    }
    // Check if decimal number "1.8" -> [180, 100]
    const num = parseFloat(rawStr);
    if (!isNaN(num)) {
      if (Number.isInteger(num)) return [num, 1];
      return [Math.round(num * 10000), 10000];
    }
  }

  // Type 1 = Byte, 3 = Short, 4 = Long, 9 = SLong
  if (t === 1 || t === 3 || t === 4 || t === 9) {
    const n = parseInt(rawStr, 10);
    if (!isNaN(n)) return n;
  }

  // Fallback: try JSON parse, otherwise string
  try {
    return JSON.parse(rawStr);
  } catch {
    return rawStr;
  }
};

const MetadataEditor: React.FC = () => {
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [isJpeg, setIsJpeg] = useState(false);
  const [fileInfo, setFileInfo] = useState<{ name: string; size: number; dims?: string; sha256: string } | null>(null);
  const [tags, setTags] = useState<TagEntry[]>([]);
  const [thumbnailData, setThumbnailData] = useState<any>(null);
  const [filterQuery, setFilterQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'present' | '0th' | 'Exif' | 'GPS'>('present');
  const [newTagIfd, setNewTagIfd] = useState<IfdName>('Exif');
  const [newTagId, setNewTagId] = useState<string>('');
  const [newTagValue, setNewTagValue] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Build complete catalog of available piexif tags for "+ Add Tag" dropdown
  const availableCatalog = useMemo(() => {
    if (typeof piexif === 'undefined' || !piexif.TAGS) return [];
    const list: Array<{ ifd: IfdName; tagId: number; name: string; type: number }> = [];
    (['0th', 'Exif', 'GPS', 'Interop', '1st'] as const).forEach((ifd) => {
      const group = piexif.TAGS[ifd];
      if (!group) return;
      Object.keys(group).forEach((idStr) => {
        const tagId = Number(idStr);
        list.push({
          ifd,
          tagId,
          name: group[tagId]?.name || `Tag_0x${tagId.toString(16)}`,
          type: group[tagId]?.type || 2,
        });
      });
    });
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [imageDataUrl]);

  const inspectFile = async (file?: File) => {
    if (!file) return;
    setStatusMsg('');
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
    const sha256 = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const jpeg = file.type === 'image/jpeg' || (bytes[0] === 0xff && bytes[1] === 0xd8);
    setIsJpeg(jpeg);
    setFileInfo({ name: file.name, size: file.size, sha256 });

    if (file.type.startsWith('image/') || jpeg) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        setImageDataUrl(dataUrl);

        const img = new Image();
        img.onload = () => {
          setFileInfo((prev) => (prev ? { ...prev, dims: `${img.naturalWidth}×${img.naturalHeight}px` } : null));
        };
        img.src = dataUrl;

        if (jpeg && typeof piexif !== 'undefined') {
          try {
            const exif = piexif.load(dataUrl);
            setThumbnailData(exif.thumbnail || null);

            const discoveredMap = new Map<string, TagEntry>();

            // 1. First load ALL tags actually present in the file across all IFDs
            (['0th', 'Exif', 'GPS', 'Interop', '1st'] as const).forEach((ifd) => {
              const group = exif[ifd];
              if (!group) return;
              Object.keys(group).forEach((idStr) => {
                const tagId = Number(idStr);
                const key = `${ifd}:${tagId}`;
                const tagMeta = piexif.TAGS?.[ifd]?.[tagId] || piexif.TAGS?.['0th']?.[tagId];
                const name = tagMeta?.name || `Unknown_0x${tagId.toString(16).toUpperCase()}`;
                const piexifType = tagMeta?.type || (typeof group[tagId] === 'number' ? 4 : 2);
                const rawVal = group[tagId];

                discoveredMap.set(key, {
                  key,
                  ifd,
                  tagId,
                  name,
                  piexifType,
                  rawValue: rawVal,
                  editValue: formatTagValueForInput(rawVal),
                  isPresentInFile: true,
                });
              });
            });

            // 2. Also add any standard tags that weren't in the file yet so the user can fill them in easily
            STANDARD_TAGS.forEach((std) => {
              const key = `${std.ifd}:${std.tagId}`;
              if (!discoveredMap.has(key)) {
                const tagMeta = piexif.TAGS?.[std.ifd]?.[std.tagId];
                discoveredMap.set(key, {
                  key,
                  ifd: std.ifd,
                  tagId: std.tagId,
                  name: std.name,
                  piexifType: tagMeta?.type || 2,
                  rawValue: '',
                  editValue: '',
                  isPresentInFile: false,
                });
              }
            });

            const allEntries = Array.from(discoveredMap.values());
            setTags(allEntries);
            const presentCount = allEntries.filter((e) => e.isPresentInFile).length;
            setActiveFilter(presentCount > 0 ? 'present' : 'all');
          } catch {
            setTags([]);
          }
        } else {
          setTags([]);
        }
      };
      reader.readAsDataURL(file);
    } else {
      setImageDataUrl(null);
      setTags([]);
    }
  };

  const updateTagValue = (key: string, nextVal: string) => {
    setTags((prev) =>
      prev.map((t) =>
        t.key === key
          ? { ...t, editValue: nextVal, isPresentInFile: nextVal.trim() !== '' ? true : t.isPresentInFile }
          : t
      )
    );
  };

  const removeTag = (key: string) => {
    setTags((prev) =>
      prev.map((t) => (t.key === key ? { ...t, editValue: '', isPresentInFile: false } : t))
    );
  };

  const addCustomOrCatalogTag = () => {
    if (!newTagId || typeof piexif === 'undefined') return;
    const tagId = newTagId.startsWith('0x') ? parseInt(newTagId, 16) : parseInt(newTagId, 10);
    if (isNaN(tagId)) return;

    const key = `${newTagIfd}:${tagId}`;
    const tagMeta = piexif.TAGS?.[newTagIfd]?.[tagId] || piexif.TAGS?.['0th']?.[tagId];
    const name = tagMeta?.name || `Custom_0x${tagId.toString(16).toUpperCase()}`;
    const piexifType = tagMeta?.type || 2;

    setTags((prev) => {
      const exists = prev.some((t) => t.key === key);
      if (exists) {
        return prev.map((t) =>
          t.key === key ? { ...t, editValue: newTagValue, isPresentInFile: true } : t
        );
      }
      return [
        {
          key,
          ifd: newTagIfd,
          tagId,
          name,
          piexifType,
          rawValue: newTagValue,
          editValue: newTagValue,
          isPresentInFile: true,
        },
        ...prev,
      ];
    });
    setNewTagValue('');
    setStatusMsg(`Added tag ${name} (${newTagIfd})`);
  };

  // Export ALL tags (preserving all 30+ existing tags + edits + newly added tags)
  const saveAllMetadata = () => {
    if (!imageDataUrl || !isJpeg || typeof piexif === 'undefined') return;
    try {
      const exifObj: Record<string, any> = {
        '0th': {},
        Exif: {},
        GPS: {},
        Interop: {},
        '1st': {},
      };
      if (thumbnailData) {
        exifObj.thumbnail = thumbnailData;
      }

      let exportedCount = 0;

      for (const entry of tags) {
        if (INTERNAL_POINTER_TAGS.has(entry.key)) continue;
        if (entry.editValue.trim() === '') continue;

        const parsedVal = parseInputToPiexifValue(entry);
        if (parsedVal === undefined) continue;

        // Validate single tag with piexif so one malformed custom value never breaks the entire export
        try {
          const testObj: Record<string, any> = {
            '0th': {},
            Exif: {},
            GPS: {},
            Interop: {},
            '1st': {},
          };
          testObj[entry.ifd][entry.tagId] = parsedVal;
          piexif.dump(testObj);
          exifObj[entry.ifd][entry.tagId] = parsedVal;
          exportedCount++;
        } catch {
          // If edited value failed strict type check, fall back to original rawValue if available
          if (entry.rawValue !== undefined && entry.rawValue !== '') {
            try {
              exifObj[entry.ifd][entry.tagId] = entry.rawValue;
              exportedCount++;
            } catch {}
          }
        }
      }

      const exifBytes = piexif.dump(exifObj);
      const outDataUrl = piexif.insert(exifBytes, imageDataUrl);

      const link = document.createElement('a');
      link.download = `${(fileInfo?.name || 'image').replace(/\.[^/.]+$/, '')}-metadata.jpg`;
      link.href = outDataUrl;
      link.click();

      // Re-verify exported tag count via piexif.load
      const verifyExif = piexif.load(outDataUrl);
      let verifiedTotal = 0;
      (['0th', 'Exif', 'GPS', 'Interop', '1st'] as const).forEach((ifd) => {
        verifiedTotal += Object.keys(verifyExif[ifd] || {}).length;
      });
      setStatusMsg(`Exported JPEG with ${verifiedTotal} metadata tags.`);
    } catch (err: any) {
      setStatusMsg(`Export error: ${err.message}`);
    }
  };

  const stripMetadata = () => {
    if (!imageDataUrl) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d')!.drawImage(img, 0, 0);
      const link = document.createElement('a');
      link.download = `${(fileInfo?.name || 'image').replace(/\.[^/.]+$/, '')}-clean.jpg`;
      link.href = c.toDataURL('image/jpeg', 0.95);
      link.click();
      setStatusMsg('Exported clean JPEG with 0 metadata tags.');
    };
    img.src = imageDataUrl;
  };

  const visibleTags = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return tags.filter((t) => {
      if (activeFilter === 'present' && !t.isPresentInFile && t.editValue.trim() === '') return false;
      if (activeFilter === '0th' && t.ifd !== '0th') return false;
      if (activeFilter === 'Exif' && t.ifd !== 'Exif') return false;
      if (activeFilter === 'GPS' && t.ifd !== 'GPS') return false;
      if (q && !t.name.toLowerCase().includes(q) && !t.editValue.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tags, activeFilter, filterQuery]);

  const presentTagCount = useMemo(
    () => tags.filter((t) => t.isPresentInFile || t.editValue.trim() !== '').length,
    [tags]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-white">Metadata</h1>
          {statusMsg && (
            <span className="font-mono text-xs text-[#ff4f00]">{statusMsg}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200"
          >
            Open Image
          </button>
          {imageDataUrl && (
            <button
              onClick={stripMetadata}
              className="px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-red-400"
            >
              Strip All
            </button>
          )}
          {isJpeg && (
            <button
              onClick={saveAllMetadata}
              className="px-3.5 py-1.5 rounded bg-white hover:bg-zinc-200 text-black text-xs font-semibold"
            >
              Export JPEG ({presentTagCount} Tags)
            </button>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/*"
        onChange={(e) => inspectFile(e.target.files?.[0])}
        className="hidden"
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left Preview & File Info */}
        <div className="lg:col-span-4 space-y-3">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              inspectFile(e.dataTransfer.files?.[0]);
            }}
            className="studio-panel rounded-lg p-4 min-h-[200px] checkerboard flex items-center justify-center cursor-pointer"
          >
            {imageDataUrl ? (
              <img src={imageDataUrl} alt="Asset" className="max-h-52 object-contain rounded" />
            ) : (
              <div className="text-center text-xs text-zinc-500">
                <i className="fas fa-plus block text-lg mb-2"></i>
                Drop JPEG image to edit all metadata tags
              </div>
            )}
          </div>

          {fileInfo && (
            <div className="studio-panel rounded-lg p-3.5 space-y-1.5 font-mono text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-500">File</span>
                <span className="text-white truncate max-w-[180px]">{fileInfo.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Size</span>
                <span className="text-zinc-300">{(fileInfo.size / 1024).toFixed(1)} KB</span>
              </div>
              {fileInfo.dims && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Dimensions</span>
                  <span className="text-zinc-300">{fileInfo.dims}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-zinc-500">Active Tags</span>
                <span className="text-white font-semibold">{presentTagCount}</span>
              </div>
              <div className="pt-1 border-t border-zinc-800 text-[10px] text-zinc-500 break-all select-text">
                SHA256: {fileInfo.sha256}
              </div>
            </div>
          )}

          {/* Add New / Custom EXIF Tag Box */}
          {isJpeg && (
            <div className="studio-panel rounded-lg p-3.5 space-y-2.5">
              <div className="text-[11px] font-mono uppercase text-zinc-400">Add Metadata Tag</div>
              <div className="grid grid-cols-3 gap-1.5">
                <select
                  value={newTagIfd}
                  onChange={(e) => {
                    setNewTagIfd(e.target.value as IfdName);
                    setNewTagId('');
                  }}
                  className="bg-[#070708] border border-zinc-800 rounded p-1.5 text-xs font-mono text-white"
                >
                  <option value="0th">0th (Image)</option>
                  <option value="Exif">Exif</option>
                  <option value="GPS">GPS</option>
                  <option value="Interop">Interop</option>
                  <option value="1st">1st</option>
                </select>
                <select
                  value={newTagId}
                  onChange={(e) => setNewTagId(e.target.value)}
                  className="col-span-2 bg-[#070708] border border-zinc-800 rounded p-1.5 text-xs font-mono text-white"
                >
                  <option value="">Select tag...</option>
                  {availableCatalog
                    .filter((c) => c.ifd === newTagIfd)
                    .map((c) => (
                      <option key={`${c.ifd}:${c.tagId}`} value={String(c.tagId)}>
                        {c.name} (0x{c.tagId.toString(16).toUpperCase()})
                      </option>
                    ))}
                </select>
              </div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={newTagValue}
                  onChange={(e) => setNewTagValue(e.target.value)}
                  placeholder="Tag value..."
                  className="flex-1 bg-[#070708] border border-zinc-800 rounded p-1.5 text-xs font-mono text-white focus:outline-none"
                />
                <button
                  onClick={addCustomOrCatalogTag}
                  disabled={!newTagId}
                  className="px-3 py-1.5 rounded bg-white text-black text-xs font-semibold disabled:opacity-30"
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Full Editable Tag Table */}
        <div className="lg:col-span-8 studio-panel rounded-lg overflow-hidden">
          {/* Filter Tabs & Search */}
          <div className="p-2.5 border-b border-zinc-800 bg-[#0b0b0d] flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              {[
                { id: 'present', label: `In Image (${presentTagCount})` },
                { id: 'all', label: `All (${tags.length})` },
                { id: '0th', label: 'Image (0th)' },
                { id: 'Exif', label: 'Camera (Exif)' },
                { id: 'GPS', label: 'GPS' },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setActiveFilter(f.id as any)}
                  className={`px-2.5 py-1 rounded text-xs font-medium ${
                    activeFilter === f.id
                      ? 'bg-white text-black font-semibold'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filter tags (e.g. Model, GPS, ISO, Focal)..."
              className="w-full sm:w-56 bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1 text-xs font-mono text-white placeholder:text-zinc-600 focus:outline-none"
            />
          </div>

          {/* Editable Rows for Every Single Tag */}
          <div key={activeFilter} className="max-h-[65vh] overflow-y-auto custom-scrollbar divide-y divide-zinc-800/60 tool-view-transition">
            {visibleTags.map((entry) => {
              const isPointer = INTERNAL_POINTER_TAGS.has(entry.key);
              const hint = getHumanHint(entry.name, entry.editValue);

              return (
                <div
                  key={entry.key}
                  className="px-3.5 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-zinc-900/40"
                >
                  <div className="flex items-center gap-2 min-w-0 sm:w-5/12">
                    <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 font-mono text-[10px] text-zinc-500 flex-shrink-0">
                      {entry.ifd}
                    </span>
                    <span className="font-mono text-xs text-zinc-200 truncate" title={`Tag ID: ${entry.tagId} (0x${entry.tagId.toString(16).toUpperCase()})`}>
                      {entry.name}
                    </span>
                    {hint && (
                      <span className="font-mono text-[10px] text-zinc-500 truncate hidden xl:inline">
                        {hint}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 sm:w-7/12">
                    <input
                      type="text"
                      value={entry.editValue}
                      disabled={isPointer}
                      onChange={(e) => updateTagValue(entry.key, e.target.value)}
                      placeholder={isPointer ? 'Auto-calculated offset' : 'Empty'}
                      className={`w-full bg-[#070708] border border-zinc-800 focus:border-zinc-500 rounded px-2.5 py-1.5 font-mono text-xs text-white focus:outline-none select-text ${
                        isPointer ? 'opacity-50 cursor-not-allowed' : ''
                      }`}
                    />
                    {!isPointer && entry.editValue !== '' && (
                      <button
                        onClick={() => removeTag(entry.key)}
                        className="w-7 h-7 rounded bg-zinc-900 hover:bg-red-500/20 border border-zinc-800 text-zinc-500 hover:text-red-400 flex items-center justify-center flex-shrink-0 text-xs"
                        title="Remove tag"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {visibleTags.length === 0 && (
              <div className="py-12 text-center text-xs text-zinc-500">
                {imageDataUrl
                  ? 'No matching tags in this view. Switch to "All" or use "Add Metadata Tag".'
                  : 'Open a JPEG image to inspect and edit all metadata tags.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MetadataEditor;
