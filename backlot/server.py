"""Backlot server ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â FastAPI app: board state API, SSE change feed, media.

The watcher observes ``projects/`` with watchfiles; on any change it bumps a
per-project version and wakes SSE subscribers, who tell the browser to
refetch state. The server never writes to project directories.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import time
import uuid
import subprocess
import shutil
import urllib.request
import urllib.error
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from insightface.app import FaceAnalysis
from insightface.model_zoo import get_model

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from dotenv import load_dotenv
from imagekitio import ImageKit

from backlot.state import PROJECTS_DIR, REPO_ROOT, list_projects, load_board_state, summarize_project

UI_DIR = Path(__file__).resolve().parent / "ui"
load_dotenv(Path(__file__).resolve().parents[1] / '.env')
IMAGEKIT_PRIVATE_KEY = os.getenv('IMAGEKIT_PRIVATE_KEY', '').strip()
IMAGEKIT_URL_ENDPOINT = os.getenv('IMAGEKIT_URL_ENDPOINT', '').strip()
IMAGEKIT = ImageKit(private_key=IMAGEKIT_PRIVATE_KEY) if IMAGEKIT_PRIVATE_KEY else None
THUMB_CACHE_DIR = REPO_ROOT / ".backlot" / "thumbs"
THUMB_WIDTHS = (320, 640, 960)

# Paths inside a project whose changes are pure noise for the board.
_IGNORE_PARTS = {"node_modules", ".git", "__pycache__", ".cache"}

SSE_HEARTBEAT_SECONDS = 15
# ============================================================
# REAL FACE SWAP ENGINE - InsightFace + INSwapper
# ============================================================

_FACESWAP_APP = None
_FACESWAP_SWAPPER = None

def _get_faceswap_models():
    global _FACESWAP_APP, _FACESWAP_SWAPPER

    if _FACESWAP_APP is None:
        _FACESWAP_APP = FaceAnalysis(
            name="buffalo_l",
            providers=["CPUExecutionProvider"],
        )
        _FACESWAP_APP.prepare(ctx_id=0, det_size=(640, 640))

    if _FACESWAP_SWAPPER is None:
        model_env = os.getenv("INSWAPPER_MODEL_PATH", "").strip()
        model_candidates = []
        if model_env:
            model_candidates.append(Path(model_env).expanduser())
        model_candidates.extend([
            Path.home() / ".insightface" / "models" / "inswapper_128.onnx",
            REPO_ROOT / "backlot" / "models" / "inswapper_128.onnx",
        ])
        model_path = next(
            (candidate for candidate in model_candidates if candidate.is_file()),
            model_candidates[-1],
        )
        if not model_path.exists():
            raise FileNotFoundError(f"INSwapper model not found: {model_path}")
        _FACESWAP_SWAPPER = get_model(
            str(model_path),
            download=False,
            download_zip=False,
        )

    return _FACESWAP_APP, _FACESWAP_SWAPPER


def _run_inswapper_video(
    template_path: Path,
    source_face_path: Path,
    output_path: Path,
) -> tuple[float, int]:
    app, swapper = _get_faceswap_models()

    source_img = cv2.imread(str(source_face_path))
    if source_img is None:
        raise ValueError(f"Cannot read source face image: {source_face_path}")

    source_faces = app.get(source_img)
    if not source_faces:
        raise ValueError("No face detected in source face image.")

    source_face = max(
        source_faces,
        key=lambda f: float((f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
    )

    cap = cv2.VideoCapture(str(template_path))
    if not cap.isOpened():
        raise ValueError(f"Cannot open template video: {template_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    if width <= 0 or height <= 0:
        cap.release()
        raise ValueError("Invalid template video dimensions.")

    output_path.parent.mkdir(parents=True, exist_ok=True)

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(output_path), fourcc, fps, (width, height))

    if not writer.isOpened():
        cap.release()
        raise RuntimeError("Could not create temporary FaceSwap video.")

    processed = 0

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            faces = app.get(frame)

            for target_face in faces:
                frame = swapper.get(
                    frame,
                    target_face,
                    source_face,
                    paste_back=True,
                )

            writer.write(frame)
            processed += 1

    finally:
        cap.release()
        writer.release()

    if processed == 0:
        raise RuntimeError("No frames were processed.")

    duration = processed / fps if fps > 0 else 0.0
    return duration, frame_count

def _encode_faceswap_h264(
    processed_video: Path,
    original_video: Path,
    output_video: Path,
) -> None:
    output_video.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        "ffmpeg", "-y",
        "-i", str(processed_video),
        "-i", str(original_video),
        "-map", "0:v:0",
        "-map", "1:a?",
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        str(output_video),
    ]

    result = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    if result.returncode != 0:
        raise RuntimeError(
            f"FFmpeg H.264 encoding failed: {result.stderr[-2000:]}"
        )

    if not output_video.exists() or output_video.stat().st_size == 0:
        raise RuntimeError("FFmpeg produced an empty FaceSwap output.")

def _execute_faceswap_pipeline(
    template_id: str,
    source_face_path: Path,
    preserve_audio: bool = True,
) -> dict:
    template_path = _find_faceswap_template(template_id)

    render_id = uuid.uuid4().hex[:12]
    temp_dir = REPO_ROOT / "backlot" / "media" / "faceswap_temp"
    render_dir = REPO_ROOT / "backlot" / "media" / "faceswap_temp"

    temp_video = temp_dir / f"{render_id}_raw.mp4"
    output_video = render_dir / f"{render_id}_faceswap.mp4"

    duration, _ = _run_inswapper_video(
        template_path,
        source_face_path,
        temp_video,
    )

    if preserve_audio:
        _encode_faceswap_h264(
            temp_video,
            template_path,
            output_video,
        )
    else:
        output_video.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", str(temp_video),
                "-c:v", "libx264",
                "-preset", "medium",
                "-crf", "18",
                "-pix_fmt", "yuv420p",
                str(output_video),
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

    with suppress(Exception):
        temp_video.unlink(missing_ok=True)

    video_url = f"/api/faceswap-download/{render_id}"

    return {
        "success": True,
        "render_id": render_id,
        "video_url": video_url,
        "duration": duration,
    }

# DIRECT_FACESWAP_ENGINE_START
_DIRECT_FACESWAP_SESSIONS: dict[str, dict] = {}


def _cleanup_direct_faceswap_sessions(max_age_seconds: int = 1800) -> None:
    now = time.time()
    for session_id, session in list(_DIRECT_FACESWAP_SESSIONS.items()):
        try:
            created_at = float(session.get("created_at", now))
        except (TypeError, ValueError):
            created_at = now
        if now - created_at > max_age_seconds:
            session_dir = session.get("session_dir")
            if session_dir:
                shutil.rmtree(Path(session_dir), ignore_errors=True)
            _DIRECT_FACESWAP_SESSIONS.pop(session_id, None)

def _direct_face_center(face):
    box = face.bbox
    return np.array(
        [(float(box[0]) + float(box[2])) / 2,
         (float(box[1]) + float(box[3])) / 2],
        dtype=np.float32,
    )


def _direct_face_embedding(face):
    value = getattr(face, "normed_embedding", None)
    if value is None:
        value = getattr(face, "embedding", None)
    if value is None:
        raise ValueError("A detected face has no usable embedding.")
    value = np.asarray(value, dtype=np.float32)
    norm = float(np.linalg.norm(value))
    if norm <= 0:
        raise ValueError("A detected face has an invalid embedding.")
    return value / norm


def _detect_direct_video_faces(video_path: Path) -> dict:
    app, _ = _get_faceswap_models()
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise ValueError("Cannot open the uploaded video.")

    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if width <= 0 or height <= 0:
            raise ValueError("The uploaded video has invalid dimensions.")

        search_limit = min(frame_count or int(fps * 10), int(fps * 10))
        step = max(1, int(fps * 0.5))
        found_faces = None
        found_frame = 0
        found_image = None

        for frame_index in range(max(1, search_limit)):
            if frame_index % step:
                continue
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
            ok, frame = cap.read()
            if not ok:
                break

            current = app.get(frame)
            if current:
                found_faces = sorted(
                    current,
                    key=lambda face: float((face.bbox[0] + face.bbox[2]) / 2),
                )
                found_frame = frame_index
                found_image = frame
                break

        if not found_faces or found_image is None:
            raise ValueError(
                "No faces were detected in the first 10 seconds. "
                "Try a video where faces are clearly visible near the beginning."
            )

        previews = []
        for index, face in enumerate(found_faces):
            x1, y1, x2, y2 = [int(round(float(v))) for v in face.bbox]
            pad_x = max(8, int((x2 - x1) * 0.25))
            pad_y = max(8, int((y2 - y1) * 0.25))
            x1 = max(0, x1 - pad_x)
            y1 = max(0, y1 - pad_y)
            x2 = min(width, x2 + pad_x)
            y2 = min(height, y2 + pad_y)
            crop = found_image[y1:y2, x1:x2]
            if crop.size == 0:
                continue

            encoded_ok, encoded = cv2.imencode(".jpg", crop)
            if not encoded_ok:
                continue

            previews.append({
                "id": f"face_{index}",
                "index": index,
                "preview_data_url": (
                    "data:image/jpeg;base64,"
                    + base64.b64encode(encoded.tobytes()).decode("ascii")
                ),
                "bbox": [x1, y1, x2, y2],
            })

        if not previews:
            raise ValueError("Faces were detected, but previews could not be created.")

        return {
            "seed_frame_index": found_frame,
            "duration": frame_count / fps if frame_count > 0 else 0,
            "faces": previews,
        }
    finally:
        cap.release()


def _emit_direct_faceswap_progress(
    progress_id: str | None,
    progress: int,
    stage: str,
    **details,
) -> None:
    if not progress_id or len(progress_id) != 32 or any(ch not in "0123456789abcdefABCDEF" for ch in progress_id):
        return
    try:
        display_stage = str(stage)
        # Repair the known UTF-8-as-Windows-1252 text variants without touching video processing.
        for bad, good in (
            ("i\u00c5\u0178", "i\u015f"),
            ("L\u00c3\u00bc", "L\u00fc"),
            ("\u00c4\u00b1", "\u0131"),
            ("\u00c3\u00a7", "\u00e7"),
            ("\u00c4\u0178", "\u011f"),
            ("\u00c3\u00b6", "\u00f6"),
            ("\u00c5\u017e", "\u015e"),
            ("\u00c4\u00b0", "\u0130"),
            ("\u00c3\u0153", "\u00dc"),
            ("\u00c3\u2021", "\u00c7"),
            ("\u00c3\u2013", "\u00d6"),
        ):
            display_stage = display_stage.replace(bad, good)

        payload = {
            "progress": max(0, min(100, int(progress))),
            "stage": display_stage,
            "updated_at": int(time.time() * 1000),
        }
        payload.update(details)
        progress_dir = REPO_ROOT / "backlot" / "media" / "faceswap_temp"
        progress_dir.mkdir(parents=True, exist_ok=True)
        progress_path = progress_dir / f"{progress_id}_progress.json"
        temporary_path = progress_dir / f"{progress_id}_{os.getpid()}.progress.tmp"
        temporary_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        temporary_path.replace(progress_path)
        # Keep stdout events too; the sidecar is the reliable channel when stdout is buffered.
        print("__DIRECT_FACESWAP_PROGRESS__" + json.dumps(payload, ensure_ascii=True), flush=True)
    except Exception as exc:
        print(f"[Direct FaceSwap] Progress update failed: {exc}", flush=True)

def _run_inswapper_video_multi(
    video_path: Path,
    reference_paths: list[Path | None],
    output_path: Path,
    seed_frame_index: int,
    progress_id: str | None = None,
) -> tuple[float, int]:
    """Swap only selected faces and emit actual frame-based progress for the UI."""
    started = time.monotonic()
    _emit_direct_faceswap_progress(progress_id, 4, "Referans fotoÄŸraflarÄ± hazÄ±rlanÄ±yor")
    app, swapper = _get_faceswap_models()
    source_faces = []

    for reference_path in reference_paths:
        if reference_path is None:
            source_faces.append(None)
            continue
        image = cv2.imread(str(reference_path))
        if image is None:
            raise ValueError(f"Cannot read source reference image: {reference_path.name}")
        found = app.get(image)
        if not found:
            raise ValueError(f"No face detected in reference image: {reference_path.name}")
        source_faces.append(
            max(
                found,
                key=lambda face: float(
                    (face.bbox[2] - face.bbox[0]) * (face.bbox[3] - face.bbox[1])
                ),
            )
        )

    if not any(face is not None for face in source_faces):
        raise ValueError("Choose a reference image for at least one detected face.")

    _emit_direct_faceswap_progress(progress_id, 9, "Referans yÃ¼zler hazÄ±r; video aÃ§Ä±lÄ±yor")
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise ValueError(f"Cannot open the uploaded video for rendering: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if width <= 0 or height <= 0:
        cap.release()
        raise ValueError("Invalid uploaded video dimensions.")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(
        str(output_path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height)
    )
    if not writer.isOpened():
        cap.release()
        raise RuntimeError("Could not create the temporary Face Swap video.")

    tracks = None
    processed = 0
    diagonal = max(1.0, float(np.hypot(width, height)))
    report_every = max(1, int(fps * 0.5))
    _emit_direct_faceswap_progress(
        progress_id, 10, "Video kareleri iÅŸleniyor", frame=0,
        total_frames=frame_count if frame_count > 0 else None,
        elapsed_seconds=0, eta_seconds=None,
    )

    def report_progress(current_frame: int) -> None:
        elapsed = max(0.1, time.monotonic() - started)
        if frame_count > 0:
            bounded_frame = min(current_frame, frame_count)
            pct = 10 + round(75 * bounded_frame / frame_count)
            eta = round(elapsed * max(0, frame_count - bounded_frame) / max(1, bounded_frame))
        else:
            pct = min(84, 10 + int(elapsed / 2))
            eta = None
        _emit_direct_faceswap_progress(
            progress_id, pct, "Video kareleri iÅŸleniyor", frame=current_frame,
            total_frames=frame_count if frame_count > 0 else None,
            elapsed_seconds=round(elapsed, 1), eta_seconds=eta,
        )

    try:
        frame_index = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            if frame_index < seed_frame_index:
                writer.write(frame)
                processed += 1
                frame_index += 1
                if processed % report_every == 0:
                    report_progress(processed)
                continue

            target_faces = app.get(frame)
            if tracks is None:
                target_faces = sorted(
                    target_faces,
                    key=lambda face: float((face.bbox[0] + face.bbox[2]) / 2),
                )
                if len(target_faces) != len(source_faces):
                    raise ValueError(
                        "The number of detected faces changed between detection and rendering. "
                        "Please run Detect Faces again and retry."
                    )

                tracks = []
                for index, target in enumerate(target_faces):
                    source_face = source_faces[index]
                    if source_face is None:
                        continue
                    tracks.append({
                        "embedding": _direct_face_embedding(target),
                        "center": _direct_face_center(target),
                        "source": source_face,
                    })
                    frame = swapper.get(frame, target, source_face, paste_back=True)
                if not tracks:
                    raise ValueError("Choose a reference image for at least one detected face.")
            else:
                candidates = []
                embedding_map = {}
                center_map = {}
                for face_index, face in enumerate(target_faces):
                    try:
                        embedding = _direct_face_embedding(face)
                        center = _direct_face_center(face)
                    except ValueError:
                        continue
                    embedding_map[face_index] = embedding
                    center_map[face_index] = center

                for track_index, track in enumerate(tracks):
                    for face_index, embedding in embedding_map.items():
                        similarity = float(np.clip(np.dot(track["embedding"], embedding), -1, 1))
                        distance = float(np.linalg.norm(track["center"] - center_map[face_index]) / diagonal)
                        cost = 0.82 * ((1.0 - similarity) / 2.0) + 0.18 * min(distance, 1.5)
                        candidates.append((cost, track_index, face_index))

                used_tracks = set()
                used_faces = set()
                matches = []
                for cost, track_index, face_index in sorted(candidates):
                    if cost > 0.62 or track_index in used_tracks or face_index in used_faces:
                        continue
                    used_tracks.add(track_index)
                    used_faces.add(face_index)
                    matches.append((track_index, face_index))

                for track_index, face_index in matches:
                    face = target_faces[face_index]
                    track = tracks[track_index]
                    frame = swapper.get(frame, face, track["source"], paste_back=True)
                    updated = 0.85 * track["embedding"] + 0.15 * embedding_map[face_index]
                    norm = float(np.linalg.norm(updated))
                    if norm > 0:
                        track["embedding"] = updated / norm
                    track["center"] = center_map[face_index]

            writer.write(frame)
            processed += 1
            frame_index += 1
            if processed % report_every == 0 or (frame_count > 0 and processed >= frame_count):
                report_progress(processed)
    finally:
        cap.release()
        writer.release()

    if processed == 0:
        raise RuntimeError("No video frames were processed.")
    duration = processed / fps if fps > 0 else 0.0
    _emit_direct_faceswap_progress(
        progress_id, 86, "Video kareleri tamamlandÄ±; Ã§Ä±ktÄ± hazÄ±rlanÄ±yor",
        frame=processed, total_frames=frame_count if frame_count > 0 else None,
        elapsed_seconds=round(time.monotonic() - started, 1), eta_seconds=0,
    )
    return duration, processed

def _execute_direct_faceswap_pipeline(
    session_id: str,
    reference_paths: list[Path | None],
    preserve_audio: bool,
) -> dict:
    session = _DIRECT_FACESWAP_SESSIONS.get(session_id)
    if not session:
        raise ValueError("Direct Face Swap session expired. Select the video again.")

    session_dir = Path(session["session_dir"])
    video_path = Path(session["video_path"])
    temp_dir = REPO_ROOT / "backlot" / "media" / "faceswap_temp"
    temp_dir.mkdir(parents=True, exist_ok=True)

    render_id = uuid.uuid4().hex[:12]
    raw_video = temp_dir / f"{render_id}_raw.mp4"
    output_video = temp_dir / f"{render_id}_faceswap.mp4"

    try:
        duration, _ = _run_inswapper_video_multi(
            video_path,
            reference_paths,
            raw_video,
            int(session["seed_frame_index"]),
        )

        if preserve_audio:
            _encode_faceswap_h264(raw_video, video_path, output_video)
        else:
            result = subprocess.run(
                [
                    "ffmpeg", "-y", "-i", str(raw_video),
                    "-c:v", "libx264", "-preset", "medium",
                    "-crf", "18", "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart", "-an", str(output_video),
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            if result.returncode != 0:
                raise RuntimeError(
                    f"FFmpeg encoding failed: {result.stderr[-1500:]}"
                )

        if not output_video.exists() or output_video.stat().st_size == 0:
            raise RuntimeError("The Face Swap output video is empty.")

        return {
            "success": True,
            "render_id": render_id,
            "duration": duration,
            "video_url": f"/backlot/media/faceswap_temp/{render_id}_faceswap.mp4",
            "download_url": f"/api/faceswap-direct-download/{render_id}",
        }
    except Exception:
        with suppress(Exception):
            output_video.unlink(missing_ok=True)
        raise
    finally:
        with suppress(Exception):
            raw_video.unlink(missing_ok=True)
        shutil.rmtree(session_dir, ignore_errors=True)
        _DIRECT_FACESWAP_SESSIONS.pop(session_id, None)


# DIRECT_FACESWAP_ENGINE_END

def _find_faceswap_template(template_id: str) -> Path:
    metadata_path = REPO_ROOT / "backlot" / "media" / "source_templates" / "user_templates.json"
    user_dir = REPO_ROOT / "backlot" / "media" / "source_templates" / "user"

    if metadata_path.exists():
        try:
            templates = json.loads(metadata_path.read_text(encoding="utf-8"))
            for item in templates:
                if str(item.get("id")) == str(template_id):
                    filename = item.get("filename")
                    if filename:
                        video_path = user_dir / filename
                        if video_path.exists():
                            return video_path
        except Exception as exc:
            print(f"[FaceSwap] Template metadata read failed: {exc}", flush=True)

    direct_path = user_dir / f"{template_id}.mp4"
    if direct_path.exists():
        return direct_path

    raise FileNotFoundError(f"FaceSwap template video not found: {template_id}")

def _upload_to_imagekit(file_path: Path, folder: str = "/openmontage") -> Optional[str]:
    if IMAGEKIT is None or not IMAGEKIT_PRIVATE_KEY:
        return None
    try:
        with file_path.open("rb") as f:
            result = IMAGEKIT.files.upload(
                file=f,
                file_name=file_path.name,
                folder=folder,
                use_unique_file_name=True,
            )
        return result.url
    except Exception as exc:
        print(f"[ImageKit] Upload failed: {exc}", flush=True)
        return None


def _ui_html(name: str, assets: tuple[str, ...]) -> HTMLResponse:
    html = (UI_DIR / name).read_text(encoding="utf-8")
    for asset in assets:
        path = UI_DIR / asset
        if path.is_file():
            version = str(int(path.stat().st_mtime))
            html = html.replace(f"/ui/{asset}", f"/ui/{asset}?v={version}")
    return HTMLResponse(html)


class ChangeHub:
    """Fan-out of project-change notifications to SSE subscribers.

    Subscriptions are filtered: a board subscribed to one project only ever
    receives that project's ids, so unrelated-project bursts can't flood its
    queue and starve out the one notification it actually needs.
    """

    def __init__(self) -> None:
        self._subscribers: dict[asyncio.Queue, Optional[str]] = {}

    def subscribe(self, project_id: Optional[str] = None) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=64)
        self._subscribers[q] = project_id
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.pop(q, None)

    def publish(self, project_id: str) -> None:
        for q, only in list(self._subscribers.items()):
            if only is not None and only != project_id:
                continue
            try:
                q.put_nowait(project_id)
            except asyncio.QueueFull:
                # Queue holds only THIS subscriber's relevant ids, so a full
                # queue already guarantees a pending wake-up ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ safe to drop.
                pass


hub = ChangeHub()

# Library summaries are expensive to derive (full state parse per project);
# cache per project and invalidate from the watcher.
_summary_cache: dict[str, dict] = {}


def _invalidate_summary(project_id: str) -> None:
    _summary_cache.pop(project_id, None)


def _cached_summaries() -> list[dict]:
    if not PROJECTS_DIR.is_dir():
        return []
    summaries = []
    for entry in sorted(PROJECTS_DIR.iterdir()):
        if not entry.is_dir() or entry.name.startswith(("_", ".")):
            continue
        cached = _summary_cache.get(entry.name)
        if cached is None:
            try:
                cached = summarize_project(entry)
            except Exception:
                cached = {
                    "project_id": entry.name, "title": entry.name,
                    "pipeline_type": "unknown", "has_pipeline_state": False,
                    "poster": None, "live": False, "last_activity": 0,
                    "active_stage": None, "awaiting_human": False,
                    "stage_states": [], "completed_count": 0,
                    "render_count": 0, "scene_count": 0, "error": "unreadable",
                }
            _summary_cache[entry.name] = cached
        summaries.append(cached)
    summaries.sort(key=lambda s: (not s["live"], -(s["last_activity"] or 0)))
    return summaries


# Watch-loop hot path: pure string comparison, no per-path filesystem calls
# (change batches can be thousands of paths during a render).
import os as _os

_PROJECTS_ROOT_STR = _os.path.normcase(str(PROJECTS_DIR.resolve()))


def _project_of_change(path_str: str) -> Optional[str]:
    """Map a changed filesystem path to a project id (None = irrelevant)."""
    norm = _os.path.normcase(_os.path.normpath(path_str))
    if not norm.startswith(_PROJECTS_ROOT_STR):
        return None
    rel = norm[len(_PROJECTS_ROOT_STR):].lstrip("\\/")
    if not rel:
        return None
    parts = rel.replace("\\", "/").split("/")
    if _IGNORE_PARTS.intersection(parts):
        return None
    return parts[0]


async def _watch_projects() -> None:
    """Background task: watch projects/ and publish debounced changes."""
    try:
        from watchfiles import awatch
    except ImportError:
        return  # watcher unavailable ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ board still works via manual refresh
    if not PROJECTS_DIR.is_dir():
        return
    async for changes in awatch(PROJECTS_DIR, recursive=True, step=400):
        touched: set[str] = set()
        for _change, path_str in changes:
            pid = _project_of_change(path_str)
            if pid:
                touched.add(pid)
        for pid in touched:
            _invalidate_summary(pid)
            hub.publish(pid)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    """Own and cleanly stop the project watcher with FastAPI's lifespan API."""

    task = asyncio.create_task(_watch_projects())
    app.state.watch_task = task
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


