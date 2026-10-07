import React, { useState } from 'react';
import { Sparkles, Image as ImageIcon, Video, Lock, Clock, Sliders, RefreshCw, AlertCircle, CheckCircle2, ShieldAlert } from 'lucide-react';

interface AiStudioProps {
  providerStatus: Record<string, any>;
}

export const AiStudio: React.FC<AiStudioProps> = ({ providerStatus }) => {
  const [mode, setMode] = useState<'t2i' | 'i2i' | 't2v' | 'i2v'>('t2v');
  const [prompt, setPrompt] = useState('Epic cinematic portrait of a cyberpunk hacker in neon rain, volumetric lighting, photorealistic 8k');
  const [provider, setProvider] = useState<'cloudflare' | 'agnes' | 'hedra' | 'adobe'>('agnes');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [duration, setDuration] = useState<5 | 8 | 10>(5);
  const [faceLock, setFaceLock] = useState(true);

  const [refImagePreview, setRefImagePreview] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedMediaUrl, setGeneratedMediaUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRefImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => setRefImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleGenerate = async () => {
    setError(null);
    if (provider === 'adobe') {
      setError('Adobe provider not configured (Future slot - Access requested). Please use Cloudflare, AGNES, or HEDRA.');
      return;
    }

    setIsGenerating(true);
    setGeneratedMediaUrl(null);

    const isVideo = mode === 't2v' || mode === 'i2v';
    const endpoint = isVideo ? '/api/ai/video/t2v' : '/api/ai/image/t2i';

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          provider,
          aspect_ratio: aspectRatio,
          duration: duration,
          face_lock: faceLock,
          reference_image: refImagePreview
        })
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Generation failed');
      }

      setGeneratedMediaUrl(isVideo ? data.video_url : data.image_url);
    } catch (err: any) {
      setError(err.message || 'Generation error');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="pb-6 border-b border-zinc-800">
        <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight flex items-center gap-3">
          <span>AI Studio</span>
          <span className="text-xs px-2.5 py-1 rounded-full bg-amber-950 text-amber-400 border border-amber-800 font-mono">
            Direct Generative Engine
          </span>
        </h1>
        <p className="text-sm text-zinc-400 mt-1">
          Direct multimodal pipeline for Cloudflare, AGNES, and HEDRA with Face Lock and reference control.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Form: 7 cols */}
        <div className="lg:col-span-7 space-y-6 bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6">
          {/* Mode Tabs */}
          <div className="grid grid-cols-4 gap-2 p-1.5 bg-zinc-950 rounded-xl border border-zinc-800 text-xs font-semibold">
            <button
              onClick={() => setMode('t2i')}
              className={`py-2 rounded-lg transition-all ${mode === 't2i' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              T2I (Image)
            </button>
            <button
              onClick={() => setMode('i2i')}
              className={`py-2 rounded-lg transition-all ${mode === 'i2i' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              I2I (Ref Image)
            </button>
            <button
              onClick={() => setMode('t2v')}
              className={`py-2 rounded-lg transition-all ${mode === 't2v' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              T2V (Video)
            </button>
            <button
              onClick={() => setMode('i2v')}
              className={`py-2 rounded-lg transition-all ${mode === 'i2v' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              I2V (Ref Video)
            </button>
          </div>

          {/* Prompt */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-300">Prompt</label>
            <textarea
              rows={3}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500"
            />
          </div>

          {/* Reference Image for I2I / I2V */}
          {(mode === 'i2i' || mode === 'i2v') && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-300">Reference Image (Required for I2I / I2V)</label>
              <div className="relative border-2 border-dashed border-zinc-700 hover:border-amber-500 rounded-xl p-4 text-center bg-zinc-950">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleRefImageUpload}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                />
                {refImagePreview ? (
                  <div className="flex items-center gap-3">
                    <img src={refImagePreview} alt="Ref" className="w-14 h-14 rounded-lg object-cover border border-amber-500" />
                    <span className="text-xs text-emerald-400 font-medium">✓ Reference loaded</span>
                  </div>
                ) : (
                  <div className="text-xs text-zinc-400">Click or drag reference image here</div>
                )}
              </div>
            </div>
          )}

          {/* Providers */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-300">Provider Backend</label>
            <div className="grid grid-cols-4 gap-2">
              {[
                { id: 'cloudflare', name: 'Cloudflare', sub: 'T2I / I2I' },
                { id: 'agnes', name: 'AGNES', sub: 'T2I / T2V / I2V' },
                { id: 'hedra', name: 'HEDRA', sub: 'Avatar Video' },
                { id: 'adobe', name: 'Adobe', sub: 'Future Slot' }
              ].map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProvider(p.id as any)}
                  className={`p-2.5 rounded-xl border text-left transition-all ${
                    provider === p.id
                      ? 'border-amber-500 bg-amber-950/40 text-amber-200 ring-1 ring-amber-500'
                      : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700'
                  }`}
                >
                  <div className="text-xs font-bold text-white">{p.name}</div>
                  <div className="text-[10px] text-zinc-500">{p.sub}</div>
                </button>
              ))}
            </div>

            {provider === 'adobe' && (
              <div className="p-3 bg-amber-950/50 border border-amber-800 rounded-xl text-xs text-amber-300 flex items-start gap-2 mt-2">
                <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <span>Adobe provider not configured (Future slot - Access requested).</span>
              </div>
            )}
          </div>

          {/* Controls: Aspect Ratio, Duration, Face Lock */}
          <div className="grid grid-cols-3 gap-4 pt-3 border-t border-zinc-850">
            {/* Aspect Ratio */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-300">Aspect Ratio</label>
              <div className="grid grid-cols-3 gap-1">
                {(['16:9', '9:16', '1:1'] as const).map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setAspectRatio(r)}
                    className={`py-1 rounded text-xs font-mono transition-colors ${
                      aspectRatio === r ? 'bg-zinc-800 text-white' : 'bg-zinc-950 text-zinc-500'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Duration */}
            {(mode === 't2v' || mode === 'i2v') && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-zinc-300">Duration</label>
                <div className="grid grid-cols-3 gap-1">
                  {([5, 8, 10] as const).map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDuration(d)}
                      className={`py-1 rounded text-xs font-mono transition-colors ${
                        duration === d ? 'bg-zinc-800 text-white' : 'bg-zinc-950 text-zinc-500'
                      }`}
                    >
                      {d}s
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Face Lock */}
            <div className="space-y-1 flex flex-col justify-end">
              <button
                type="button"
                onClick={() => setFaceLock(!faceLock)}
                className={`py-1.5 px-3 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                  faceLock
                    ? 'border-emerald-700 bg-emerald-950 text-emerald-300'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-500'
                }`}
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Face Lock: {faceLock ? 'ON' : 'OFF'}</span>
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 disabled:opacity-50 text-black font-bold text-sm shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition-all"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Generating {mode.toUpperCase()}...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Generate {mode.toUpperCase()}</span>
              </>
            )}
          </button>

          {error && (
            <div className="p-3 bg-rose-950/60 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Right Preview: 5 cols */}
        <div className="lg:col-span-5 space-y-4 bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 sticky top-20">
          <h3 className="font-semibold text-white text-base">Generation Output</h3>
          <div className="aspect-video rounded-xl bg-black border border-zinc-800 overflow-hidden flex items-center justify-center">
            {generatedMediaUrl ? (
              mode.includes('v') ? (
                <video src={generatedMediaUrl} controls autoPlay className="w-full h-full object-contain" />
              ) : (
                <img src={generatedMediaUrl} alt="Output" className="w-full h-full object-contain" />
              )
            ) : (
              <div className="text-center text-xs text-zinc-500 space-y-1">
                <Video className="w-8 h-8 text-zinc-600 mx-auto" />
                <p>Generated asset will appear here.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
