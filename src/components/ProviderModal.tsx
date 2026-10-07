import React from 'react';
import { X, Server, CheckCircle2, AlertCircle, ShieldAlert, Cpu } from 'lucide-react';

interface ProviderModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerStatus: Record<string, any>;
}

export const ProviderModal: React.FC<ProviderModalProps> = ({
  isOpen,
  onClose,
  providerStatus
}) => {
  if (!isOpen) return null;

  const providers = [
    {
      id: 'cloudflare',
      name: 'Cloudflare Workers AI',
      desc: 'Provides fast T2I (FLUX.1-schnell / SDXL) and I2I image keyframing.',
      envVar: 'CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID',
      status: providerStatus?.cloudflare?.status || 'Not Configured',
      configured: providerStatus?.cloudflare?.configured,
      capabilities: ['T2I (Keyframe Synthesis)', 'I2I (Style Transfer)']
    },
    {
      id: 'agnes',
      name: 'AGNES Video & Image Engine',
      desc: 'Core generative video pipeline supporting T2I, I2I, T2V (Text-to-Video), and I2V.',
      envVar: 'AGNES_API_KEY',
      status: providerStatus?.agnes?.status || 'Not Configured',
      configured: providerStatus?.agnes?.configured,
      capabilities: ['T2I', 'I2I', 'T2V (Text-to-Video)', 'I2V (Image-to-Video)']
    },
    {
      id: 'hedra',
      name: 'HEDRA Character Video',
      desc: 'High-realism talking character avatar video and performance sync.',
      envVar: 'HEDRA_API_KEY',
      status: providerStatus?.hedra?.status || 'Active / Quota Check',
      configured: providerStatus?.hedra?.configured,
      capabilities: ['Avatar Video Generation', 'Audio-Driven Lipsync']
    },
    {
      id: 'adobe',
      name: 'Adobe Creative Cloud Video API (Future Slot)',
      desc: 'Future-ready provider slot for Adobe Firefly Video & Audio mastering APIs. No mock endpoints are used.',
      envVar: 'ADOBE_CLIENT_ID / ADOBE_CLIENT_SECRET (Pending Approval)',
      status: 'Adobe provider not configured (Future slot)',
      configured: false,
      isFuture: true,
      capabilities: ['Firefly Video', 'Audio Mastering']
    }
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5 shadow-2xl animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-cyan-400" />
            <h3 className="font-bold text-white text-lg">Provider Integration Status</h3>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-zinc-400">
          OpenMontage connects to real provider backends without mock substitutions. Credentials are read securely from environment variables.
        </p>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {providers.map(p => (
            <div
              key={p.id}
              className={`p-4 rounded-xl border space-y-2 ${
                p.configured
                  ? 'bg-zinc-950 border-emerald-800/80'
                  : p.isFuture
                  ? 'bg-zinc-950/80 border-amber-900/60'
                  : 'bg-zinc-950 border-zinc-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white text-sm">{p.name}</span>
                  {p.isFuture && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800">
                      Future Slot
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 text-xs font-mono">
                  {p.configured ? (
                    <span className="text-emerald-400 flex items-center gap-1 font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Ready
                    </span>
                  ) : p.isFuture ? (
                    <span className="text-amber-400 flex items-center gap-1">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Pending Activation
                    </span>
                  ) : (
                    <span className="text-zinc-400 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                      Env Configured
                    </span>
                  )}
                </div>
              </div>

              <p className="text-xs text-zinc-400">{p.desc}</p>

              <div className="flex flex-wrap gap-1.5 pt-1">
                {p.capabilities.map(cap => (
                  <span key={cap} className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-800">
                    {cap}
                  </span>
                ))}
              </div>

              <div className="text-[11px] font-mono text-zinc-400 pt-1 border-t border-zinc-850 flex justify-between">
                <span>Config Key: {p.envVar}</span>
                <span>{p.status}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="pt-3 border-t border-zinc-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
