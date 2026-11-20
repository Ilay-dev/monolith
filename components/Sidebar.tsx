import React, { useState, useMemo } from 'react';
import { ToolId, TOOLS } from '../types';

interface SidebarProps {
  activeTool: ToolId;
  onSelectTool: (id: ToolId) => void;
  onCloseMobile?: () => void;
}

const CATEGORIES: Array<'Media' | 'Documents' | 'System'> = ['Media', 'Documents', 'System'];

const Sidebar: React.FC<SidebarProps> = ({ activeTool, onSelectTool, onCloseMobile }) => {
  const [search, setSearch] = useState('');

  const groupedTools = useMemo(() => {
    const q = search.trim().toLowerCase();
    return CATEGORIES.map((category) => ({
      category,
      items: TOOLS.filter(
        (t) =>
          t.category === category &&
          (!q ||
            t.name.toLowerCase().includes(q) ||
            t.tags.some((tag) => tag.toLowerCase().includes(q)))
      ),
    })).filter((group) => group.items.length > 0);
  }, [search]);

  return (
    <aside className="w-full h-full bg-[#0a0a0d]/95 backdrop-blur-xl border-r border-zinc-800/80 flex flex-col select-none">
      {/* Brand Header */}
      <div className="h-16 px-5 border-b border-zinc-800/80 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 bg-white text-black rounded-[4px] flex items-center justify-center shadow-sm flex-shrink-0">
            <div className="w-2 h-2 bg-black" />
          </div>
          <span className="font-semibold tracking-[0.18em] text-sm text-white uppercase">
            MONOLITH
          </span>
        </div>
        {onCloseMobile && (
          <button
            onClick={onCloseMobile}
            className="lg:hidden w-8 h-8 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white flex items-center justify-center"
            aria-label="Close sidebar"
          >
            <i className="fas fa-xmark text-xs"></i>
          </button>
        )}
      </div>

      {/* Search Bar */}
      <div className="p-3.5 border-b border-zinc-800/60">
        <div className="relative">
          <i className="fas fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-xs pointer-events-none"></i>
          <input
            type="text"
            placeholder="Search tools..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#111115] border border-zinc-800/90 rounded-lg pl-8 pr-7 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white text-xs"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Navigation Groups */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6 custom-scrollbar">
        {groupedTools.map((group) => (
          <div key={group.category} className="space-y-1.5">
            <div className="px-3 text-[11px] font-mono uppercase tracking-[0.14em] text-zinc-500 font-medium">
              {group.category}
            </div>
            <div className="space-y-1">
              {group.items.map((tool) => {
                const isActive = activeTool === tool.id;
                return (
                  <button
                    key={tool.id}
                    onClick={() => onSelectTool(tool.id)}
                    className={`relative w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-[13px] transition-all duration-200 group ${
                      isActive
                        ? 'bg-white text-black font-semibold shadow-md shadow-black/40 translate-x-0.5'
                        : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/80 hover:translate-x-0.5'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 transition-colors ${
                          isActive
                            ? 'bg-black/10 text-black'
                            : 'bg-zinc-900/90 text-zinc-400 group-hover:text-zinc-200 border border-zinc-800/80'
                        }`}
                      >
                        <i className={`fas ${tool.icon} text-xs`}></i>
                      </span>
                      <span className="truncate">{tool.name}</span>
                    </div>

                    {isActive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#ff4f00] flex-shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
};

export default Sidebar;
