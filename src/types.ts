export interface FaceSwapTemplate {
  id: string;
  name: string;
  title: string;
  description: string;
  category: string;
  is_builtin: boolean;
  duration: number;
  width: number;
  height: number;
  fps: number;
  has_audio: boolean;
  face_detected: boolean;
  face_suitability?: string;
  confidence?: number;
  aspect_ratio: string;
  video_url: string;
  thumbnail_url: string;
  filename?: string;
  tags?: string[];
  created_at?: string;
}

export interface MotionTemplate {
  id: string;
  name: string;
  title: string;
  description: string;
  category: string;
  duration: number;
  aspect_ratio: string;
  tags: string[];
  default_params: {
    headline: string;
    subline: string;
    accent_color: string;
  };
}

export interface MusicTrackInfo {
  music_url: string;
  filename: string;
  duration: number;
  sample_rate: number;
  channels: number;
  bitrate: number;
  format: string;
}

export interface MusicVideoScene {
  scene_number: number;
  section: string;
  time_start: number;
  time_end: number;
  duration: number;
  camera_movement: string;
  lighting: string;
  prompt: string;
  status: string;
}

export interface ProviderInfo {
  configured: boolean;
  name: string;
  capabilities: string[];
  status: string;
}