def create_app() -> FastAPI:
    app = FastAPI(title="Backlot", docs_url=None, redoc_url=None, lifespan=_lifespan)

    # ---- API ----------------------------------------------------------

    @app.get("/api/health")
    async def health() -> dict:
        return {"ok": True, "app": "backlot", "cloudflare_account": bool(__import__("os").environ.get("CLOUDFLARE_ACCOUNT_ID")), "cloudflare_token": bool(__import__("os").environ.get("CLOUDFLARE_API_TOKEN")), "agnes_api_key": bool(__import__("os").environ.get("AGNES_API_KEY"))}

    @app.post("/api/generate")
    async def generate(payload: dict) -> dict:
        mode = str(payload.get("mode", "text_to_image")).strip()
        prompt = str(payload.get("prompt", "")).strip()
        duration = str(payload.get("duration", "5"))
        aspect_ratio = str(payload.get("aspect_ratio", "16:9"))
        reference_data_url = payload.get("reference_data_url")

        if mode not in {"text_to_image", "image_to_image", "text_to_video", "image_to_video"}:
            raise HTTPException(status_code=400, detail="invalid mode")
        if not prompt and mode != "image_to_image":
            raise HTTPException(status_code=400, detail="prompt is required")

        project_id = f"studio-{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
        project_dir = PROJECTS_DIR / project_id
        project_dir.mkdir(parents=True, exist_ok=False)

        media_exts = {".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm", ".mov"}

        def save_reference() -> Path | None:
            if not reference_data_url:
                return None
            try:
                header, encoded = str(reference_data_url).split(",", 1)
                raw = base64.b64decode(encoded)
            except Exception:
                raise HTTPException(status_code=400, detail="invalid reference image")
            ext = ".png"
            h = header.lower()
            if "jpeg" in h or "jpg" in h:
                ext = ".jpg"
            elif "webp" in h:
                ext = ".webp"
            ref = project_dir / f"reference{ext}"
            ref.write_bytes(raw)
            return ref

        reference_path = await asyncio.to_thread(save_reference)

        if mode in {"text_to_image", "image_to_image"}:
            from tools.graphics.image_selector import ImageSelector
            output_path = project_dir / "output.png"
            inputs = {
                "prompt": prompt,
                "generation_mode": "edit" if mode == "image_to_image" else "generate",
                "output_path": str(output_path),
                "aspect_ratio": aspect_ratio,
            }
            if reference_path:
                inputs["image_path"] = str(reference_path)
            result = await asyncio.to_thread(ImageSelector().execute, inputs)
            kind = "image"
        else:
            from tools.video.video_selector import VideoSelector
            output_path = project_dir / "output.mp4"
            inputs = {
                "prompt": prompt,
                "operation": mode,
                "duration": duration,
                "aspect_ratio": aspect_ratio,
                "output_path": str(output_path),
            }
            if payload.get("model"):
                inputs["model"] = payload["model"]
            if payload.get("preferred_provider"):
                inputs["preferred_provider"] = payload["preferred_provider"]
            if reference_path:
                inputs["reference_image_path"] = str(reference_path)
                inputs["reference_image_url"] = f"https://openmontage-fhpp.onrender.com/media/{project_id}/{reference_path.name}"
            result = await asyncio.to_thread(VideoSelector().execute, inputs)
            kind = "video"

        media_url = None
        if output_path.is_file():
            rel = output_path.relative_to(project_dir).as_posix()
            imagekit_url = await asyncio.to_thread(_upload_to_imagekit, output_path, f"/openmontage/projects/{project_id}")
            media_url = imagekit_url or f"/media/{project_id}/{rel}"
        else:
            found = sorted(
                [x for x in project_dir.rglob("*") if x.is_file() and x.suffix.lower() in media_exts],
                key=lambda x: x.stat().st_mtime,
                reverse=True,
            )
            if found:
                rel = found[0].relative_to(project_dir).as_posix()
                imagekit_url = await asyncio.to_thread(_upload_to_imagekit, found[0], f"/openmontage/projects/{project_id}")
                media_url = imagekit_url or f"/media/{project_id}/{rel}"

        return {
            "success": bool(result.success),
            "project_id": project_id,
            "mode": mode,
            "kind": kind,
            "media_url": media_url,
            "error": result.error,
            "cost_usd": result.cost_usd,
            "duration_seconds": result.duration_seconds,
            "seed": result.seed,
            "model": result.model,
            "data": result.data,
            "artifacts": result.artifacts,
        }

    @app.post("/api/faceswap-templates/add")
    async def add_faceswap_template(request: Request) -> dict:
        form = await request.form()
        video = form.get("video")
        name = str(form.get("name") or "").strip()

        if video is None or not hasattr(video, "read"):
            raise HTTPException(status_code=400, detail="video is required")

        if not name:
            name = Path(str(getattr(video, "filename", "") or "template")).stem or "FaceSwap Template"

        original_name = Path(str(getattr(video, "filename", "") or "template.mp4")).name
        if Path(original_name).suffix.lower() != ".mp4":
            raise HTTPException(status_code=400, detail="Only MP4 videos are allowed")

        template_id = f"user_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
        filename = f"{template_id}.mp4"

        source_dir = REPO_ROOT / "backlot" / "media" / "source_templates" / "user"
        metadata_path = REPO_ROOT / "backlot" / "media" / "source_templates" / "user_templates.json"

        source_dir.mkdir(parents=True, exist_ok=True)

        local_path = source_dir / filename
        content = await video.read()
        local_path.write_bytes(content)

        imagekit_url = await asyncio.to_thread(
            _upload_to_imagekit,
            local_path,
            "/openmontage/faceswap-templates",
        )

        if not imagekit_url:
            local_path.unlink(missing_ok=True)
            raise HTTPException(status_code=500, detail="ImageKit upload failed")

        try:
            templates = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.exists() else []
            if not isinstance(templates, list):
                templates = []
        except Exception:
            templates = []

        item = {
            "id": template_id,
            "name": name,
            "title": name,
            "description": str(form.get("description") or "").strip(),
            "category": str(form.get("category") or "User Added").strip() or "User Added",
            "is_builtin": False,
            "filename": filename,
            "original_filename": original_name,
            "imagekit_url": imagekit_url,
            "video_url": imagekit_url,
            "thumbnail_url": imagekit_url,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }

        templates.append(item)

        metadata_path.parent.mkdir(parents=True, exist_ok=True)
        metadata_path.write_text(
            json.dumps(templates, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        return {
            "success": True,
            "template": item,
        }
    @app.get("/api/faceswap-templates")
    async def faceswap_templates() -> list:
        metadata_path = REPO_ROOT / "backlot" / "media" / "source_templates" / "user_templates.json"

        if not metadata_path.exists():
            return []

        try:
            data = json.loads(metadata_path.read_text(encoding="utf-8"))
            if not isinstance(data, list):
                return []
            normalized = []
            for item in data:
                if not isinstance(item, dict):
                    continue
                url = item.get("imagekit_url") or item.get("video_url")
                if not url:
                    continue
                normalized.append({
                    **item,
                    "imagekit_url": item.get("imagekit_url") or url,
                    "video_url": item.get("video_url") or url,
                    "name": item.get("name") or item.get("title") or item.get("original_filename") or "FaceSwap Template",
                    "title": item.get("title") or item.get("name") or "FaceSwap Template",
                    "category": item.get("category") or "User Added",
                    "is_builtin": bool(item.get("is_builtin", False)),
                })
            return normalized
        except Exception as exc:
            print(f"[FaceSwap] Template library read failed: {exc}", flush=True)
            return []
    @app.get("/api/templates")
    async def templates() -> list:
        return [
            {"id": "Explainer", "name": "Explainer"},
            {"id": "CinematicRenderer", "name": "Cinematic Renderer"},
            {"id": "SignalFromTomorrowWithMusic", "name": "Signal From Tomorrow"},
            {"id": "TalkingHead", "name": "Talking Head"},
            {"id": "TitledVideo", "name": "Titled Video"},
            {"id": "HeroTitle", "name": "Hero Title"},
            {"id": "ProductReveal", "name": "Product Reveal"},
            {"id": "ProductRevealVertical", "name": "Product Reveal Vertical"},
            {"id": "CaptionOverlayOnly", "name": "Caption Overlay"},
            {"id": "CollageBurst", "name": "Collage Burst"},
            {"id": "LyricOverlay", "name": "Lyric Overlay"},
            {"id": "PhotoStack", "name": "Photo Stack"},
            {"id": "EndTag", "name": "End Tag"},
            {"id": "EndTagOverlay", "name": "End Tag Overlay"},
        ]
    @app.post("/api/template-render")
    async def template_render(payload: dict) -> dict:
        template_id = str(payload.get("template_id", "PhotoStack")).strip()
        allowed_templates = {"Explainer","CinematicRenderer","SignalFromTomorrowWithMusic","TalkingHead","TitledVideo","HeroTitle","ProductReveal","ProductRevealVertical","CaptionOverlayOnly","CollageBurst","LyricOverlay","PhotoStack","EndTag","EndTagOverlay"}
        if template_id not in allowed_templates:
            raise HTTPException(status_code=400, detail="unknown template")
        image_data_url = str(payload.get("image_data_url", "")).strip()
        title = str(payload.get("title", "")).strip()
        project_id = f"template-{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
        project_dir = PROJECTS_DIR / project_id
        project_dir.mkdir(parents=True, exist_ok=False)
        if image_data_url:
            image_src = image_data_url
        else:
            image_src = "https://placehold.co/1200x800.jpg"
        output_path = project_dir / "output.mp4"
        props = json.dumps({"imageSrc": image_src, "title": title}, separators=(",", ":"))
        command = ["npx", "remotion", "render", "src/index.tsx", template_id, str(output_path), "--frames=0-245", "--props", props]
        try:
            await asyncio.to_thread(subprocess.run, command, cwd=str(REPO_ROOT / "remotion-composer"), check=True, capture_output=True, text=True, timeout=300)
        except subprocess.CalledProcessError as exc:
            raise HTTPException(status_code=500, detail=(exc.stderr or exc.stdout or str(exc))[-4000:])
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="template render timeout")
        success = output_path.is_file()
        imagekit_url = await asyncio.to_thread(_upload_to_imagekit, output_path, f"/openmontage/templates/{template_id}") if success else None
        return {"success": success, "project_id": project_id, "template_id": template_id, "media_url": imagekit_url or (f"/media/{project_id}/output.mp4" if success else None), "imagekit_url": imagekit_url}

    @app.get("/api/projects")
    async def projects() -> list:
        return await asyncio.to_thread(_cached_summaries)

    @app.get("/api/project/{project_id}/state")
    async def project_state(project_id: str) -> dict:
        project_dir = _safe_project_dir(project_id)
        return await asyncio.to_thread(load_board_state, project_dir)

    @app.get("/api/project/{project_id}/events")
    async def project_events(project_id: str, request: Request) -> StreamingResponse:
        _safe_project_dir(project_id)  # 404 early for unknown projects

        async def stream():
            q = hub.subscribe(project_id)
            try:
                yield _sse({"type": "hello", "project_id": project_id})
                while True:
                    if await request.is_disconnected():
                        return
                    try:
                        await asyncio.wait_for(q.get(), timeout=SSE_HEARTBEAT_SECONDS)
                    except asyncio.TimeoutError:
                        yield _sse({"type": "heartbeat", "ts": time.time()})
                        continue
                    # Coalesce bursts: drain anything else queued.
                    while not q.empty():
                        try:
                            q.get_nowait()
                        except asyncio.QueueEmpty:
                            break
                    yield _sse({"type": "change", "project_id": project_id})
            finally:
                hub.unsubscribe(q)

        return StreamingResponse(stream(), media_type="text/event-stream", headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        })

    @app.get("/api/library/events")
    async def library_events(request: Request) -> StreamingResponse:
        async def stream():
            q = hub.subscribe()
            try:
                yield _sse({"type": "hello"})
                while True:
                    if await request.is_disconnected():
                        return
                    try:
                        changed = await asyncio.wait_for(q.get(), timeout=SSE_HEARTBEAT_SECONDS)
                    except asyncio.TimeoutError:
                        yield _sse({"type": "heartbeat", "ts": time.time()})
                        continue
                    while not q.empty():
                        try:
                            q.get_nowait()
                        except asyncio.QueueEmpty:
                            break
                    yield _sse({"type": "change", "project_id": changed})
            finally:
                hub.unsubscribe(q)

        return StreamingResponse(stream(), media_type="text/event-stream", headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        })

    # ---- Thumbnails (downscaled, cached on disk) ------------------------

    @app.get("/thumb/{project_id}/{file_path:path}")
    async def thumb(project_id: str, file_path: str, w: int = 640) -> FileResponse:
        project_dir = _safe_project_dir(project_id)
        target = (project_dir / file_path).resolve()
        try:
            target.relative_to(project_dir.resolve())
        except ValueError:
            raise HTTPException(status_code=403, detail="path escapes project")
        if not target.is_file():
            raise HTTPException(status_code=404, detail="media not found")
        width = min(THUMB_WIDTHS, key=lambda x: abs(x - w))
        cached = await asyncio.to_thread(_thumbnail_for, target, width)
        if cached is None:
            # Never fall back to raw video bytes for an <img> consumer (F-03);
            # non-thumbable images are safe to serve as-is.
            if target.suffix.lower() in {".mp4", ".webm", ".mov"}:
                raise HTTPException(status_code=404, detail="no poster frame available")
            return FileResponse(target)
        return FileResponse(cached, media_type="image/jpeg")

    # ---- Media (range requests handled by FileResponse) ---------------

    @app.get("/media/{project_id}/{file_path:path}")
    async def media(project_id: str, file_path: str) -> FileResponse:
        project_dir = _safe_project_dir(project_id)
        target = (project_dir / file_path).resolve()
        try:
            target.relative_to(project_dir.resolve())
        except ValueError:
            raise HTTPException(status_code=403, detail="path escapes project")
        if not target.is_file():
            raise HTTPException(status_code=404, detail="media not found")
        return FileResponse(target)

    def _delete_faceswap_temp(path: Path) -> None:
        try:
            path.unlink(missing_ok=True)
        except Exception as exc:
            print(f"[FaceSwap] Temp cleanup failed: {exc}", flush=True)
    # ---- FaceSwap temporary download -----------------------------------

    @app.get("/api/faceswap-download/{render_id}")
    async def faceswap_download(render_id: str, background_tasks: BackgroundTasks) -> FileResponse:
        if not render_id or any(ch not in "0123456789abcdef" for ch in render_id.lower()):
            raise HTTPException(status_code=400, detail="invalid render_id")

        temp_dir = REPO_ROOT / "backlot" / "media" / "faceswap_temp"
        target = temp_dir / f"{render_id}_faceswap.mp4"

        if not target.is_file():
            raise HTTPException(status_code=404, detail="FaceSwap result not found")

        background_tasks.add_task(_delete_faceswap_temp, target)

        return FileResponse(
            target,
            media_type="video/mp4",
            filename=f"{render_id}_faceswap.mp4",
        )
    # ---- UI ------------------------------------------------------------

    @app.get("/p/{project_id}")
    async def board_page(project_id: str) -> HTMLResponse:
        return _ui_html("board.html", ("board.css", "board.js"))

    @app.get("/p/{project_path:path}")
    async def board_page_path(project_path: str) -> HTMLResponse:
        return _ui_html("board.html", ("board.css", "board.js"))

    @app.get("/")
    async def studio_page() -> HTMLResponse:
        return _ui_html("studio.html", ())

    @app.get("/library")
    async def library_page() -> HTMLResponse:
        return _ui_html("index.html", ("board.css", "library.js"))

    if UI_DIR.is_dir():
        app.mount("/ui", StaticFiles(directory=UI_DIR), name="ui")

    # The board is a long-lived SPA: a tab keeps running whatever board.js it
    # loaded, and browsers heuristically cache /ui assets. no-cache forces a
    # conditional revalidation (cheap 304 via ETag) on every load so UI fixes
    # show up on a plain refresh. Media/thumb responses keep normal caching.
    @app.middleware("http")
    async def ui_no_cache(request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path == "/" or path.startswith("/ui") or path.startswith("/p/"):
            response.headers["Cache-Control"] = "no-cache"
        return response

    # DIRECT_FACESWAP_ROUTES_START
    @app.post("/api/faceswap-direct-detect")
    async def faceswap_direct_detect(request: Request):
        _cleanup_direct_faceswap_sessions()
        form = await request.form()
        video = form.get("video")

        if video is None or not hasattr(video, "read"):
            raise HTTPException(status_code=400, detail="Choose a video file first.")

        suffix = Path(getattr(video, "filename", "") or "video.mp4").suffix.lower()
        if suffix not in {".mp4", ".mov", ".m4v", ".webm", ".avi"}:
            suffix = ".mp4"

        root = REPO_ROOT / "backlot" / "media" / "faceswap_temp"
        session_id = uuid.uuid4().hex[:16]
        session_dir = root / f"direct_{session_id}"
        session_dir.mkdir(parents=True, exist_ok=True)
        video_path = session_dir / f"source{suffix}"

        try:
            with video_path.open("wb") as destination:
                while True:
                    chunk = await video.read(1024 * 1024)
                    if not chunk:
                        break
                    destination.write(chunk)

            analysis = await asyncio.to_thread(
                _detect_direct_video_faces, video_path
            )
            _DIRECT_FACESWAP_SESSIONS[session_id] = {
                "session_dir": str(session_dir),
                "video_path": str(video_path),
                "seed_frame_index": analysis["seed_frame_index"],
                "face_count": len(analysis["faces"]),
                "created_at": time.time(),
            }
            return {
                "success": True,
                "session_id": session_id,
                "seed_frame_index": analysis["seed_frame_index"],
                "duration": analysis["duration"],
                "faces": analysis["faces"],
            }
        except ValueError as exc:
            shutil.rmtree(session_dir, ignore_errors=True)
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            shutil.rmtree(session_dir, ignore_errors=True)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.post("/api/faceswap-direct-render")
    async def faceswap_direct_render(request: Request):
        form = await request.form()
        session_id = str(form.get("session_id") or "")
        if not session_id or any(ch not in "0123456789abcdef" for ch in session_id.lower()):
            raise HTTPException(status_code=400, detail="Invalid or missing video session.")

        session = _DIRECT_FACESWAP_SESSIONS.get(session_id)
        if not session:
            raise HTTPException(
                status_code=410,
                detail="The temporary video session expired. Select the video and detect faces again.",
            )

        session_dir = Path(session["session_dir"])
        # DIRECT_FACESWAP_RENDER_SOURCE_REFRESH
        # The source is sent again with Generate to avoid stale/missing temporary paths.
        uploaded_video = form.get("video")
        if uploaded_video is not None and hasattr(uploaded_video, "read"):
            original_name = Path(getattr(uploaded_video, "filename", "") or "source.mp4").name
            suffix = Path(original_name).suffix.lower()
            if suffix not in {".mp4", ".mov", ".m4v", ".webm", ".avi"}:
                suffix = ".mp4"
            render_source = session_dir / f"render_source{suffix}"
            try:
                with render_source.open("wb") as destination:
                    total_bytes = 0
                    while True:
                        chunk = await uploaded_video.read(1024 * 1024)
                        if not chunk:
                            break
                        total_bytes += len(chunk)
                        destination.write(chunk)
                if total_bytes < 1024:
                    raise HTTPException(status_code=400, detail="The uploaded video is empty or incomplete.")
                session["video_path"] = str(render_source.resolve())
            except HTTPException:
                raise
            except Exception as exc:
                with suppress(Exception):
                    render_source.unlink(missing_ok=True)
                raise HTTPException(status_code=400, detail=f"Could not refresh the temporary source video: {exc}") from exc
        reference_paths: list[Path | None] = []
        for index in range(int(session["face_count"])):
            reference = form.get(f"face_{index}")
            if reference is None or not hasattr(reference, "read"):
                reference_paths.append(None)
                continue

            suffix = Path(getattr(reference, "filename", "") or ".jpg").suffix.lower()
            if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
                suffix = ".jpg"
            data = await reference.read()
            if not data:
                raise HTTPException(status_code=400, detail=f"Reference image {index + 1} is empty.")
            if len(data) > 20 * 1024 * 1024:
                raise HTTPException(status_code=413, detail=f"Reference image {index + 1} exceeds 20 MB.")

            reference_path = session_dir / f"reference_{index}{suffix}"
            reference_path.write_bytes(data)
            reference_paths.append(reference_path)

        if not any(reference_path is not None for reference_path in reference_paths):
            raise HTTPException(
                status_code=400,
                detail="Select a reference image for at least one detected face.",
            )

        preserve_audio = str(form.get("preserve_audio", "true")).lower() != "false"
        try:
            return await asyncio.to_thread(
                _execute_direct_faceswap_pipeline,
                session_id,
                reference_paths,
                preserve_audio,
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
    @app.get("/api/faceswap-direct-download/{render_id}")
    async def faceswap_direct_download(
        render_id: str,
        background_tasks: BackgroundTasks
    ) -> FileResponse:
        if not render_id or any(ch not in "0123456789abcdef" for ch in render_id.lower()):
            raise HTTPException(status_code=400, detail="Invalid render ID.")
        temp_dir = REPO_ROOT / "backlot" / "media" / "faceswap_temp"
        target = temp_dir / f"{render_id}_faceswap.mp4"
        if not target.is_file():
            raise HTTPException(status_code=404, detail="Face Swap result not found.")
        background_tasks.add_task(_delete_faceswap_temp, target)
        return FileResponse(
            target,
            media_type="video/mp4",
            filename=f"{render_id}_faceswap.mp4",
        )
    # DIRECT_FACESWAP_ROUTES_END
    @app.post("/api/faceswap-render")
    async def faceswap_render(request: Request):
        form = await request.form()

        template_id = str(form.get("template_id") or "").strip()
        face_image = form.get("face_image")
        preserve_audio = str(form.get("preserve_audio", "true")).lower() != "false"

        if not template_id:
            raise HTTPException(status_code=400, detail="template_id is required")

        if face_image is None or not hasattr(face_image, "read"):
            raise HTTPException(status_code=400, detail="face_image is required")

        render_id = uuid.uuid4().hex[:12]
        upload_dir = REPO_ROOT / "backlot" / "media" / "faceswap_uploads"
        upload_dir.mkdir(parents=True, exist_ok=True)

        source_path = upload_dir / f"{render_id}_source{Path(getattr(face_image, 'filename', '') or '.jpg').suffix or '.jpg'}"

        data = await face_image.read()
        source_path.write_bytes(data)

        try:
            result = await asyncio.to_thread(
                _execute_faceswap_pipeline,
                template_id,
                source_path,
                preserve_audio,
            )
            return result
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        finally:
            with suppress(Exception):
                source_path.unlink(missing_ok=True)

    return app


def _safe_project_dir(project_id: str) -> Path:
    # ':' rejects Windows drive-relative ids like "C:" (PROJECTS_DIR / "C:"
    # collapses back to PROJECTS_DIR itself).
    if any(c in project_id for c in "/\\:") or project_id in (".", ".."):
        raise HTTPException(status_code=400, detail="invalid project id")
    project_dir = PROJECTS_DIR / project_id
    if not project_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"unknown project: {project_id}")
    return project_dir


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _thumbnail_for(source: Path, width: int) -> Optional[Path]:
    """Downscale an image (or extract a video poster frame) to a cached JPEG."""
    suffix = source.suffix.lower()
    is_image = suffix in {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    is_video = suffix in {".mp4", ".webm", ".mov"}
    if not (is_image or is_video):
        return None
    try:
        import hashlib
        stat = source.stat()
        key = hashlib.sha1(
            f"{source}|{stat.st_mtime_ns}|{stat.st_size}|{width}".encode()
        ).hexdigest()[:20]
        cached = THUMB_CACHE_DIR / f"{key}.jpg"
        if cached.is_file():
            return cached
        THUMB_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        # Unique temp per request ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â concurrent misses for the same source
        # must not write (and replace from) the same temp file.
        import uuid
        tmp = THUMB_CACHE_DIR / f"{key}.{uuid.uuid4().hex[:8]}.tmp.jpg"
        if is_video:
            import subprocess
            result = subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-ss", "1.5",
                 "-i", str(source), "-frames:v", "1",
                 "-vf", f"scale={width}:-2", str(tmp)],
                capture_output=True, timeout=30,
            )
            if result.returncode != 0 or not tmp.is_file():
                return None
        else:
            from PIL import Image
            with Image.open(source) as img:
                img = img.convert("RGB")
                img.thumbnail((width, width * 3))
                img.save(tmp, "JPEG", quality=82)
        tmp.replace(cached)
        return cached
    except Exception:
        return None


