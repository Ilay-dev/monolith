import React, { useState, useRef } from 'react';

declare const mammoth: any;

const OfficeEditor: React.FC = () => {
  const [title, setTitle] = useState('Untitled Document');
  const [showSigModal, setShowSigModal] = useState(false);

  const editorRef = useRef<HTMLDivElement>(null);
  const sigCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isDrawingSig = useRef(false);

  const execCommand = (command: string, value: string | undefined = undefined) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editorRef.current) return;
    setTitle(file.name.replace(/\.[^/.]+$/, ''));

    if (file.name.endsWith('.docx') && typeof mammoth !== 'undefined') {
      const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
      editorRef.current.innerHTML = result.value;
    } else if (file.name.endsWith('.html')) {
      editorRef.current.innerHTML = await file.text();
    } else {
      const text = await file.text();
      editorRef.current.innerHTML = text
        .split('\n\n')
        .map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
        .join('');
    }
  };

  const insertSignature = () => {
    const canvas = sigCanvasRef.current;
    if (!canvas || !editorRef.current) return;
    const dataUrl = canvas.toDataURL('image/png');
    editorRef.current.focus();
    document.execCommand(
      'insertHTML',
      false,
      `<p><img src="${dataUrl}" alt="Signature" style="max-height:64px;" /></p>`
    );
    setShowSigModal(false);
  };

  const exportPDF = () => {
    const jsPDF = (window as any).jspdf?.jsPDF;
    if (!jsPDF || !editorRef.current) return;

    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 18;
    const maxW = pageW - margin * 2;
    let y = 20;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(title || 'Document', margin, y);
    y += 10;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    const lines = doc.splitTextToSize(editorRef.current.innerText || '', maxW);
    for (const line of lines) {
      if (y > pageH - 18) {
        doc.addPage();
        y = 20;
      }
      doc.text(line, margin, y);
      y += 5.5;
    }

    const imgs = Array.from(editorRef.current.querySelectorAll('img'));
    imgs.forEach((img) => {
      if (img.src.startsWith('data:image/')) {
        if (y + 24 > pageH - 18) {
          doc.addPage();
          y = 20;
        }
        try {
          doc.addImage(img.src, 'PNG', margin, y, 50, 20);
          y += 24;
        } catch {}
      }
    });

    doc.save(`${(title || 'document').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-800">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Document Title..."
          className="bg-transparent text-base font-semibold text-white focus:outline-none border-b border-transparent focus:border-zinc-700"
        />

        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200"
          >
            Open DOCX / TXT
          </button>
          <button
            onClick={() => setShowSigModal(true)}
            className="px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200"
          >
            Sign
          </button>
          <button
            onClick={exportPDF}
            className="px-3.5 py-1.5 rounded bg-white hover:bg-zinc-200 text-black text-xs font-semibold"
          >
            Export PDF
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,.txt,.md,.html"
        onChange={handleImportFile}
        className="hidden"
      />

      {/* Minimal Toolbar */}
      <div className="studio-panel rounded-lg p-1.5 flex flex-wrap items-center gap-1">
        {[
          { cmd: 'formatBlock', arg: 'H1', label: 'H1' },
          { cmd: 'formatBlock', arg: 'H2', label: 'H2' },
          { cmd: 'formatBlock', arg: 'P', label: 'P' },
        ].map((b) => (
          <button
            key={b.label}
            onClick={() => execCommand(b.cmd, b.arg)}
            className="px-2.5 py-1 rounded hover:bg-zinc-800 text-xs font-mono text-zinc-300"
          >
            {b.label}
          </button>
        ))}
        <div className="w-px h-4 bg-zinc-800 mx-1" />
        {[
          { cmd: 'bold', icon: 'fa-bold' },
          { cmd: 'italic', icon: 'fa-italic' },
          { cmd: 'underline', icon: 'fa-underline' },
          { cmd: 'justifyLeft', icon: 'fa-align-left' },
          { cmd: 'justifyCenter', icon: 'fa-align-center' },
          { cmd: 'insertUnorderedList', icon: 'fa-list-ul' },
          { cmd: 'insertOrderedList', icon: 'fa-list-ol' },
        ].map((b) => (
          <button
            key={b.cmd}
            onClick={() => execCommand(b.cmd)}
            className="w-7 h-7 rounded hover:bg-zinc-800 text-xs text-zinc-300"
          >
            <i className={`fas ${b.icon}`}></i>
          </button>
        ))}
      </div>

      {/* Document Canvas */}
      <div className="studio-panel rounded-lg p-6 sm:p-10 bg-[#0b0b0e] min-h-[540px]">
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          className="prose-editor w-full min-h-[480px] text-zinc-100 text-sm sm:text-base leading-relaxed focus:outline-none select-text"
        >
          <p>Start typing here...</p>
        </div>
      </div>

      {showSigModal && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setShowSigModal(false)}
        >
          <div
            className="w-full max-w-md bg-[#0e0e11] border border-zinc-700 rounded-lg p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between text-xs font-semibold text-white">
              <span>Signature</span>
              <button onClick={() => setShowSigModal(false)} className="text-zinc-500 hover:text-white">
                ×
              </button>
            </div>
            <div className="bg-white rounded overflow-hidden touch-none">
              <canvas
                ref={sigCanvasRef}
                width={400}
                height={140}
                onMouseDown={(e) => {
                  isDrawingSig.current = true;
                  const ctx = sigCanvasRef.current!.getContext('2d')!;
                  const r = sigCanvasRef.current!.getBoundingClientRect();
                  ctx.strokeStyle = '#000';
                  ctx.lineWidth = 2;
                  ctx.beginPath();
                  ctx.moveTo(e.clientX - r.left, e.clientY - r.top);
                }}
                onMouseMove={(e) => {
                  if (!isDrawingSig.current) return;
                  const ctx = sigCanvasRef.current!.getContext('2d')!;
                  const r = sigCanvasRef.current!.getBoundingClientRect();
                  ctx.lineTo(e.clientX - r.left, e.clientY - r.top);
                  ctx.stroke();
                }}
                onMouseUp={() => {
                  isDrawingSig.current = false;
                }}
                className="w-full h-36 cursor-crosshair block"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  const c = sigCanvasRef.current;
                  if (c) c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
                }}
                className="px-3 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-xs text-zinc-400"
              >
                Clear
              </button>
              <button
                onClick={insertSignature}
                className="px-3.5 py-1.5 rounded bg-white text-black text-xs font-semibold"
              >
                Insert
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .prose-editor h1 { font-size: 1.5rem; font-weight: 700; margin: 0.5rem 0; }
        .prose-editor h2 { font-size: 1.25rem; font-weight: 600; margin: 0.5rem 0; }
        .prose-editor p { margin: 0.4rem 0; }
        .prose-editor ul { list-style-type: disc; padding-left: 1.5rem; }
        .prose-editor ol { list-style-type: decimal; padding-left: 1.5rem; }
      `}</style>
    </div>
  );
};

export default OfficeEditor;
