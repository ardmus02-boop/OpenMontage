"""Backlot server — FastAPI app: board state API, SSE change feed, media.

The watcher observes ``projects/`` with watchfiles; on any change it bumps a
per-project version and wakes SSE subscribers, who tell the browser to
refetch state. The server never writes to project directories.
"""

from __future__ import annotations

import asyncio
import base64
import json
import time
import uuid
import subprocess
import urllib.request
import urllib.error
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from backlot.state import PROJECTS_DIR, REPO_ROOT, list_projects, load_board_state, summarize_project

UI_DIR = Path(__file__).resolve().parent / "ui"
THUMB_CACHE_DIR = REPO_ROOT / ".backlot" / "thumbs"
THUMB_WIDTHS = (320, 640, 960)

# Paths inside a project whose changes are pure noise for the board.
_IGNORE_PARTS = {"node_modules", ".git", "__pycache__", ".cache"}

SSE_HEARTBEAT_SECONDS = 15


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
                # queue already guarantees a pending wake-up → safe to drop.
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
        return  # watcher unavailable → board still works via manual refresh
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
            media_url = f"/media/{project_id}/{rel}"
        else:
            found = sorted(
                [x for x in project_dir.rglob("*") if x.is_file() and x.suffix.lower() in media_exts],
                key=lambda x: x.stat().st_mtime,
                reverse=True,
            )
            if found:
                rel = found[0].relative_to(project_dir).as_posix()
                media_url = f"/media/{project_id}/{rel}"

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
        return {"success": output_path.is_file(), "project_id": project_id, "template_id": template_id, "media_url": f"/media/{project_id}/output.mp4" if output_path.is_file() else None}

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
        # Unique temp per request — concurrent misses for the same source
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






