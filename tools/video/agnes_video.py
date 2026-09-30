from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

import requests

_AGNES_V2_MODEL = "agnes-video-v2.0"
_AGNES_25_FLASH_MODEL = "agnes-video-2.5-flash"
_AGNES_MODELS = (_AGNES_V2_MODEL, _AGNES_25_FLASH_MODEL)


from tools.base_tool import (
    BaseTool, Determinism, ExecutionMode, ResourceProfile, RetryPolicy,
    ToolResult, ToolRuntime, ToolStability, ToolStatus, ToolTier,
)


class AgnesVideo(BaseTool):
    name = "agnes_video"
    version = "0.1.0"
    tier = ToolTier.GENERATE
    capability = "video_generation"
    provider = "agnes"
    stability = ToolStability.BETA
    execution_mode = ExecutionMode.SYNC
    determinism = Determinism.STOCHASTIC
    runtime = ToolRuntime.API
    dependencies = ["env:AGNES_API_KEY"]
    install_instructions = "Set AGNES_API_KEY."
    agent_skills = ["ai-video-gen"]
    capabilities = ["text_to_video", "image_to_video"]
    supports = {"text_to_video": True, "image_to_video": True, "reference_image": True}
    best_for = ["AGNES Video v2 T2V and I2V"]
    not_good_for = ["offline generation"]
    fallback_tools = ["grok_video", "minimax_video", "kling_video"]
    quality_score = 0.9

    input_schema = {
        "type": "object",
        "required": ["prompt"],
        "properties": {
            "prompt": {"type": "string"},
            "operation": {
                "type": "string",
                "enum": ["text_to_video", "image_to_video"],
                "default": "text_to_video",
            },
            "model": {
                "type": "string",
                "enum": list(_AGNES_MODELS),
                "default": _AGNES_V2_MODEL,
            },
            "image_url": {"type": "string"},
            "image_path": {"type": "string"},
            "duration": {"type": "integer", "minimum": 1, "default": 5},
            "seconds": {"type": "string"},
            "frame_rate": {"type": "integer", "default": 24},
            "width": {"type": "integer", "default": 1152},
            "height": {"type": "integer", "default": 768},
            "size": {
                "type": "string",
                "enum": ["720P", "1080P", "1K", "2K"],
                "default": "720P",
            },
            "aspect_ratio": {"type": "string", "default": "16:9"},
            "first_frame": {"type": "string"},
            "last_frame": {"type": "string"},
            "output_path": {"type": "string"},
            "poll_interval_seconds": {"type": "integer", "default": 5},
            "timeout_seconds": {"type": "integer", "default": 900},
        },
    }

    resource_profile = ResourceProfile(
        cpu_cores=1, ram_mb=512, vram_mb=0, disk_mb=500, network_required=True
    )
    retry_policy = RetryPolicy(max_retries=2, retryable_errors=["rate_limit", "timeout"])
    idempotency_key_fields = ["prompt", "operation", "model", "duration"]
    side_effects = ["writes video file to output_path", "calls AGNES video API"]
    user_visible_verification = ["Watch generated clip"]

    def _api_key(self) -> str | None:
        return os.environ.get("AGNES_API_KEY")

    def get_status(self) -> ToolStatus:
        return ToolStatus.AVAILABLE if self._api_key() else ToolStatus.UNAVAILABLE

    def get_info(self) -> dict[str, Any]:
        info = super().get_info()
        info["model_catalog"] = {
            _AGNES_V2_MODEL: {
                "family": "agnes-video",
                "variant": "v2.0",
                "operations": ["text_to_video", "image_to_video"],
                "durations": [5, 10],
            },
            _AGNES_25_FLASH_MODEL: {
                "family": "agnes-video",
                "variant": "2.5-flash",
                "operations": ["text_to_video", "image_to_video"],
                "durations": list(range(4, 13)),
                "resolution": "720P",
            },
        }
        return info

    def estimate_cost(self, inputs: dict[str, Any]) -> float:
        return 0.0

    def estimate_runtime(self, inputs: dict[str, Any]) -> float:
        return 120.0

    def execute(self, inputs: dict[str, Any]) -> ToolResult:
        api_key = self._api_key()
        if not api_key:
            return ToolResult(success=False, error="AGNES_API_KEY not set.")

        start = time.time()
        model = inputs.get("model", "agnes-video-v2.0")
        operation = inputs.get("operation", "text_to_video")
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

        duration = int(inputs.get("duration", 5))
        seconds = str(inputs.get("seconds", duration))
        aspect_ratio = inputs.get("aspect_ratio", "16:9")

        if model == _AGNES_25_FLASH_MODEL:
            payload = {
                "model": model,
                "prompt": inputs["prompt"],
                "mode": "text",
                "seconds": seconds,
                "size": inputs.get("size", "720P"),
                "aspect_ratio": aspect_ratio,
            }
        else:
            payload = {
                "model": model,
                "prompt": inputs["prompt"],
                "num_frames": duration * int(inputs.get("frame_rate", 24)) + 1,
                "frame_rate": int(inputs.get("frame_rate", 24)),
            }

        if operation == "image_to_video":
            image_url = inputs.get("image_url")
            if not image_url:
                image_path = inputs.get("image_path")
                if image_path:
                    image_url = image_path
            if not image_url:
                return ToolResult(success=False, error="image_to_video requires image_url or image_path")

            if model == _AGNES_25_FLASH_MODEL:
                payload["mode"] = "img2video"
                payload["first_frame"] = image_url
            else:
                payload["image_url"] = image_url

        try:
            response = requests.post(
                "https://apihub.agnes-ai.com/v1/videos",
                headers=headers,
                json=payload,
                timeout=60,
            )
            response.raise_for_status()
            data = response.json()
            video_id = data.get("video_id") or data.get("id")
            if not video_id:
                return ToolResult(success=False, error="AGNES response missing video_id")

            deadline = time.time() + int(inputs.get("timeout_seconds", 900))
            result_data = None

            while time.time() < deadline:
                result = requests.get(
                    "https://apihub.agnes-ai.com/agnesapi",
                    params={"video_id": video_id, "model_name": model},
                    headers={"Authorization": f"Bearer {api_key}"},
                    timeout=30,
                )
                result.raise_for_status()
                result_data = result.json()

                status = result_data.get("status") or result_data.get("internal_status")

                if status == "completed":
                    break
                if status in {"failed", "error"}:
                    return ToolResult(success=False, error=f"AGNES generation failed: {result_data}")

                time.sleep(int(inputs.get("poll_interval_seconds", 5)))

            if not result_data or result_data.get("status") != "completed":
                return ToolResult(success=False, error="AGNES video generation timed out")

            video_url = (
                result_data.get("video_url")
                or result_data.get("url")
                or result_data.get("output", {}).get("url")
            )
            if not video_url:
                return ToolResult(success=False, error="AGNES output missing video URL")

            download = requests.get(video_url, timeout=300)
            download.raise_for_status()

            output_path = Path(inputs.get("output_path", "agnes_video_output.mp4"))
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_bytes(download.content)

            return ToolResult(
                success=True,
                data={
                    "provider": "agnes",
                    "model": model,
                    "operation": operation,
                    "video_id": video_id,
                    "output": str(output_path),
                    "output_path": str(output_path),
                    "format": "mp4",
                    "video_url": video_url,
                },
                artifacts=[str(output_path)],
                cost_usd=self.estimate_cost(inputs),
                duration_seconds=round(time.time() - start, 2),
                model=model,
            )

        except Exception as e:
            return ToolResult(success=False, error=f"AGNES video generation failed: {e}")
