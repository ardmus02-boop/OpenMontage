"""Free Wan 2.2 5B video generation through the Upsampler Hugging Face Space."""

from __future__ import annotations

import os
import shutil
import time
from pathlib import Path
from typing import Any

from tools.base_tool import (
    BaseTool,
    Determinism,
    ExecutionMode,
    ResourceProfile,
    RetryPolicy,
    ToolResult,
    ToolRuntime,
    ToolStability,
    ToolStatus,
    ToolTier,
)


SPACE = "Upsampler/wan-2-2-5b-video"


class UpsamplerWanVideo(BaseTool):
    name = "upsampler_wan_video"
    version = "0.1.0"
    tier = ToolTier.GENERATE
    capability = "video_generation"
    provider = "upsampler"
    stability = ToolStability.BETA
    execution_mode = ExecutionMode.SYNC
    determinism = Determinism.STOCHASTIC
    runtime = ToolRuntime.API

    dependencies = ["gradio_client", "huggingface_hub"]

    capabilities = [
        "text_to_video",
        "image_to_video",
    ]

    supports = {
        "text_to_video": True,
        "image_to_video": True,
        "reference_image": True,
        "native_audio": False,
        "free_tier": True,
    }

    best_for = [
        "free Wan 2.2 5B video generation",
        "text-to-video",
        "image-to-video",
        "5-second clips",
    ]

    not_good_for = [
        "single-pass clips longer than 5 seconds",
        "native audio",
    ]

    fallback_tools = ["wan_video", "comfyui_video"]

    quality_score = 0.80

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
            "reference_image_path": {"type": "string"},
            "duration": {
                "type": "integer",
                "minimum": 2,
                "maximum": 5,
                "default": 5,
            },
            "aspect_ratio": {
                "type": "string",
                "enum": ["16:9", "9:16", "1:1"],
                "default": "16:9",
            },
            "width": {"type": "integer", "default": 896},
            "height": {"type": "integer", "default": 512},
            "negative_prompt": {"type": "string"},
            "guidance_scale": {"type": "number", "default": 0.0},
            "num_inference_steps": {"type": "integer", "default": 4},
            "seed": {"type": "integer", "default": 42},
            "output_path": {"type": "string"},
        },
    }

    resource_profile = ResourceProfile(
        cpu_cores=1,
        ram_mb=4096,
        vram_mb=0,
        disk_mb=1000,
        network_required=True,
    )

    retry_policy = RetryPolicy(
        max_retries=1,
        retryable_errors=["timeout", "rate_limit"],
    )

    idempotency_key_fields = [
        "prompt",
        "operation",
        "duration",
        "aspect_ratio",
        "seed",
    ]

    side_effects = [
        "calls Upsampler Hugging Face Space",
        "writes video file to output_path",
    ]

    user_visible_verification = [
        "Watch generated video for motion coherence",
    ]

    @staticmethod
    def _token() -> str | None:
        token = os.environ.get("HF_TOKEN")
        if token:
            return token

        try:
            from huggingface_hub import get_token
            return get_token()
        except Exception:
            return None

    def get_status(self) -> ToolStatus:
        return ToolStatus.AVAILABLE if self._token() else ToolStatus.UNAVAILABLE

    def estimate_cost(self, inputs: dict[str, Any]) -> float:
        return 0.0

    @staticmethod
    def _dimensions(aspect_ratio: str, width: int, height: int) -> tuple[int, int]:
        if aspect_ratio == "16:9":
            return 896, 512
        if aspect_ratio == "9:16":
            return 512, 896
        if aspect_ratio == "1:1":
            return 512, 512
        return width, height

    def execute(self, inputs: dict[str, Any]) -> ToolResult:
        token = self._token()
        if not token:
            return ToolResult(
                success=False,
                error="Hugging Face login not available.",
            )

        try:
            from gradio_client import Client, handle_file
        except Exception as exc:
            return ToolResult(
                success=False,
                error=f"gradio_client unavailable: {exc}",
            )

        start = time.time()
        operation = inputs.get("operation", "text_to_video")
        prompt = inputs["prompt"]
        duration = min(5, max(2, int(inputs.get("duration", 5))))
        aspect_ratio = inputs.get("aspect_ratio", "16:9")

        width, height = self._dimensions(
            aspect_ratio,
            int(inputs.get("width", 896)),
            int(inputs.get("height", 512)),
        )

        ref_path = inputs.get("reference_image_path")
        if operation == "image_to_video" and not ref_path:
            return ToolResult(
                success=False,
                error="image_to_video requires reference_image_path",
            )

        output_path = Path(
            inputs.get("output_path", "upsampler_wan_video.mp4")
        )
        output_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            client = Client(SPACE, token=token)

            result = client.predict(
                handle_file(ref_path) if operation == "image_to_video" else None,
                prompt,
                height,
                width,
                inputs.get(
                    "negative_prompt",
                    "Bright tones, overexposed, static, blurred details, subtitles, watermark, text",
                ),
                duration,
                float(inputs.get("guidance_scale", 0.0)),
                int(inputs.get("num_inference_steps", 4)),
                int(inputs.get("seed", 42)),
                True,
                api_name="/generate_video",
            )

            payload = result[0] if isinstance(result, tuple) else result

            if not isinstance(payload, dict) or not payload.get("video"):
                return ToolResult(
                    success=False,
                    error=f"Upsampler returned unexpected result: {payload!r}",
                )

            video_source = Path(payload["video"])
            if not video_source.exists():
                return ToolResult(
                    success=False,
                    error=f"Generated video not found: {video_source}",
                )

            shutil.copyfile(video_source, output_path)

        except Exception as exc:
            return ToolResult(
                success=False,
                error=f"Upsampler Wan generation failed: {exc}",
            )

        return ToolResult(
            success=True,
            data={
                "provider": "upsampler",
                "gateway": "huggingface",
                "space": SPACE,
                "model": "Wan 2.2 5B",
                "operation": operation,
                "duration": duration,
                "aspect_ratio": aspect_ratio,
                "output": str(output_path),
            },
            artifacts=[str(output_path)],
            cost_usd=0.0,
            duration_seconds=round(time.time() - start, 2),
            model="Wan 2.2 5B / Upsampler",
        )
