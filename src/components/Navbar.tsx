import React from 'react';
import { Film, Music, Sparkles, Server, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';

interface NavbarProps {
  currentTab: 'templates' | 'music-video' | 'ai-studio';
  setCurrentTab: (tab: 'templates' | 'music-video' | 'ai-studio') => void;
  onOpenProviders: () => void;
  providerStatus: Record<string, any>;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setCurrentTab,
  onOpenProviders,
  providerStatus
}) => {
  const hasCloudflare = providerStatus?.cloudflare?.configured;
  const hasAgnes = providerStatus?.agnes?.configured;

  return (
    <header className="sticky top-0 z-40 bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-500 to-fuchsia-500 p-0.5 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <div className="w-full h-full bg-zinc-950 rounded-[10px] flex items-center justify-center">
              <Film className="w-5 h-5 text-cyan-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg text-white tracking-wider font-mono">OPENMONTAGE</span>
              <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">
                Studio v2.0
              </span>
            </div>
            <p className="text-xs text-zinc-400 hidden sm:block">Agentic Video & Face Swap Montage Pipeline</p>
          </div>
        </div>

        {/* Studio Switcher Tabs */}
        <nav className="flex items-center bg-zinc-900/90 p-1 rounded-xl border border-zinc-800">
          <button
            onClick={() => setCurrentTab('templates')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              currentTab === 'templates'
                ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
            }`}
          >
            <Film className="w-4 h-4 text-cyan-400" />
            <span>Template Studio</span>
          </button>

          <button
            onClick={() => setCurrentTab('music-video')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              currentTab === 'music-video'
                ? 'bg-gradient-to-r from-fuchsia-950 to-indigo-950 text-fuchsia-200 shadow-sm border border-fuchsia-800'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
            }`}
          >
            <Music className="w-4 h-4 text-fuchsia-400" />
            <span>Music Video Studio</span>
            <span className="text-[10px] px-1.5 py-0.2 bg-fuchsia-500/20 text-fuchsia-300 rounded-full font-bold">NEW</span>
          </button>

          <button
            onClick={() => setCurrentTab('ai-studio')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              currentTab === 'ai-studio'
                ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
            }`}
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>AI Studio</span>
          </button>
        </nav>

        {/* External AI Tools */}
        <div className="hidden xl:flex items-center gap-2">
          <button
            onClick={() => window.open("https://aivideomerkezi.web.app/", "_blank", "noopener,noreferrer")}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyan-950/50 hover:bg-cyan-900/70 border border-cyan-800 text-xs font-medium text-cyan-300 transition-colors"
            title="I2V and Face Swap tools"
          >
            <Film className="w-3.5 h-3.5" />
            <span>I2V / Face Swap</span>
          </button>

          <button
            onClick={() => window.open("https://www.raomusic.com/", "_blank", "noopener,noreferrer")}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-fuchsia-950/50 hover:bg-fuchsia-900/70 border border-fuchsia-800 text-xs font-medium text-fuchsia-300 transition-colors"
            title="RaoMusic"
          >
            <Music className="w-3.5 h-3.5" />
            <span>Music</span>
          </button>

          <button
            onClick={() => window.open("https://www.aisongmaker.io/", "_blank", "noopener,noreferrer")}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-950/50 hover:bg-indigo-900/70 border border-indigo-800 text-xs font-medium text-indigo-300 transition-colors"
            title="AI Song Maker"
          >
            <Music className="w-3.5 h-3.5" />
            <span>AI Song Maker</span>
          </button>
        </div>

        {/* Right Info & Providers */}
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenProviders}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-mono text-zinc-300 transition-colors"
            title="Inspect Provider Configuration"
          >
            <Server className="w-3.5 h-3.5 text-zinc-400" />
            <span className="hidden md:inline">Providers:</span>
            <span className="flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${hasCloudflare || hasAgnes ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              <span className="text-zinc-400">CF / AGNES / HEDRA</span>
            </span>
          </button>

          <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-950/40 border border-emerald-900/60 text-[11px] text-emerald-400 font-mono">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>FFmpeg & Python Ready</span>
          </div>
        </div>
      </div>
    </header>
  );
};

