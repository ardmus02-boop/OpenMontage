import React, { useState, useRef, useEffect } from 'react';
import { 
  Music, Upload, Sparkles, Play, Pause, RefreshCw, CheckCircle2, 
  AlertCircle, Film, Clock, Sliders, Layers, Download, Image as ImageIcon,
  ChevronRight, Volume2, Video, Eye, ShieldAlert, Cpu
} from 'lucide-react';
import { MusicTrackInfo, MusicVideoScene } from '../types';

interface MusicVideoStudioProps {
  providerStatus: Record<string, any>;
}

export const MusicVideoStudio: React.FC<MusicVideoStudioProps> = ({ providerStatus }) => {
  // Step 1: Music Upload
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [musicInfo, setMusicInfo] = useState<MusicTrackInfo | null>(null);
  const [isAnalyzingAudio, setIsAnalyzingAudio] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Step 2: Visual Concept
  const [visualConcept, setVisualConcept] = useState(
    'Dark cinematic futuristic city at night, emotional female performer in chrome jacket, neon rain puddles, slow anamorphic lens flares'
  );

  // Step 3: Reference Image
  const [refImageFile, setRefImageFile] = useState<File | null>(null);
  const [refImagePreview, setRefImagePreview] = useState<string | null>(null);

  // Step 4: Style
  const [selectedStyle, setSelectedStyle] = useState('Cinematic');
  const [customStyleText, setCustomStyleText] = useState('');

  // Step 5: Provider & Video Specs
  const [selectedProvider, setSelectedProvider] = useState<'cloudflare' | 'agnes' | 'hedra' | 'adobe'>('agnes');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [clipDuration, setClipDuration] = useState(4); // seconds per clip

  // Scene Planning State
  const [scenes, setScenes] = useState<MusicVideoScene[]>([]);
  const [isPlanningScenes, setIsPlanningScenes] = useState(false);

  // Generation Execution State
  const [isGenerating, setIsGenerating] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState<string>('1. Analyzing music');
  const [generationProgress, setGenerationProgress] = useState(0);
  const [jobLogs, setJobLogs] = useState<string[]>([]);
  const [completedVideoUrl, setCompletedVideoUrl] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const stylePresets = [
    { name: 'Cinematic', desc: 'Anamorphic 35mm film grain, volumetric fog' },
    { name: 'Cyberpunk', desc: 'Neon holograms, rain reflections, chrome' },
    { name: 'Fashion', desc: 'High-fashion editorial, strobe studio lighting' },
    { name: 'Emotional', desc: 'Moody shadows, golden hour intimacy, melancholic' },
    { name: 'Fantasy', desc: 'Ethereal glowing bioluminescence, mystical' },
    { name: 'Realistic', desc: 'Documentary realism, organic handheld camera' },
    { name: 'Concert', desc: 'Stage lasers, stadium pyrotechnics, crowd silhouetted' },
    { name: 'Abstract', desc: 'Surreal fluid dynamics, geometric fractals' },
    { name: 'Music-Video', desc: 'High-contrast stylized MTV music video cuts' }
  ];

  const conceptPresets = [
    'Dark futuristic neon Tokyo alley with reflective puddles, emotional female singer, cinematic slow camera movement',
    'Golden hour desert expanse with vintage classic car, lone guitarist silhouette, atmospheric heat haze',
    'Gothic cathedral interior flooded with ethereal celestial beams, cloaked figures and floating dust motes',
    'Underground neon-lit rave warehouse with strobe bursts, dancing crowd silhouettes, heavy sub-bass pulses',
    'Sleek modern minimalist glass penthouse overlooking thunderstorm skyline, introspective piano performance'
  ];

  // Handle Music Upload
  const handleMusicUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAudioFile(file);
    setIsAnalyzingAudio(true);
    setAudioError(null);
    setMusicInfo(null);
    setCompletedVideoUrl(null);

    const formData = new FormData();
    formData.append('music', file);

    try {
      const response = await fetch('/api/music-video/upload', {
        method: 'POST',
        body: formData
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to upload and analyze audio');
      }

      setMusicInfo(data);
      // Automatically trigger scene planning
      planScenesForDuration(data.duration);
    } catch (err: any) {
      setAudioError(err.message || 'Error uploading music file');
    } finally {
      setIsAnalyzingAudio(false);
    }
  };

  // Plan Scenes
  const planScenesForDuration = async (durationSec: number) => {
    setIsPlanningScenes(true);
    try {
      const res = await fetch('/api/music-video/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          music_duration: durationSec,
          visual_concept: visualConcept,
          style: customStyleText || selectedStyle,
          clip_duration: clipDuration,
          aspect_ratio: aspectRatio
        })
      });
      const data = await res.json();
      if (data.success && data.scenes) {
        setScenes(data.scenes);
      }
    } catch (err) {
      console.error('Scene planning failed:', err);
    } finally {
      setIsPlanningScenes(false);
    }
  };

  // Reference Image Upload
  const handleRefImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setRefImageFile(file);
      const reader = new FileReader();
      reader.onload = () => setRefImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  // Generate Music Video
  const handleGenerateMusicVideo = async () => {
    if (!musicInfo) {
      setAudioError('Please upload an MP3 or WAV audio track first.');
      return;
    }

    if (selectedProvider === 'adobe') {
      setGenerationError(
        'Adobe provider not configured (Future provider slot: User has applied for Adobe API access; endpoint pending activation).'
      );
      return;
    }

    setIsGenerating(true);
    setGenerationError(null);
    setCompletedVideoUrl(null);
    setGenerationProgress(5);
    setCurrentStage('1. Analyzing music');
    setJobLogs([
      `Initiating OpenMontage Music Video pipeline...`,
      `Soundtrack: ${musicInfo.filename} (${musicInfo.duration}s, ${musicInfo.sample_rate}Hz)`,
      `Provider: ${selectedProvider.toUpperCase()}`,
      `Total montage scenes planned: ${scenes.length}`
    ]);

    const formData = new FormData();
    formData.append('music_url', musicInfo.music_url);
    formData.append('visual_concept', visualConcept);
    formData.append('style', customStyleText || selectedStyle);
    formData.append('aspect_ratio', aspectRatio);
    formData.append('provider', selectedProvider);
    formData.append('scenes_json', JSON.stringify(scenes));
    if (refImageFile) {
      formData.append('reference_image', refImageFile);
    }

    try {
      const response = await fetch('/api/music-video/generate', {
        method: 'POST',
        body: formData
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to initialize generation');
      }

      setJobId(data.job_id);

      // Poll job status
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/music-video/job/${data.job_id}`);
          const statusData = await statusRes.json();
          if (statusData.success && statusData.job) {
            const job = statusData.job;
            setCurrentStage(job.current_stage || 'Processing');
            setGenerationProgress(job.progress || 20);
            if (job.logs) setJobLogs(job.logs);

            if (job.status === 'completed') {
              clearInterval(pollInterval);
              setIsGenerating(false);
              setCompletedVideoUrl(job.video_url);
            } else if (job.status === 'failed') {
              clearInterval(pollInterval);
              setIsGenerating(false);
              setGenerationError(job.error || 'Music video generation failed.');
            }
          }
        } catch (e) {
          console.warn('Status poll warning:', e);
        }
      }, 1000);
    } catch (err: any) {
      setIsGenerating(false);
      setGenerationError(err.message || 'Generation failed to start');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight flex items-center gap-3">
              <span>Music Video Studio</span>
              <span className="text-xs px-2.5 py-1 rounded-full bg-gradient-to-r from-fuchsia-950 to-indigo-950 text-fuchsia-300 border border-fuchsia-800 font-mono">
                AI Soundtrack Suite
              </span>
            </h1>
          </div>
          <p className="text-sm text-zinc-400 mt-1">
            Turn your original music compositions into fully synchronized, AI-generated cinematic music videos.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400">
          <Volume2 className="w-4 h-4 text-fuchsia-400" />
          <span>Original Audio Preserved as Master Soundtrack</span>
        </div>
      </div>

      {/* Main Studio Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Creative Input Steps (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* STEP 1: Upload Music */}
          <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-fuchsia-950 text-fuchsia-400 border border-fuchsia-800 flex items-center justify-center font-bold text-xs">
                  1
                </div>
                <div>
                  <h3 className="font-semibold text-white text-sm">Upload Music Track</h3>
                  <p className="text-[11px] text-zinc-400">Accepts original MP3 or WAV audio compositions</p>
                </div>
              </div>

              {musicInfo && (
                <span className="text-xs font-mono text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Analyzed
                </span>
              )}
            </div>

            {/* Audio Upload Dropzone */}
            <div className="relative border-2 border-dashed border-zinc-700 hover:border-fuchsia-500 rounded-xl p-5 text-center bg-zinc-950/60 transition-colors">
              <input
                type="file"
                accept="audio/mp3,audio/wav,audio/mpeg"
                onChange={handleMusicUpload}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
              {musicInfo ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between bg-zinc-900 p-3 rounded-xl border border-zinc-800">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          if (audioRef.current) {
                            if (isPlayingAudio) audioRef.current.pause();
                            else audioRef.current.play();
                            setIsPlayingAudio(!isPlayingAudio);
                          }
                        }}
                        className="w-10 h-10 rounded-lg bg-fuchsia-500 text-black flex items-center justify-center font-bold shadow-md hover:bg-fuchsia-400 transition-colors"
                      >
                        {isPlayingAudio ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
                      </button>

                      <div className="text-left">
                        <div className="text-sm font-semibold text-white truncate max-w-xs">{musicInfo.filename}</div>
                        <div className="text-xs text-zinc-400 font-mono">
                          {musicInfo.duration}s • {musicInfo.sample_rate}Hz • {musicInfo.channels === 2 ? 'Stereo' : 'Mono'} • {musicInfo.bitrate}kbps
                        </div>
                      </div>
                    </div>

                    <span className="text-xs font-mono px-2 py-1 rounded bg-zinc-800 text-fuchsia-300">
                      {musicInfo.format.toUpperCase()}
                    </span>
                  </div>

                  <audio
                    ref={audioRef}
                    src={musicInfo.music_url}
                    onEnded={() => setIsPlayingAudio(false)}
                    className="hidden"
                  />
                </div>
              ) : (
                <div className="space-y-1 py-3">
                  <Music className="w-8 h-8 text-fuchsia-400 mx-auto" />
                  <p className="text-sm font-medium text-white">Click or drag & drop audio track</p>
                  <p className="text-xs text-zinc-400">MP3 or WAV format • Automatic tempo and duration detection</p>
                </div>
              )}
            </div>

            {isAnalyzingAudio && (
              <div className="flex items-center gap-2 text-xs text-fuchsia-400 font-mono">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Reading audio frequency spectrum & duration...</span>
              </div>
            )}

            {audioError && (
              <div className="p-3 bg-rose-950/60 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                <span>{audioError}</span>
              </div>
            )}
          </div>

          {/* STEP 2: Visual Concept */}
          <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-indigo-950 text-indigo-400 border border-indigo-800 flex items-center justify-center font-bold text-xs">
                2
              </div>
              <div>
                <h3 className="font-semibold text-white text-sm">Visual Concept & Mood</h3>
                <p className="text-[11px] text-zinc-400">Describe the atmosphere, performer, world, or narrative</p>
              </div>
            </div>

            <textarea
              rows={3}
              value={visualConcept}
              onChange={e => {
                setVisualConcept(e.target.value);
                if (musicInfo) planScenesForDuration(musicInfo.duration);
              }}
              placeholder="e.g. Dark cinematic futuristic city at night, emotional female performer, neon rain, slow camera movement..."
              className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500 leading-relaxed"
            />

            {/* Concept Quick Suggestions */}
            <div className="space-y-1.5">
              <div className="text-[11px] text-zinc-500 uppercase font-semibold tracking-wider">Concept Inspiration Presets:</div>
              <div className="flex flex-wrap gap-1.5">
                {conceptPresets.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setVisualConcept(preset);
                      if (musicInfo) planScenesForDuration(musicInfo.duration);
                    }}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-zinc-950 hover:bg-zinc-800 text-zinc-400 hover:text-indigo-300 border border-zinc-800 transition-colors text-left truncate max-w-sm"
                  >
                    {preset.substring(0, 48)}...
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* STEP 3 & 4: Reference Image & Visual Style */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Step 3: Reference Image */}
            <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-amber-950 text-amber-400 border border-amber-800 flex items-center justify-center font-bold text-xs">
                  3
                </div>
                <div>
                  <h3 className="font-semibold text-white text-sm">Reference Image</h3>
                  <p className="text-[10px] text-zinc-400">Optional character/mood continuity</p>
                </div>
              </div>

              <div className="relative border-2 border-dashed border-zinc-700 hover:border-amber-500 rounded-xl p-3 text-center bg-zinc-950 transition-colors">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleRefImageChange}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                />
                {refImagePreview ? (
                  <div className="flex items-center gap-3">
                    <img src={refImagePreview} alt="Reference" className="w-12 h-12 rounded-lg object-cover border border-amber-500" />
                    <div className="text-left flex-1 truncate">
                      <div className="text-xs text-white font-medium truncate">{refImageFile?.name}</div>
                      <div className="text-[10px] text-amber-400">Keyframe anchor active</div>
                    </div>
                  </div>
                ) : (
                  <div className="py-2 space-y-1">
                    <ImageIcon className="w-5 h-5 text-zinc-500 mx-auto" />
                    <p className="text-xs text-zinc-400">Drop reference image</p>
                  </div>
                )}
              </div>
            </div>

            {/* Step 4: Style */}
            <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-cyan-950 text-cyan-400 border border-cyan-800 flex items-center justify-center font-bold text-xs">
                  4
                </div>
                <div>
                  <h3 className="font-semibold text-white text-sm">Visual Style</h3>
                  <p className="text-[10px] text-zinc-400">Select or enter custom look</p>
                </div>
              </div>

              <select
                value={selectedStyle}
                onChange={e => {
                  setSelectedStyle(e.target.value);
                  if (musicInfo) planScenesForDuration(musicInfo.duration);
                }}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-200 focus:outline-none focus:border-cyan-500"
              >
                {stylePresets.map(s => (
                  <option key={s.name} value={s.name}>{s.name} — {s.desc}</option>
                ))}
              </select>

              <input
                type="text"
                placeholder="Or custom style keywords..."
                value={customStyleText}
                onChange={e => {
                  setCustomStyleText(e.target.value);
                  if (musicInfo) planScenesForDuration(musicInfo.duration);
                }}
                className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* STEP 5: Provider & Output Specs */}
          <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center justify-center font-bold text-xs">
                5
              </div>
              <div>
                <h3 className="font-semibold text-white text-sm">Provider & Video Assembly Specs</h3>
                <p className="text-[11px] text-zinc-400">Select generation backend, aspect ratio, and montage cuts</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
              {/* Cloudflare */}
              <button
                type="button"
                onClick={() => setSelectedProvider('cloudflare')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  selectedProvider === 'cloudflare'
                    ? 'border-cyan-500 bg-cyan-950/40 text-cyan-200 ring-1 ring-cyan-500'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                <div className="text-xs font-bold text-white">Cloudflare</div>
                <div className="text-[10px] text-zinc-400 mt-0.5">T2I Keyframes & Montage</div>
              </button>

              {/* AGNES */}
              <button
                type="button"
                onClick={() => setSelectedProvider('agnes')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  selectedProvider === 'agnes'
                    ? 'border-indigo-500 bg-indigo-950/40 text-indigo-200 ring-1 ring-indigo-500'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                <div className="text-xs font-bold text-white">AGNES</div>
                <div className="text-[10px] text-zinc-400 mt-0.5">T2V & I2V Video Engine</div>
              </button>

              {/* HEDRA */}
              <button
                type="button"
                onClick={() => setSelectedProvider('hedra')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  selectedProvider === 'hedra'
                    ? 'border-fuchsia-500 bg-fuchsia-950/40 text-fuchsia-200 ring-1 ring-fuchsia-500'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                <div className="text-xs font-bold text-white">HEDRA</div>
                <div className="text-[10px] text-zinc-400 mt-0.5">Character Avatar Video</div>
              </button>

              {/* Adobe (Future Slot) */}
              <button
                type="button"
                onClick={() => setSelectedProvider('adobe')}
                className={`p-3 rounded-xl border text-left transition-all opacity-85 ${
                  selectedProvider === 'adobe'
                    ? 'border-amber-500 bg-amber-950/40 text-amber-300 ring-1 ring-amber-500'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-500 hover:border-zinc-700'
                }`}
              >
                <div className="text-xs font-bold flex items-center justify-between text-zinc-300">
                  <span>Adobe</span>
                  <span className="text-[9px] px-1 py-0.2 rounded bg-amber-950 text-amber-400 border border-amber-900">Future</span>
                </div>
                <div className="text-[10px] text-zinc-500 mt-0.5">Pending API access</div>
              </button>
            </div>

            {/* Adobe Provider Warning if selected */}
            {selectedProvider === 'adobe' && (
              <div className="p-3 bg-amber-950/50 border border-amber-800 rounded-xl text-xs text-amber-300 flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">Adobe provider not configured (Future slot)</div>
                  <div className="text-[11px] text-amber-200/80">
                    Application for Adobe Video/Audio API submitted. The architecture preserves this provider slot without mock APIs. Please select Cloudflare, AGNES, or HEDRA to generate.
                  </div>
                </div>
              </div>
            )}

            {/* Specs Row */}
            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-zinc-850">
              <div className="space-y-1">
                <label className="text-xs font-medium text-zinc-300">Aspect Ratio</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['16:9', '9:16', '1:1'] as const).map(ratio => (
                    <button
                      key={ratio}
                      type="button"
                      onClick={() => setAspectRatio(ratio)}
                      className={`py-1.5 rounded-lg text-xs font-mono font-medium transition-colors ${
                        aspectRatio === ratio
                          ? 'bg-zinc-800 text-white border border-zinc-700'
                          : 'bg-zinc-950 text-zinc-500 border border-zinc-850 hover:text-zinc-300'
                      }`}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-zinc-300">Clip Cut Duration</label>
                <div className="grid grid-cols-3 gap-2">
                  {[3, 4, 6].map(dur => (
                    <button
                      key={dur}
                      type="button"
                      onClick={() => {
                        setClipDuration(dur);
                        if (musicInfo) planScenesForDuration(musicInfo.duration);
                      }}
                      className={`py-1.5 rounded-lg text-xs font-mono font-medium transition-colors ${
                        clipDuration === dur
                          ? 'bg-zinc-800 text-white border border-zinc-700'
                          : 'bg-zinc-950 text-zinc-500 border border-zinc-850 hover:text-zinc-300'
                      }`}
                    >
                      {dur}s / cut
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Timeline Scene Breakdown & Generator (5 cols) */}
        <div className="lg:col-span-5 space-y-6 sticky top-20">
          {/* Action & Generation Status Box */}
          <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-5 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div>
                <h3 className="font-semibold text-white text-base">Generate Music Video</h3>
                <p className="text-xs text-zinc-400">Syncs visual cuts to audio duration</p>
              </div>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-800 text-fuchsia-300">
                {scenes.length} Scenes
              </span>
            </div>

            {/* Launch Button */}
            <button
              onClick={handleGenerateMusicVideo}
              disabled={isGenerating || !musicInfo}
              className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-fuchsia-600 via-indigo-600 to-cyan-500 hover:from-fuchsia-500 hover:to-cyan-400 disabled:opacity-50 text-white font-bold text-sm shadow-lg shadow-fuchsia-500/25 flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.99]"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Generating Video ({generationProgress}%)...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Generate AI Music Video</span>
                </>
              )}
            </button>

            {/* Generation Progress Stages (7 Stages) */}
            {isGenerating && (
              <div className="space-y-3 pt-2">
                <div className="flex justify-between text-xs">
                  <span className="text-fuchsia-300 font-semibold">{currentStage}</span>
                  <span className="font-mono text-zinc-400">{generationProgress}%</span>
                </div>

                <div className="w-full h-2 bg-zinc-950 rounded-full overflow-hidden border border-zinc-800">
                  <div
                    className="h-full bg-gradient-to-r from-fuchsia-500 via-indigo-500 to-cyan-400 transition-all duration-300"
                    style={{ width: `${generationProgress}%` }}
                  />
                </div>

                {/* Stages List */}
                <div className="grid grid-cols-1 gap-1 text-[11px] font-mono text-zinc-400">
                  {[
                    '1. Analyzing music',
                    '2. Planning scenes',
                    '3. Generating visuals',
                    '4. Generating video clips',
                    '5. Assembling video & Adding soundtrack',
                    '7. Finalizing'
                  ].map((stageName, idx) => {
                    const isDone = currentStage.localeCompare(stageName) > 0 || currentStage === stageName;
                    const isCurrent = currentStage === stageName;
                    return (
                      <div
                        key={idx}
                        className={`flex items-center gap-2 ${
                          isCurrent ? 'text-fuchsia-300 font-bold' : isDone ? 'text-emerald-400' : 'text-zinc-600'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full bg-current" />
                        <span>{stageName}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Error Message */}
            {generationError && (
              <div className="p-3 bg-rose-950/70 border border-rose-800 rounded-xl text-xs text-rose-300 space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-rose-400" />
                  <span>Generation Halted</span>
                </div>
                <div className="text-[11px] text-zinc-300">{generationError}</div>
              </div>
            )}

            {/* Live Generation Logs */}
            {jobLogs.length > 0 && (
              <div className="p-3 bg-black rounded-xl border border-zinc-800 text-[11px] font-mono text-zinc-400 space-y-1 max-h-36 overflow-y-auto">
                <div className="text-zinc-500 text-[10px] uppercase font-bold">PIPELINE EXECUTION LOGS</div>
                {jobLogs.map((log, idx) => (
                  <div key={idx} className={log.includes('successfully') ? 'text-emerald-400' : ''}>
                    › {log}
                  </div>
                ))}
              </div>
            )}

            {/* Completed Output Video */}
            {completedVideoUrl && (
              <div className="p-4 bg-zinc-950 rounded-xl border border-fuchsia-500/70 space-y-3 animate-in fade-in">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    Final Music Video Rendered!
                  </span>
                  <a
                    href={completedVideoUrl}
                    download="openmontage_music_video.mp4"
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-fuchsia-950 hover:bg-fuchsia-900 text-fuchsia-300 text-xs font-medium border border-fuchsia-800"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download MP4</span>
                  </a>
                </div>

                <div className="rounded-lg overflow-hidden bg-black aspect-video border border-zinc-800">
                  <video src={completedVideoUrl} controls autoPlay className="w-full h-full object-contain" />
                </div>

                <div className="text-[11px] font-mono text-zinc-400 flex justify-between">
                  <span>Soundtrack: Original Track Muxed</span>
                  <span>Codec: H.264 / AAC</span>
                </div>
              </div>
            )}
          </div>

          {/* Timeline Breakdown Schedule Cards */}
          <div className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">Montage Scene Plan</h4>
              <span className="text-[11px] font-mono text-zinc-500">
                {musicInfo ? `${musicInfo.duration}s Total` : 'Waiting for track'}
              </span>
            </div>

            {scenes.length > 0 ? (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {scenes.map(scene => (
                  <div
                    key={scene.scene_number}
                    className="p-3 rounded-xl bg-zinc-950 border border-zinc-850 hover:border-zinc-700 text-xs space-y-1.5 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-fuchsia-300">
                        Scene {scene.scene_number}: {scene.section}
                      </span>
                      <span className="font-mono text-zinc-400 text-[11px]">
                        {scene.time_start}s - {scene.time_end}s ({scene.duration}s)
                      </span>
                    </div>

                    <div className="text-[11px] text-zinc-300 leading-snug">
                      {scene.prompt}
                    </div>

                    <div className="flex items-center gap-3 text-[10px] text-zinc-500 font-mono">
                      <span>Camera: {scene.camera_movement}</span>
                      <span>Lighting: {scene.lighting.split(' ')[0]}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-zinc-500">
                Upload an audio track on the left to generate the timeline scene schedule.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