app = create_app()



















def _faceswap_cli():
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--cli-faceswap", action="store_true")
    parser.add_argument("--template-id", required=True)
    parser.add_argument("--source-face", required=True)
    parser.add_argument("--preserve-audio", default="true")
    parser.add_argument("--feather-blend", default="18")
    parser.add_argument("--enhance-face", default="true")
    args = parser.parse_args()

    if not args.cli_faceswap:
        return False

    result = _execute_faceswap_pipeline(
        args.template_id,
        Path(args.source_face),
        str(args.preserve_audio).lower() != "false",
    )

    print(json.dumps(result), flush=True)
    return True


def _direct_faceswap_cli() -> int:
    import argparse
    import sys

    parser = argparse.ArgumentParser()
    parser.add_argument("--cli-direct-detect", action="store_true")
    parser.add_argument("--cli-direct-render", action="store_true")
    parser.add_argument("--video")
    parser.add_argument("--seed-frame-index", type=int, default=0)
    parser.add_argument("--references-json")
    parser.add_argument("--preserve-audio", default="true")
    parser.add_argument("--render-id")
    parser.add_argument("--progress-id")
    args = parser.parse_args()

    try:
        if not args.video:
            raise ValueError("Video path is required.")
        video_path = Path(args.video).resolve()
        if not video_path.is_file():
            raise ValueError(f"Uploaded video is not available to the Face Swap process: {video_path}")

        if args.cli_direct_detect:
            result = _detect_direct_video_faces(video_path)
            result["success"] = True
        elif args.cli_direct_render:
            if not args.references_json:
                raise ValueError("Reference mapping is required.")
            manifest_path = Path(args.references_json).resolve()
            if not manifest_path.is_file():
                raise ValueError("Temporary reference mapping file is missing.")
            raw_references = json.loads(manifest_path.read_text(encoding="utf-8"))
            if not isinstance(raw_references, list) or not raw_references:
                raise ValueError("Reference mapping is empty.")
            reference_paths: list[Path | None] = []
            for item in raw_references:
                if item is None or item == "":
                    reference_paths.append(None)
                else:
                    candidate = Path(str(item)).resolve()
                    if not candidate.is_file():
                        raise ValueError(f"Temporary reference image is missing: {candidate.name}")
                    reference_paths.append(candidate)
            if not any(item is not None for item in reference_paths):
                raise ValueError("Choose a reference image for at least one detected face.")

            render_id = str(args.render_id or uuid.uuid4().hex[:12])
            if not render_id or any(ch not in "0123456789abcdef" for ch in render_id.lower()):
                raise ValueError("Invalid render ID.")
            temp_dir = REPO_ROOT / "backlot" / "media" / "faceswap_temp"
            temp_dir.mkdir(parents=True, exist_ok=True)
            raw_video = temp_dir / f"{render_id}_raw.mp4"
            output_video = temp_dir / f"{render_id}_faceswap.mp4"
            try:
                duration, _ = _run_inswapper_video_multi(
                    video_path, reference_paths, raw_video, int(args.seed_frame_index), args.progress_id
                )
                _emit_direct_faceswap_progress(args.progress_id, 88, "Ses ve gÃ¶rÃ¼ntÃ¼ birleÅŸtiriliyor")
                if str(args.preserve_audio).lower() != "false":
                    _encode_faceswap_h264(raw_video, video_path, output_video)
                else:
                    encoded = subprocess.run(
                        ["ffmpeg", "-y", "-i", str(raw_video), "-c:v", "libx264",
                         "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
                         "-movflags", "+faststart", "-an", str(output_video)],
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                    )
                    if encoded.returncode != 0:
                        raise RuntimeError(f"FFmpeg encoding failed: {encoded.stderr[-1500:]}")
                _emit_direct_faceswap_progress(args.progress_id, 97, "Son video kontrol ediliyor")
                if not output_video.is_file() or output_video.stat().st_size == 0:
                    raise RuntimeError("The Face Swap output video is empty.")
            finally:
                with suppress(Exception):
                    raw_video.unlink(missing_ok=True)
            result = {
                "success": True,
                "render_id": render_id,
                "duration": duration,
                "video_url": f"/backlot/media/faceswap_temp/{render_id}_faceswap.mp4",
                "download_url": f"/api/faceswap-direct-download/{render_id}",
            }
        else:
            raise ValueError("Select a Direct Face Swap CLI operation.")

        print("__DIRECT_FACESWAP_JSON__" + json.dumps(result, ensure_ascii=True), flush=True)
        return 0
    except Exception as exc:
        print("__DIRECT_FACESWAP_JSON__" + json.dumps({"success": False, "error": str(exc)}, ensure_ascii=True), flush=True)
        return 1

if __name__ == "__main__":
    import sys
    if "--cli-direct-detect" in sys.argv or "--cli-direct-render" in sys.argv:
        sys.exit(_direct_faceswap_cli())
    if "--cli-faceswap" in sys.argv:
        _faceswap_cli()








