import React, { useState, useRef, useEffect } from 'react';
import { 
  Plus, Play, Pause, Trash2, Film, Layers, CheckCircle2, 
  AlertCircle, Shield, Upload, Clock, Sliders, Sparkles, Download, 
  Volume2, VolumeX, Eye, Check, RefreshCw, X, Video
} from 'lucide-react';
import { FaceSwapTemplate, MotionTemplate } from '../types';

interface TemplateStudioProps {
  faceSwapTemplates: FaceSwapTemplate[];
  motionTemplates: MotionTemplate[];
  isLoading: boolean;
  onRefreshTemplates: () => Promise<void>;
}

export const TemplateStudio: React.FC<TemplateStudioProps> = ({
  faceSwapTemplates,
  motionTemplates,
  isLoading,
  onRefreshTemplates
}) => {
  const [activeTab, setActiveTab] = useState<'faceswap' | 'motion'>('faceswap');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Add Template Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [uploadVideoFile, setUploadVideoFile] = useState<File | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateCategory, setTemplateCategory] = useState('Cinematic');
  const [templateDescription, setTemplateDescription] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadValidation, setUploadValidation] = useState<any>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Real Face Swap Render State
  const [selectedFsTemplate, setSelectedFsTemplate] = useState<FaceSwapTemplate | null>(null);
  const [faceImageFile, setFaceImageFile] = useState<File | null>(null);
  const [faceImagePreview, setFaceImagePreview] = useState<string | null>(null);
  const [featherBlend, setFeatherBlend] = useState(18);
  const [preserveAudio, setPreserveAudio] = useState(true);
  const [enhanceFace, setEnhanceFace] = useState(true);
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderLogs, setRenderLogs] = useState<string[]>([]);
  const [renderedVideoUrl, setRenderedVideoUrl] = useState<string | null>(null);

  // DIRECT_FACESWAP_UI_START
  const [swapMode, setSwapMode] = useState<'direct' | 'library'>('direct');
  const [directVideoFile, setDirectVideoFile] = useState<File | null>(null);
  const [directVideoPreview, setDirectVideoPreview] = useState<string | null>(null);
  const [directSessionId, setDirectSessionId] = useState<string | null>(null);
  const [directFaces, setDirectFaces] = useState<Array<{ id: string; index: number; preview_data_url: string; bbox: number[] }>>([]);
  const [directReferenceFiles, setDirectReferenceFiles] = useState<Record<number, File>>({});
  const [directReferencePreviews, setDirectReferencePreviews] = useState<Record<number, string>>({});
  const [isDetectingDirectFaces, setIsDetectingDirectFaces] = useState(false);
  const [isRenderingDirect, setIsRenderingDirect] = useState(false);
  const [directError, setDirectError] = useState<string | null>(null);
  const [directVideoUrl, setDirectVideoUrl] = useState<string | null>(null);
  const [directDownloadUrl, setDirectDownloadUrl] = useState<string | null>(null);
  const [directProgress, setDirectProgress] = useState<{ progress: number; stage: string; status: string; frame?: number; total_frames?: number; eta_seconds?: number | null; error?: string } | null>(null);

  useEffect(() => {
    const currentPreview = directVideoPreview;
    return () => {
      if (currentPreview && currentPreview.startsWith('blob:')) {
        URL.revokeObjectURL(currentPreview);
      }
    };
  }, [directVideoPreview]);

  const handleDirectVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setDirectVideoFile(file);
    setDirectVideoPreview(file ? URL.createObjectURL(file) : null);
    setDirectSessionId(null);
    setDirectFaces([]);
    setDirectReferenceFiles({});
    setDirectReferencePreviews({});
    setDirectVideoUrl(null);
    setDirectDownloadUrl(null);
    setDirectError(null);
  };

  const handleDetectDirectFaces = async () => {
    if (!directVideoFile) {
      setDirectError('Choose a video from your device first.');
      return;
    }

    setIsDetectingDirectFaces(true);
    setDirectError(null);
    setDirectSessionId(null);
    setDirectFaces([]);
    setDirectReferenceFiles({});
    setDirectReferencePreviews({});
    setDirectVideoUrl(null);
    setDirectDownloadUrl(null);

    try {
      const formData = new FormData();
      formData.append('video', directVideoFile);
      const response = await fetch('/api/faceswap-direct-detect', {
        method: 'POST',
        body: formData
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.detail || data.error || `Face detection failed (HTTP ${response.status}).`);
      }
      if (!Array.isArray(data.faces) || data.faces.length === 0 || !data.session_id) {
        throw new Error('No faces were returned for this video. Try a clear video with visible faces.');
      }
      setDirectSessionId(data.session_id);
      setDirectFaces(data.faces);
    } catch (err: any) {
      setDirectError(err.message || 'Could not detect faces in the selected video.');
    } finally {
      setIsDetectingDirectFaces(false);
    }
  };

  const handleDirectReferenceChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setDirectError(`Reference for Face ${index + 1} must be an image.`);
      return;
    }
    setDirectReferenceFiles(prev => ({ ...prev, [index]: file }));
    const reader = new FileReader();
    reader.onload = () => {
      setDirectReferencePreviews(prev => ({ ...prev, [index]: String(reader.result || '') }));
    };
    reader.readAsDataURL(file);
    setDirectError(null);
  };

  const handleExecuteDirectFaceSwap = async () => {
    if (!directSessionId || directFaces.length === 0 || !directVideoFile) {
      setDirectError('Önce bir video seç ve yüzleri tespit et.');
      return;
    }
    if (!Object.values(directReferenceFiles).some(Boolean)) {
      setDirectError('En az bir yüze referans fotoğrafı ata.');
      return;
    }

    const progressId = Array.from(window.crypto.getRandomValues(new Uint8Array(16)))
      .map(value => value.toString(16).padStart(2, '0')).join('');
    let pollTimer: number | undefined;
    let pollBusy = false;
    setIsRenderingDirect(true);
    setDirectError(null);
    setDirectVideoUrl(null);
    setDirectDownloadUrl(null);
    setDirectProgress({ progress: 1, stage: 'Video ve referanslar hazırlanıyor', status: 'running' });

    const pollProgress = async () => {
      if (pollBusy) return;
      pollBusy = true;
      try {
        const progressResponse = await fetch(`/api/faceswap-direct-progress/${progressId}`, { cache: 'no-store' });
        if (progressResponse.ok) {
          const progressData = await progressResponse.json();
          if (progressData.success && progressData.progress) setDirectProgress(progressData.progress);
        }
      } catch {
        // Progress polling is best-effort; the render request remains authoritative.
      } finally {
        pollBusy = false;
      }
    };

    try {
      const formData = new FormData();
      formData.append('session_id', directSessionId);
      formData.append('progress_id', progressId);
      formData.append('video', directVideoFile);
      formData.append('preserve_audio', preserveAudio ? 'true' : 'false');
      directFaces.forEach((_, index) => {
        const referenceFile = directReferenceFiles[index];
        if (referenceFile) formData.append(`face_${index}`, referenceFile);
      });

      pollTimer = window.setInterval(() => { void pollProgress(); }, 700);
      void pollProgress();
      const response = await fetch('/api/faceswap-direct-render', {
        method: 'POST',
        body: formData
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.detail || data.error || `Face Swap failed (HTTP ${response.status}).`);
      }
      setDirectVideoUrl(data.video_url || null);
      setDirectDownloadUrl(data.download_url || null);
      setDirectSessionId(null);
      setDirectProgress({ progress: 100, stage: 'Face Swap tamamlandı; video indirilmeye hazır', status: 'completed', eta_seconds: 0 });
    } catch (err: any) {
      const message = err.message || 'Direct Face Swap failed.';
      setDirectError(message);
      setDirectProgress(previous => ({
        progress: previous?.progress ?? 1,
        stage: 'Face Swap başarısız',
        status: 'error',
        error: message,
      }));
    } finally {
      if (pollTimer !== undefined) window.clearInterval(pollTimer);
      setIsRenderingDirect(false);
    }
  };
  // DIRECT_FACESWAP_UI_END

  // Motion Template Render State
  const [selectedMotionTemplate, setSelectedMotionTemplate] = useState<MotionTemplate | null>(null);
  const [motionHeadline, setMotionHeadline] = useState('');
  const [motionSubline, setMotionSubline] = useState('');
  const [motionColor, setMotionColor] = useState('#3B82F6');
  const [isRenderingMotion, setIsRenderingMotion] = useState(false);
  const [motionVideoUrl, setMotionVideoUrl] = useState<string | null>(null);

  // Auto-select first template on load
  useEffect(() => {
    if (faceSwapTemplates.length > 0 && !selectedFsTemplate) {
      setSelectedFsTemplate(faceSwapTemplates[0]);
    }
  }, [faceSwapTemplates]);

  // Categories list
  const categories = ['all', ...Array.from(new Set(faceSwapTemplates.map(t => t.category)))];

  const filteredFsTemplates = faceSwapTemplates.filter(t => {
    const matchesSearch = t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          t.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || t.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Handle Add Template Submit
  const handleAddTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadVideoFile) {
      setUploadError('Please select a local MP4 video file.');
      return;
    }
    if (!templateName.trim()) {
      setUploadError('Please provide a template name.');
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    setUploadValidation(null);

    const formData = new FormData();
    formData.append('video', uploadVideoFile);
    formData.append('name', templateName.trim());
    formData.append('category', templateCategory);
    formData.append('description', templateDescription);

    try {
      const response = await fetch('/api/faceswap-templates/add', {
        method: 'POST',
        body: formData
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to add Face Swap template');
      }

      setUploadValidation(data.validation);
      await onRefreshTemplates();
      setTimeout(() => {
        setIsUploading(false);
        setShowAddModal(false);
        setUploadVideoFile(null);
        setTemplateName('');
        setTemplateDescription('');
        setUploadValidation(null);
        if (data.template) {
          setSelectedFsTemplate(data.template);
        }
      }, 1000);
    } catch (err: any) {
      setIsUploading(false);
      setUploadError(err.message || 'An error occurred during template upload');
    }
  };

  // Handle Delete User Template
  const handleDeleteTemplate = async (template: FaceSwapTemplate, e: React.MouseEvent) => {
    e.stopPropagation();
    if (template.is_builtin) {
      alert('Built-in Face Swap templates are protected and cannot be deleted.');
      return;
    }

    if (!confirm(`Are you sure you want to delete template "${template.name}"?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/faceswap-templates/${template.id}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to delete template');
      }
      await onRefreshTemplates();
      if (selectedFsTemplate?.id === template.id) {
        setSelectedFsTemplate(faceSwapTemplates.find(t => t.id !== template.id) || null);
      }
    } catch (err: any) {
      alert(`Delete error: ${err.message}`);
    }
  };

  // Face Replacement Image Picker
  const handleFaceImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFaceImageFile(file);
      const reader = new FileReader();
      reader.onload = () => setFaceImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  // Execute Real Face Swap Pipeline
  const handleExecuteFaceSwap = async () => {
    if (!selectedFsTemplate) return;

    setIsRendering(true);
    setRenderProgress(10);
    setRenderedVideoUrl(null);
    setRenderLogs([
      `Initiating Real Face Swap pipeline for: ${selectedFsTemplate.name}`,
      `Template Video: ${selectedFsTemplate.width}x${selectedFsTemplate.height} @ ${selectedFsTemplate.fps}fps`,
      'Stage 1/5: Loading source template video & preserving audio streams...'
    ]);

    const formData = new FormData();
    formData.append('template_id', selectedFsTemplate.id);
    if (faceImageFile) {
      formData.append('face_image', faceImageFile);
    } else if (faceImagePreview) {
      formData.append('face_image_base64', faceImagePreview);
    }
    formData.append('feather_blend', featherBlend.toString());
    formData.append('preserve_audio', preserveAudio ? 'true' : 'false');
    formData.append('enhance_face', enhanceFace ? 'true' : 'false');

    // Simulate real pipeline stage feedback
    setTimeout(() => {
      setRenderProgress(35);
      setRenderLogs(prev => [...prev, 'Stage 2/5: InsightFace portrait detection & facial landmark alignment...']);
    }, 600);

    setTimeout(() => {
      setRenderProgress(65);
      setRenderLogs(prev => [...prev, 'Stage 3/5: Computing alpha feathering mask & skin-tone harmonization...']);
    }, 1200);

    setTimeout(() => {
      setRenderProgress(85);
      setRenderLogs(prev => [...prev, 'Stage 4/5: FFmpeg H.264 frame assembly & AAC audio track multiplexing...']);
    }, 1800);

    try {
      const response = await fetch('/api/faceswap-render', {
        method: 'POST',
        body: formData
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Face Swap pipeline execution failed');
      }

      setRenderProgress(100);
      setRenderLogs(prev => [
        ...prev,
        'Stage 5/5: Pipeline completed successfully!',
        `Render ID: ${data.render_id} (H.264 + preserved AAC audio)`
      ]);
      setRenderedVideoUrl(data.video_url);
    } catch (err: any) {
      setRenderLogs(prev => [...prev, `Error: ${err.message}`]);
    } finally {
      setIsRendering(false);
    }
  };

  // Render Motion Template
  const handleRenderMotion = async (template: MotionTemplate) => {
    setSelectedMotionTemplate(template);
    setMotionHeadline(template.default_params.headline);
    setMotionSubline(template.default_params.subline);
    setMotionColor(template.default_params.accent_color);
  };

  const handleExecuteMotionRender = async () => {
    if (!selectedMotionTemplate) return;
    setIsRenderingMotion(true);
    setMotionVideoUrl(null);

    try {
      const res = await fetch('/api/template-render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_id: selectedMotionTemplate.id,
          template_type: 'motion',
          headline: motionHeadline,
          subline: motionSubline,
          accent_color: motionColor
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Motion template render failed');
      setMotionVideoUrl(data.video_url);
    } catch (err: any) {
      alert(`Render error: ${err.message}`);
    } finally {
      setIsRenderingMotion(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Top Banner & Sub-Tabs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-zinc-800">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight flex items-center gap-3">
            <span>Template Studio</span>
            <span className="text-xs px-2.5 py-1 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800 font-mono">
              Production Suite
            </span>
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Real InsightFace face swap library and Remotion motion composition engine.
          </p>
        </div>

        {/* Sub Navigation */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-zinc-900 p-1 rounded-xl border border-zinc-800">
            <button
              onClick={() => setActiveTab('faceswap')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'faceswap'
                  ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-700 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Video className="w-4 h-4 text-cyan-400" />
              <span>Face Swap Templates ({faceSwapTemplates.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('motion')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'motion'
                  ? 'bg-zinc-800 text-white border border-zinc-700 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Layers className="w-4 h-4 text-amber-400" />
              <span>Motion Templates ({motionTemplates.length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 1. FACE SWAP TEMPLATES TAB */}
      {/* ========================================================================= */}
      {activeTab === 'faceswap' && (
        <div className="space-y-8">
          {/* Controls Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1 max-w-lg">
              <input
                type="text"
                placeholder="Search templates by name or style..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full px-3.5 py-2 bg-zinc-900/90 border border-zinc-800 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
              />
              <select
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value)}
                className="px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-zinc-300 focus:outline-none focus:border-cyan-500"
              >
                {categories.map(cat => (
                  <option key={cat} value={cat}>
                    {cat === 'all' ? 'All Categories' : cat}
                  </option>
                ))}
              </select>
            </div>

            {/* + ADD FACE SWAP TEMPLATE Button */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => onRefreshTemplates()}
                className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition-colors"
                title="Refresh Templates"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
              </button>

              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-medium text-sm shadow-lg shadow-cyan-500/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <Plus className="w-4 h-4 stroke-[2.5]" />
                <span>+ ADD FACE SWAP TEMPLATE</span>
              </button>
            </div>
          </div>

          {/* Face Swap Grid & Execution Workspace */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left 7 Columns: Templates Grid */}
            <div className="lg:col-span-7 space-y-4">
              <div className="flex items-center justify-between text-xs text-zinc-400 font-mono">
                <span>AVAILABLE TEMPLATES ({filteredFsTemplates.length})</span>
                <span>3 BUILT-IN • {faceSwapTemplates.filter(t => !t.is_builtin).length} USER ADDED</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {filteredFsTemplates.map(template => {
                  const isSelected = selectedFsTemplate?.id === template.id;
                  return (
                    <div
                      key={template.id}
                      onClick={() => setSelectedFsTemplate(template)}
                      className={`group relative rounded-xl border overflow-hidden cursor-pointer transition-all ${
                        isSelected
                          ? 'border-cyan-500 bg-zinc-900/90 shadow-lg shadow-cyan-500/10 ring-1 ring-cyan-500'
                          : 'border-zinc-800/80 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-900'
                      }`}
                    >
                      {/* Video Poster Preview */}
                      <div className="relative aspect-video bg-zinc-950 overflow-hidden">
                        <video
                          src={template.video_url}
                          poster={template.thumbnail_url}
                          muted
                          loop
                          playsInline
                          onMouseEnter={e => (e.target as HTMLVideoElement).play().catch(() => {})}
                          onMouseLeave={e => (e.target as HTMLVideoElement).pause()}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />

                        {/* Badges Overlay */}
                        <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 flex-wrap">
                          {template.is_builtin ? (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/80 text-emerald-400 border border-emerald-800/80 backdrop-blur-sm">
                              <Shield className="w-3 h-3" />
                              Built-in (Protected)
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-950/80 text-blue-300 border border-blue-800/80 backdrop-blur-sm">
                              User Added
                            </span>
                          )}

                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-black/60 text-zinc-300 backdrop-blur-sm">
                            {template.aspect_ratio}
                          </span>
                        </div>

                        {/* Top Right Duration & Audio */}
                        <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-black/70 text-zinc-200 backdrop-blur-sm">
                            <Clock className="w-3 h-3 text-cyan-400" />
                            {template.duration}s
                          </span>
                          {template.has_audio && (
                            <span className="p-1 rounded bg-black/70 text-zinc-300 backdrop-blur-sm" title="Template includes audio">
                              <Volume2 className="w-3 h-3 text-emerald-400" />
                            </span>
                          )}
                        </div>

                        {/* Hover Overlay Play Icon */}
                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                          <div className="w-10 h-10 rounded-full bg-cyan-500/80 text-white flex items-center justify-center shadow-lg">
                            <Play className="w-5 h-5 fill-white ml-0.5" />
                          </div>
                        </div>
                      </div>

                      {/* Card Info */}
                      <div className="p-4 space-y-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="font-semibold text-sm text-white group-hover:text-cyan-300 transition-colors line-clamp-1">
                              {template.title || template.name}
                            </h3>
                            <p className="text-xs text-zinc-400 line-clamp-1 mt-0.5">{template.category}</p>
                          </div>
                        </div>

                        <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                          {template.description}
                        </p>

                        {/* Specs & Status */}
                        <div className="pt-2 border-t border-zinc-800 flex items-center justify-between text-[11px] text-zinc-400">
                          <span className="font-mono text-zinc-400">{template.width}x{template.height} @ {template.fps}fps</span>

                          {template.face_detected && (
                            <span className="flex items-center gap-1 text-emerald-400">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Face detected
                            </span>
                          )}
                        </div>

                        {/* Card Actions */}
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            onClick={() => setSelectedFsTemplate(template)}
                            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all ${
                              isSelected
                                ? 'bg-cyan-500 text-black font-semibold'
                                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                            }`}
                          >
                            {isSelected ? '✓ Selected for Swap' : 'Use Template'}
                          </button>

                          {/* Delete (User Templates Only) */}
                          {!template.is_builtin && (
                            <button
                              onClick={(e) => handleDeleteTemplate(template, e)}
                              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-950/80 text-zinc-400 hover:text-rose-400 border border-zinc-700/60 transition-colors"
                              title="Delete User Template"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right 5 Columns: Real Face Swap Pipeline Panel */}
            <div className="lg:col-span-5 bg-zinc-900/80 rounded-2xl border border-zinc-800 p-5 space-y-5 sticky top-20 shadow-xl">
              <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-cyan-400" />
                  <h2 className="font-semibold text-white text-base">Real Face Swap Pipeline</h2>
                </div>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                  INSwapper + FFmpeg
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSwapMode('direct')}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold border transition-colors ${swapMode === 'direct' ? 'bg-cyan-500 text-black border-cyan-400' : 'bg-zinc-950 text-zinc-300 border-zinc-700 hover:border-cyan-700'}`}
                >OPEN BROWSER Â· DIRECT VIDEO</button>
                <button
                  type="button"
                  onClick={() => setSwapMode('library')}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold border transition-colors ${swapMode === 'library' ? 'bg-cyan-500 text-black border-cyan-400' : 'bg-zinc-950 text-zinc-300 border-zinc-700 hover:border-cyan-700'}`}
                >TEMPLATE LIBRARY</button>
              </div>

              {swapMode === 'direct' ? (
                <div className="space-y-4" data-direct-faceswap="true">
                  <div className="rounded-xl border border-cyan-900/70 bg-zinc-950 p-4 space-y-3">
                    <div>
                      <h3 className="text-sm font-semibold text-white">Use a video from your device</h3>
                      <p className="text-[11px] text-zinc-400 mt-1">No template is saved. The uploaded video is used for this one render only.</p>
                    </div>
                    <label className="block cursor-pointer rounded-lg border border-dashed border-zinc-700 bg-zinc-900 px-4 py-4 text-center hover:border-cyan-500">
                      <input
                        type="file"
                        accept="video/mp4,video/quicktime,video/webm,video/x-msvideo,.mp4,.mov,.m4v,.webm,.avi"
                        onChange={handleDirectVideoChange}
                        className="block w-full text-xs text-zinc-300 file:mr-3 file:rounded-md file:border-0 file:bg-cyan-950 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-cyan-300"
                      />
                      <span className="mt-2 block text-[10px] text-zinc-500">On a phone, use Browse / Choose File to select a video.</span>
                    </label>
                    {directVideoFile && (
                      <div className="text-xs text-zinc-300 truncate">Selected: {directVideoFile.name}</div>
                    )}
                    {directVideoPreview && (
                      <video src={directVideoPreview} controls muted playsInline className="w-full max-h-52 rounded-lg bg-black object-contain" />
                    )}
                    <button
                      type="button"
                      onClick={handleDetectDirectFaces}
                      disabled={!directVideoFile || isDetectingDirectFaces || isRenderingDirect}
                      className="w-full rounded-lg bg-cyan-600 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
                    >
                      {isDetectingDirectFaces ? 'Detecting facesâ€¦' : '1. Detect Faces in Video'}
                    </button>
                  </div>

                  {directFaces.length > 0 && (
                    <div className="space-y-3">
                      <div>
                        <h3 className="text-sm font-semibold text-white">Assign a reference photo to each face</h3>
                        <p className="text-[11px] text-zinc-400 mt-1">Face cards are initially ordered from left to right in the detection frame. Choose the photo that belongs to each face.</p>
                      </div>
                      <div className="space-y-3">
                        {directFaces.map((face, index) => (
                          <div key={`${face.id}-${index}`} className="grid grid-cols-[76px_minmax(0,1fr)] gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                            <div className="space-y-1">
                              <img src={face.preview_data_url} alt={`Detected Face ${index + 1}`} className="h-20 w-[76px] rounded-lg border border-zinc-700 object-cover bg-black" />
                              <div className="text-center text-[10px] font-semibold text-cyan-300">Face {index + 1}</div>
                            </div>
                            <div className="min-w-0 space-y-2">
                              <label className="block text-xs font-medium text-zinc-300">Reference photo</label>
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                onChange={e => handleDirectReferenceChange(index, e)}
                                className="block w-full text-[11px] text-zinc-300 file:mr-2 file:rounded-md file:border-0 file:bg-zinc-800 file:px-2 file:py-2 file:text-[11px] file:text-zinc-200"
                              />
                              {directReferencePreviews[index] && (
                                <div className="flex items-center gap-2">
                                  <img src={directReferencePreviews[index]} alt={`Reference for Face ${index + 1}`} className="h-10 w-10 rounded-md border border-emerald-700 object-cover" />
                                  <span className="truncate text-[11px] text-emerald-400">{directReferenceFiles[index]?.name || 'Reference selected'}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      <label className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3">
                        <span className="text-xs text-zinc-300">Preserve original video audio</span>
                        <input type="checkbox" checked={preserveAudio} onChange={e => setPreserveAudio(e.target.checked)} className="h-4 w-4 accent-cyan-500" />
                      </label>
                      <button
                        type="button"
                        onClick={handleExecuteDirectFaceSwap}
                        disabled={isRenderingDirect || isDetectingDirectFaces || !Object.values(directReferenceFiles).some(Boolean)}
                        className="w-full rounded-xl bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-900/30 disabled:opacity-50"
                      >
                        {isRenderingDirect ? 'Generating Face Swapâ€¦' : '2. Generate Face Swap'}
                      </button>
                    </div>
                  )}
                  {isDetectingDirectFaces && (
                    <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-xl border border-cyan-700/70 bg-zinc-950 p-3 text-xs text-cyan-100">
                      <span className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-cyan-300 border-t-transparent" />
                      <span>Detecting faces in your videoâ€¦</span>
                    </div>
                  )}
                  {/* DIRECT_RENDER_PROGRESS_UI */}
                  {directProgress && (
                    <div role="status" aria-live="polite" className="space-y-3 rounded-xl border border-cyan-800/80 bg-cyan-950/30 p-4 text-sm text-cyan-100">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          {isRenderingDirect && <span className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-cyan-300 border-t-transparent" />}
                          <span className="truncate font-semibold">{directProgress.stage}</span>
                        </div>
                        <strong className="shrink-0 tabular-nums">{Math.max(0, Math.min(100, Math.round(directProgress.progress)))}%</strong>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-zinc-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, Math.round(directProgress.progress)))}>
                        <div className={`h-full rounded-full transition-all duration-300 ${directProgress.status === 'error' ? 'bg-rose-500' : directProgress.status === 'completed' ? 'bg-emerald-500' : 'bg-cyan-400'}`} style={{ width: `${Math.max(0, Math.min(100, directProgress.progress))}%` }} />
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-300">
                        <span>{typeof directProgress.frame === 'number' && typeof directProgress.total_frames === 'number' && directProgress.total_frames > 0 ? `Kare ${Math.min(directProgress.frame, directProgress.total_frames).toLocaleString()} / ${directProgress.total_frames.toLocaleString()}` : directProgress.status === 'completed' ? 'İşlem tamamlandı' : directProgress.status === 'error' ? 'İşlem tamamlanamadı' : 'Video kareleri işleniyor'}</span>
                        <span>{isRenderingDirect && typeof directProgress.eta_seconds === 'number' && directProgress.eta_seconds > 0 ? `Tahmini kalan: ${Math.floor(directProgress.eta_seconds / 60)} dk ${Math.ceil(directProgress.eta_seconds % 60)} sn` : directProgress.status === 'completed' ? 'İndirmeye hazır' : directProgress.status === 'error' ? 'Hata ayrıntısı aşağıda' : isRenderingDirect ? 'Lütfen bu sayfayı açık tut' : ''}</span>
                      </div>
                    </div>
                  )}
                  {directError && (
                    <div role="alert" className="rounded-lg border border-rose-900 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">{directError}</div>
                  )}

                  {directVideoUrl && (
                    <div className="space-y-3 rounded-xl border border-emerald-800 bg-zinc-950 p-3">
                      <div className="text-sm font-semibold text-emerald-400">Face Swap ready</div>
                      <video src={directVideoUrl} controls playsInline className="w-full rounded-lg bg-black" />
                      {directDownloadUrl && (
                        <a
                          href={directDownloadUrl}
                          download="faceswap_rendered.mp4"
                          className="block rounded-lg bg-emerald-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-emerald-500"
                        >Download MP4 (temporary result is cleaned after download)</a>
                      )}
                    </div>
                  )}
                </div>
              ) : selectedFsTemplate ? (
                <div className="space-y-4">
                  {/* Selected Source Template Badge */}
                  <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-lg bg-zinc-900 overflow-hidden flex-shrink-0">
                        <video src={selectedFsTemplate.video_url} className="w-full h-full object-cover" muted />
                      </div>
                      <div>
                        <div className="text-xs text-cyan-400 font-mono">SELECTED SOURCE TEMPLATE</div>
                        <div className="text-sm font-semibold text-white">{selectedFsTemplate.name}</div>
                        <div className="text-[11px] text-zinc-400">{selectedFsTemplate.duration}s • {selectedFsTemplate.category}</div>
                      </div>
                    </div>
                    {selectedFsTemplate.has_audio && (
                      <span className="text-[10px] font-mono px-2 py-1 rounded bg-emerald-950 text-emerald-400 border border-emerald-900">
                        Audio Preserved
                      </span>
                    )}
                  </div>

                  {/* Face Image Upload */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-zinc-300 flex items-center justify-between">
                      <span>Replacement Face Image</span>
                      <span className="text-[11px] text-zinc-500">PNG or JPG portrait</span>
                    </label>

                    <div className="relative border-2 border-dashed border-zinc-700 hover:border-cyan-500 rounded-xl p-4 transition-colors text-center bg-zinc-950/50">
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleFaceImageChange}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                      {faceImagePreview ? (
                        <div className="flex items-center gap-3">
                          <img
                            src={faceImagePreview}
                            alt="Face Preview"
                            className="w-14 h-14 rounded-lg object-cover border border-cyan-500"
                          />
                          <div className="text-left flex-1">
                            <div className="text-xs font-medium text-white truncate">
                              {faceImageFile?.name || 'Selected Portrait'}
                            </div>
                            <div className="text-[11px] text-emerald-400 mt-0.5">✓ Ready for face alignment</div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setFaceImagePreview(null); setFaceImageFile(null); }}
                            className="p-1 rounded-md bg-zinc-800 text-zinc-400 hover:text-white"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-1 py-2">
                          <Upload className="w-6 h-6 text-zinc-400 mx-auto" />
                          <p className="text-xs text-zinc-300 font-medium">Click or drag & drop replacement face</p>
                          <p className="text-[11px] text-zinc-500">Clean front-facing portrait produces best results</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Pipeline Parameters */}
                  <div className="p-4 rounded-xl bg-zinc-950/70 border border-zinc-800 space-y-3">
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs text-zinc-300">
                        <span>Alpha Feathering Blend Radius</span>
                        <span className="font-mono text-cyan-400">{featherBlend}px</span>
                      </div>
                      <input
                        type="range"
                        min="5"
                        max="35"
                        value={featherBlend}
                        onChange={e => setFeatherBlend(parseInt(e.target.value, 10))}
                        className="w-full accent-cyan-500"
                      />
                      <p className="text-[10px] text-zinc-500">Seamless boundary smoothing between replacement face and template frame.</p>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-zinc-850">
                      <div>
                        <div className="text-xs font-medium text-zinc-300">Preserve Template Audio</div>
                        <div className="text-[10px] text-zinc-500">Mux original soundtrack into output MP4</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={preserveAudio}
                        onChange={e => setPreserveAudio(e.target.checked)}
                        className="w-4 h-4 accent-cyan-500 rounded"
                      />
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-zinc-850">
                      <div>
                        <div className="text-xs font-medium text-zinc-300">Face Landmark Realignment</div>
                        <div className="text-[10px] text-zinc-500">High precision 68-point feature warp</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={enhanceFace}
                        onChange={e => setEnhanceFace(e.target.checked)}
                        className="w-4 h-4 accent-cyan-500 rounded"
                      />
                    </div>
                  </div>

                  {/* Execute Button */}
                  <button
                    onClick={handleExecuteFaceSwap}
                    disabled={isRendering}
                    className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 disabled:opacity-50 text-white font-semibold text-sm shadow-lg shadow-cyan-500/25 flex items-center justify-center gap-2 transition-all"
                  >
                    {isRendering ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin text-white" />
                        <span>Rendering Face Swap Pipeline ({renderProgress}%)...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        <span>Execute Real Face Swap Pipeline</span>
                      </>
                    )}
                  </button>

                  {/* Terminal Execution Logs */}
                  {renderLogs.length > 0 && (
                    <div className="p-3 rounded-xl bg-black border border-zinc-800 text-[11px] font-mono space-y-1 text-zinc-400 max-h-36 overflow-y-auto">
                      <div className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider">PIPELINE TERMINAL OUTPUT</div>
                      {renderLogs.map((log, idx) => (
                        <div key={idx} className={log.includes('completed') ? 'text-emerald-400 font-bold' : log.includes('Error') ? 'text-rose-400 font-bold' : ''}>
                          › {log}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Render Output Result Video */}
                  {renderedVideoUrl && (
                    <div className="p-4 rounded-xl bg-zinc-950 border border-cyan-500/60 space-y-3 animate-in fade-in">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4" />
                          Face Swap Output Ready
                        </span>
                        <a
                          href={renderedVideoUrl}
                          download="faceswap_rendered.mp4"
                          className="flex items-center gap-1 px-2.5 py-1 rounded bg-cyan-950 hover:bg-cyan-900 text-cyan-300 text-xs font-medium border border-cyan-800"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download MP4</span>
                        </a>
                      </div>

                      <div className="rounded-lg overflow-hidden bg-black aspect-video border border-zinc-800">
                        <video src={renderedVideoUrl} controls autoPlay className="w-full h-full object-contain" />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-12 text-center text-zinc-500 text-sm">
                  Select a template from the library on the left to configure face swap.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. MOTION TEMPLATES TAB (14 Built-In Motion Compositions) */}
      {/* ========================================================================= */}
      {activeTab === 'motion' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span>Remotion Motion Templates</span>
                <span className="text-xs px-2 py-0.5 bg-amber-950 text-amber-400 rounded border border-amber-800 font-mono">
                  14 Compositions
                </span>
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Exact 14 Motion Templates preserved with dynamic typography, timing, and Remotion video rendering.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {motionTemplates.map(template => {
              const isSelected = selectedMotionTemplate?.id === template.id;
              return (
                <div
                  key={template.id}
                  className={`rounded-xl border p-4 space-y-3 transition-all ${
                    isSelected
                      ? 'border-amber-500 bg-zinc-900 ring-1 ring-amber-500'
                      : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-900'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-amber-400 font-semibold">{template.name}</span>
                    <span className="text-zinc-500">{template.duration}s</span>
                  </div>

                  <h3 className="font-semibold text-sm text-white">{template.title}</h3>
                  <p className="text-xs text-zinc-400 line-clamp-2">{template.description}</p>

                  <div className="flex flex-wrap gap-1">
                    {template.tags.map(tag => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                        {tag}
                      </span>
                    ))}
                  </div>

                  <button
                    onClick={() => handleRenderMotion(template)}
                    className="w-full mt-2 py-1.5 px-3 rounded-lg bg-zinc-800 hover:bg-amber-950 hover:text-amber-300 hover:border-amber-700 text-xs font-medium text-zinc-200 border border-zinc-700 transition-colors"
                  >
                    Customize & Render
                  </button>
                </div>
              );
            })}
          </div>

          {/* Motion Customizer Modal/Drawer */}
          {selectedMotionTemplate && (
            <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5 shadow-2xl">
                <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                  <div className="flex items-center gap-2">
                    <Layers className="w-5 h-5 text-amber-400" />
                    <h3 className="font-bold text-white text-base">Render Motion Template: {selectedMotionTemplate.name}</h3>
                  </div>
                  <button onClick={() => setSelectedMotionTemplate(null)} className="text-zinc-400 hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-300">Headline Title</label>
                    <input
                      type="text"
                      value={motionHeadline}
                      onChange={e => setMotionHeadline(e.target.value)}
                      className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-300">Subline Caption</label>
                    <input
                      type="text"
                      value={motionSubline}
                      onChange={e => setMotionSubline(e.target.value)}
                      className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-300">Accent Theme Color</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={motionColor}
                        onChange={e => setMotionColor(e.target.value)}
                        className="w-10 h-10 rounded border border-zinc-700 bg-transparent cursor-pointer"
                      />
                      <span className="font-mono text-xs text-zinc-400">{motionColor}</span>
                    </div>
                  </div>

                  <button
                    onClick={handleExecuteMotionRender}
                    disabled={isRenderingMotion}
                    className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold text-sm transition-all"
                  >
                    {isRenderingMotion ? 'Rendering Motion Composition...' : 'Render Motion Template MP4'}
                  </button>

                  {motionVideoUrl && (
                    <div className="p-3 bg-zinc-950 rounded-xl border border-amber-500 space-y-2">
                      <div className="flex items-center justify-between text-xs text-amber-300">
                        <span>✓ Motion Video Rendered</span>
                        <a href={motionVideoUrl} download={`${selectedMotionTemplate.name}.mp4`} className="underline">Download</a>
                      </div>
                      <video src={motionVideoUrl} controls autoPlay className="w-full rounded bg-black" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. ADD FACE SWAP TEMPLATE MODAL */}
      {/* ========================================================================= */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-cyan-400" />
                <h3 className="font-bold text-white text-lg">Add Face Swap Template</h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddTemplate} className="space-y-4">
              {/* Video File Upload */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300">Select Local MP4 Video</label>
                <div className="relative border-2 border-dashed border-zinc-700 hover:border-cyan-500 rounded-xl p-5 text-center bg-zinc-950 transition-colors">
                  <input
                    type="file"
                    accept="video/mp4"
                    required
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setUploadVideoFile(file);
                        if (!templateName) {
                          setTemplateName(file.name.replace(/\.[^/.]+$/, ''));
                        }
                      }
                    }}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  />
                  {uploadVideoFile ? (
                    <div className="flex items-center justify-center gap-3">
                      <Film className="w-6 h-6 text-cyan-400" />
                      <div className="text-left">
                        <div className="text-sm font-semibold text-white">{uploadVideoFile.name}</div>
                        <div className="text-xs text-zinc-400 font-mono">
                          {(uploadVideoFile.size / (1024 * 1024)).toFixed(1)} MB • MP4 Video
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Upload className="w-7 h-7 text-zinc-400 mx-auto" />
                      <p className="text-xs font-medium text-zinc-200">Click to choose or drag local MP4 video</p>
                      <p className="text-[11px] text-zinc-500">Supports 1080p, 4K, 16:9 landscape, and 9:16 vertical</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Template Name */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-300">Template Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Cyberpunk Alley Portrait 02"
                  value={templateName}
                  onChange={e => setTemplateName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* Category */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-300">Category</label>
                  <select
                    value={templateCategory}
                    onChange={e => setTemplateCategory(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-zinc-200 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="Cinematic">Cinematic</option>
                    <option value="Dance / Music">Dance / Music</option>
                    <option value="Fashion / Glamour">Fashion / Glamour</option>
                    <option value="Social Stories">Social Stories</option>
                    <option value="Commercial">Commercial</option>
                    <option value="Custom">Custom User</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-300">Storage Target</label>
                  <div className="px-3.5 py-2.5 bg-zinc-950/70 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-400 truncate">
                    backlot/media/source_templates/user/
                  </div>
                </div>
              </div>

              {/* Description */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-300">Description (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="Notes about lighting, framing, or character performance..."
                  value={templateDescription}
                  onChange={e => setTemplateDescription(e.target.value)}
                  className="w-full px-3.5 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* Validation Feedback */}
              {uploadValidation && (
                <div className="p-3 bg-emerald-950/60 border border-emerald-800 rounded-xl text-xs text-emerald-300 space-y-1">
                  <div className="font-semibold flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    Video Inspection & Face Suitability Passed
                  </div>
                  <div className="font-mono text-[11px] text-emerald-400">
                    Duration: {uploadValidation.duration}s • Res: {uploadValidation.resolution} • {uploadValidation.fps}fps
                  </div>
                  <div className="text-[11px] text-zinc-300">{uploadValidation.face_suitability}</div>
                </div>
              )}

              {uploadError && (
                <div className="p-3 bg-rose-950/60 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  <span>{uploadError}</span>
                </div>
              )}

              {/* Submit Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-zinc-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUploading}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 text-white font-semibold text-sm shadow-lg shadow-cyan-500/20 flex items-center gap-2"
                >
                  {isUploading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin text-white" />
                      <span>Validating & Registering Video...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      <span>Register Face Swap Template</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
