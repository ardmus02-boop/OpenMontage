from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

import requests

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


_HEDRA_MODEL = "minimax-h3-max"
_HEDRA_BASE = "https://api.hedra.com/v3"


class HedraVideo(BaseTool):
    name = "hedra_video"
    version = "0.1.0"
    tier = ToolTier.GENERATE
    capability = "video_generation"
    provider = "hedra"
    stability = ToolStability.BETA
    execution_mode = ExecutionMode.SYNC
    determinism = Determinism.STOCHASTIC
    runtime = ToolRuntime.API

    dependencies = ["env:HEDRA_API_KEY"]
    install_instructions = "Set HEDRA_API_KEY."
    agent_skills = ["ai-video-gen"]

    capabilities = ["image_to_video"]
    supports = {
        "image_to_video": True,
        "reference_image": True,
    }

    best_for = ["HEDRA MiniMax H3 Max image-to-video"]
    not_good_for = ["offline generation"]
    fallback_tools = ["agnes_video"]
    quality_score = 0.95

    input_schema = {
        "type": "object",
        "required": ["prompt"],
        "properties": {
            "prompt": {"type": "string"},
            "operation": {
                "type": "string",
                "enum": ["image_to_video"],
                "default": "image_to_video",
            },
            "image_url": {"type": "string"},
            "image_path": {"type": "string"},
            "duration": {
                "type": "integer",
                "enum": list(range(5, 16)),
                "default": 5,
            },
            "resolution": {
                "type": "string",
                "enum": ["480p", "768p"],
                "default": "768p",
            },
            "enhance_prompt": {
                "type": "boolean",
                "default": False,
            },
            "output_path": {"type": "string"},
            "poll_interval_seconds": {
                "type": "integer",
                "default": 5,
            },
            "timeout_seconds": {
                "type": "integer",
                "default": 900,
            },
        },
    }

    resource_profile = ResourceProfile(
        cpu_cores=1,
        ram_mb=512,
        vram_mb=0,
        disk_mb=500,
        network_required=True,
    )

    retry_policy = RetryPolicy(
        max_retries=2,
        retryable_errors=["rate_limit", "timeout"],
    )

    idempotency_key_fields = [
        "prompt",
        "image_path",
        "image_url",
        "duration",
        "resolution",
    ]

    side_effects = [
        "uploads image to HEDRA",
        "calls HEDRA video API",
        "writes video file to output_path",
    ]

    user_visible_verification = ["Watch generated clip"]

    @staticmethod
    def _api_key() -> str | None:
        return os.environ.get("HEDRA_API_KEY")

    def get_status(self) -> ToolStatus:
        return (
            ToolStatus.AVAILABLE
            if self._api_key()
            else ToolStatus.UNAVAILABLE
        )

    def estimate_cost(self, inputs: dict[str, Any]) -> float:
        return 0.0

    def estimate_runtime(self, inputs: dict[str, Any]) -> float:
        return 180.0

    def _headers(self) -> dict[str, str]:
        api_key = self._api_key()
        return {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    def _upload_file(self, image_path: str) -> str:
        path = Path(image_path)
        if not path.exists():
            raise FileNotFoundError(f"Image not found: {image_path}")

        with path.open("rb") as fh:
            response = requests.post(
                f"{_HEDRA_BASE}/files",
                headers={"Authorization": f"Bearer {self._api_key()}"},
                files={
                    "file": (
                        path.name,
                        fh,
                        "application/octet-stream",
                    )
                },
                timeout=120,
            )

        response.raise_for_status()
        data = response.json()

        upload_url = data.get("url")
        if not upload_url:
            raise RuntimeError(
                f"HEDRA file upload response missing url: {data}"
            )

        return upload_url

    def execute(self, inputs: dict[str, Any]) -> ToolResult:
        api_key = self._api_key()
        if not api_key:
            return ToolResult(
                success=False,
                error="HEDRA_API_KEY not set.",
            )

        image_url = inputs.get("image_url")
        image_path = inputs.get("image_path")

        if not image_url and not image_path:
            return ToolResult(
                success=False,
                error="image_to_video requires image_url or image_path",
            )

        started = time.time()

        try:
            if not image_url:
                image_url = self._upload_file(image_path)

            duration_ms = int(inputs.get("duration", 5)) * 1000

            payload = {
                "input": {
                    "prompt": inputs["prompt"],
                    "resolution": inputs.get("resolution", "768p"),
                    "duration_ms": duration_ms,
                    "num_outputs": 1,
                    "enhance_prompt": bool(
                        inputs.get("enhance_prompt", False)
                    ),
                    "start_image": {
                        "source": "url",
                        "url": image_url,
                    },
                }
            }

            submit = requests.post(
                f"{_HEDRA_BASE}/models/{_HEDRA_MODEL}",
                headers=self._headers(),
                json=payload,
                timeout=60,
            )
            submit.raise_for_status()

            queued = submit.json()
            job_id = queued["job_id"]

            deadline = time.time() + int(
                inputs.get("timeout_seconds", 900)
            )

            while time.time() < deadline:
                status = requests.get(
                    f"{_HEDRA_BASE}/jobs/{job_id}/status",
                    headers=self._headers(),
                    timeout=30,
                )
                status.raise_for_status()
                status_data = status.json()

                job_status = status_data.get("status")

                if job_status == "COMPLETED":
                    break

                if job_status == "FAILED":
                    return ToolResult(
                        success=False,
                        error=f"HEDRA generation failed: {status_data}",
                    )

                time.sleep(
                    int(inputs.get("poll_interval_seconds", 5))
                )
            else:
                return ToolResult(
                    success=False,
                    error="HEDRA video generation timed out",
                )

            result = requests.get(
                f"{_HEDRA_BASE}/jobs/{job_id}",
                headers=self._headers(),
                timeout=60,
            )
            result.raise_for_status()
            result_data = result.json()

            outputs = result_data.get("outputs") or []
            if not outputs:
                return ToolResult(
                    success=False,
                    error=f"HEDRA output missing: {result_data}",
                )

            output = outputs[0]

            video_url = (
                output.get("url")
                or output.get("video_url")
                or output.get("download_url")
            )

            if not video_url:
                return ToolResult(
                    success=False,
                    error=f"HEDRA output missing video URL: {output}",
                )

            download = requests.get(video_url, timeout=300)
            download.raise_for_status()

            output_path = Path(
                inputs.get(
                    "output_path",
                    "hedra_video_output.mp4",
                )
            )
            output_path.parent.mkdir(
                parents=True,
                exist_ok=True,
            )
            output_path.write_bytes(download.content)

            return ToolResult(
                success=True,
                data={
                    "provider": "hedra",
                    "model": _HEDRA_MODEL,
                    "operation": "image_to_video",
                    "job_id": job_id,
                    "output": str(output_path),
                    "output_path": str(output_path),
                    "format": "mp4",
                    "video_url": video_url,
                    "duration_requested": int(
                        inputs.get("duration", 5)
                    ),
                },
                artifacts=[str(output_path)],
                cost_usd=self.estimate_cost(inputs),
                duration_seconds=round(
                    time.time() - started,
                    2,
                ),
                model=_HEDRA_MODEL,
            )

        except Exception as exc:
            return ToolResult(
                success=False,
                error=f"HEDRA video generation failed: {exc}",
            )
