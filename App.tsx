import React, { useState, useEffect, useMemo, useRef, Suspense, lazy } from 'react';
import Sidebar from './components/Sidebar';
import { ToolId, TOOLS } from './types';

const ImageStudio = lazy(() => import('./tools/ImageStudio'));
const VideoEditor = lazy(() => import('./tools/VideoEditor'));
const PaintPro = lazy(() => import('./tools/PaintPro'));
const ImageCompressor = lazy(() => import('./tools/ImageCompressor'));
const AudioMixer = lazy(() => import('./tools/AudioMixer'));
const OfficeEditor = lazy(() => import('./tools/OfficeEditor'));
const OfficeConverter = lazy(() => import('./tools/OfficeConverter'));
const BinaryConverter = lazy(() => import('./tools/BinaryConverter'));
const KeyVisualizer = lazy(() => import('./tools/KeyVisualizer'));
const AudioLab = lazy(() => import('./tools/AudioLab'));
const SpectrogramLab = lazy(() => import('./tools/SpectrogramLab'));
const QRGenerator = lazy(() => import('./tools/QRGenerator'));
const MetadataEditor = lazy(() => import('./tools/MetadataEditor'));
const UnitConverter = lazy(() => import('./tools/UnitConverter'));

const App: React.FC = () => {
  const [activeTool, setActiveTool] = useState<ToolId>(() => {
    const saved = localStorage.getItem('monolith_active_tool') as ToolId | null;
    if (saved && TOOLS.some((t) => t.id === saved)) return saved;
    return 'image';
  });
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);

  const mainScrollRef = useRef<HTMLElement>(null);
  const rootContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('monolith_active_tool', activeTool);
    // Smooth scroll back to top when switching tools
    if (mainScrollRef.current) {
      mainScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [activeTool]);

  // Scroll & Parallax CSS Variable Driver + IntersectionObserver Scroll Animations
  useEffect(() => {
    const el = mainScrollRef.current;
    if (!el) return;

    const updateScrollVars = () => {
      const st = el.scrollTop;
      const maxScroll = Math.max(1, el.scrollHeight - el.clientHeight);
      setIsScrolled(st > 10);
      setScrollProgress(Math.min(100, (st / maxScroll) * 100));
      rootContainerRef.current?.style.setProperty('--scroll-y', `${st}px`);
    };

    el.addEventListener('scroll', updateScrollVars, { passive: true });
    updateScrollVars();

    // IntersectionObserver for smooth scroll-in animations of panels
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
          }
        });
      },
      { root: el, threshold: 0.06 }
    );

    const timer = setTimeout(() => {
      const panels = el.querySelectorAll('.studio-panel');
      panels.forEach((p) => {
        p.classList.add('scroll-reveal-item');
        observer.observe(p);
      });
    }, 40);

    return () => {
      el.removeEventListener('scroll', updateScrollVars);
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [activeTool]);

  const handlePointerMove = (e: React.MouseEvent) => {
    if (!rootContainerRef.current) return;
    const x = ((e.clientX / window.innerWidth) - 0.5) * -14;
    const y = ((e.clientY / window.innerHeight) - 0.5) * -14;
    rootContainerRef.current.style.setProperty('--parallax-x', `${x.toFixed(1)}px`);
    rootContainerRef.current.style.setProperty('--parallax-y', `${y.toFixed(1)}px`);
  };

  const currentTool = useMemo(
    () => TOOLS.find((t) => t.id === activeTool) || TOOLS[0],
    [activeTool]
  );

  const renderTool = () => {
    switch (activeTool) {
      case 'image':
        return <ImageStudio />;
      case 'video':
        return <VideoEditor />;
      case 'paint-pro':
        return <PaintPro />;
      case 'compress':
        return <ImageCompressor />;
      case 'audio-mixer':
        return <AudioMixer />;
      case 'office-editor':
        return <OfficeEditor />;
      case 'office-converter':
        return <OfficeConverter />;
      case 'binary':
        return <BinaryConverter />;
      case 'key':
        return <KeyVisualizer />;
      case 'audio':
        return <AudioLab />;
      case 'spectrogram':
        return <SpectrogramLab />;
      case 'qr':
        return <QRGenerator />;
      case 'metadata':
        return <MetadataEditor />;
      case 'units':
        return <UnitConverter />;
      default:
        return <ImageStudio />;
    }
  };

  return (
    <div
      ref={rootContainerRef}
      onMouseMove={handlePointerMove}
      className="h-screen w-screen flex flex-col lg:flex-row bg-[#060608] text-zinc-100 overflow-hidden relative"
    >
      {/* Subtle Parallax Architectural Grid Background */}
      <div className="fixed inset-[-60px] pointer-events-none parallax-backdrop z-0" />

      {/* Mobile Drawer Backdrop */}
      {isMobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/75 backdrop-blur-xs z-40 lg:hidden transition-opacity duration-200"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      {/* Expanded Larger Sidebar (288px / w-72 on Desktop) */}
      <div
        className={`fixed inset-y-0 left-0 z-50 lg:relative h-full w-72 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] flex-shrink-0 ${
          isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <Sidebar
          activeTool={activeTool}
          onSelectTool={(id) => {
            setActiveTool(id);
            setIsMobileSidebarOpen(false);
          }}
          onCloseMobile={() => setIsMobileSidebarOpen(false)}
        />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative z-10">
        {/* Scroll-Reactive Mobile & Tablet Header */}
        <header
          className={`lg:hidden h-14 flex-shrink-0 px-4 flex items-center justify-between transition-all duration-200 z-30 ${
            isScrolled
              ? 'bg-[#0a0a0d]/90 backdrop-blur-md border-b border-zinc-800 shadow-lg'
              : 'bg-[#0a0a0d]/60 border-b border-zinc-800/50'
          }`}
        >
          <button
            onClick={() => setIsMobileSidebarOpen(true)}
            className="w-9 h-9 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-200 active:scale-95"
            aria-label="Menu"
          >
            <i className="fas fa-bars text-xs"></i>
          </button>
          <div className="flex items-center gap-2">
            <i className={`fas ${currentTool.icon} text-xs text-zinc-400`}></i>
            <span className="text-xs font-semibold tracking-wide text-white">{currentTool.name}</span>
          </div>
          <div className="w-9" />
        </header>

        {/* Subtle Top Scroll Progress Line */}
        {isScrolled && (
          <div className="h-[1px] w-full bg-zinc-900 flex-shrink-0 overflow-hidden">
            <div
              style={{ width: `${scrollProgress}%` }}
              className="h-full bg-white/40 transition-all duration-100"
            />
          </div>
        )}

        {/* Main Scroll Container with Keyed Tab-Switch Animation */}
        <main
          ref={mainScrollRef}
          className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-8 custom-scrollbar"
        >
          <div
            key={activeTool}
            className="max-w-6xl mx-auto w-full pb-20 lg:pb-10 tool-view-transition"
          >
            <Suspense
              fallback={
                <div className="h-56 flex items-center justify-center font-mono text-xs text-zinc-500">
                  Loading...
                </div>
              }
            >
              {renderTool()}
            </Suspense>
          </div>
        </main>

        {/* Mobile Floating Bottom Navigation Dock */}
        <div className="lg:hidden h-14 bg-[#0a0a0d]/95 backdrop-blur-xl border-t border-zinc-800/80 flex items-center overflow-x-auto no-scrollbar px-3 gap-1.5 flex-shrink-0">
          {TOOLS.map((tool) => {
            const active = activeTool === tool.id;
            return (
              <button
                key={tool.id}
                onClick={() => setActiveTool(tool.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap flex-shrink-0 transition-all duration-200 ${
                  active
                    ? 'bg-white text-black font-semibold shadow-sm scale-[1.02]'
                    : 'text-zinc-400 bg-zinc-900/60 border border-zinc-800/60'
                }`}
              >
                <i className={`fas ${tool.icon} text-[10px]`}></i>
                <span>{tool.shortName}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default App;
