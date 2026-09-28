"""FLUX image generation and editing via Cloudflare Workers AI."""

from __future__ import annotations

import base64
import os
import time
from pathlib import Path
from typing import Any

from tools.base_tool import (
    BaseTool,
    ToolResult,
    ToolRuntime,
    ToolStability,
    ToolStatus,
    ToolTier,
)


class CloudflareFlux(BaseTool):
    name = "cloudflare_flux"
    version = "0.2.0"
    tier = ToolTier.GENERATE
    capability = "image_generation"
    provider = "cloudflare"
    stability = ToolStability.BETA
    runtime = ToolRuntime.API

    dependencies = []

    install_instructions = (
        "Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN."
    )

    capabilities = [
        "generate_image",
        "text_to_image",
        "image_to_image",
        "image_editing",
    ]

    supports = {
        "negative_prompt": False,
        "seed": True,
        "custom_size": True,
        "reference_image": True,
    }

    best_for = [
        "fast text-to-image generation",
        "image-to-image editing",
        "FLUX.2 Klein 4B",
        "reference-image workflows",
    ]

    not_good_for = [
        "negative-prompt control",
        "very large reference images",
    ]

    input_schema = {
        "type": "object",
        "required": ["prompt"],
        "properties": {
            "prompt": {"type": "string"},
            "generation_mode": {
                "type": "string",
                "enum": ["generate", "edit"],
                "default": "generate",
            },
            "image_path": {"type": "string"},
            "image_paths": {
                "type": "array",
                "items": {"type": "string"},
            },
            "width": {"type": "integer", "default": 1024},
            "height": {"type": "integer", "default": 1024},
            "seed": {"type": "integer"},
            "model": {
                "type": "string",
                "default": "@cf/black-forest-labs/flux-2-klein-4b",
            },
            "output_path": {"type": "string"},
        },
    }

    def _account_id(self) -> str | None:
        return os.environ.get("CLOUDFLARE_ACCOUNT_ID")

    def _api_token(self) -> str | None:
        return os.environ.get("CLOUDFLARE_API_TOKEN")

    def get_status(self) -> ToolStatus:
        if self._account_id() and self._api_token():
            return ToolStatus.AVAILABLE
        return ToolStatus.UNAVAILABLE

    def estimate_cost(self, inputs: dict[str, Any]) -> float:
        return 0.0

    def _reference_path(self, inputs: dict[str, Any]) -> str | None:
        if inputs.get("image_path"):
            return inputs["image_path"]

        paths = inputs.get("image_paths") or []
        if paths:
            return paths[0]

        return None

    def execute(self, inputs: dict[str, Any]) -> ToolResult:
        account_id = self._account_id()
        api_token = self._api_token()

        if not account_id or not api_token:
            return ToolResult(
                success=False,
                error="Cloudflare credentials are not configured.",
            )

        import requests

        start = time.time()
        prompt = inputs["prompt"]
        mode = inputs.get("generation_mode", "generate")
        model = inputs.get(
            "model",
            "@cf/black-forest-labs/flux-2-klein-4b",
        )
        width = int(inputs.get("width", 1024))
        height = int(inputs.get("height", 1024))
        output_path = Path(
            inputs.get("output_path", "generated_image.png")
        )

        url = (
            f"https://api.cloudflare.com/client/v4/accounts/"
            f"{account_id}/ai/run/{model}"
        )

        form_data = {
            "prompt": prompt,
            "width": str(width),
            "height": str(height),
        }

        files = None
        ref_path = self._reference_path(inputs)

        try:
            if mode == "edit" and ref_path:
                from PIL import Image
                import io

                image = Image.open(ref_path).convert("RGB")
                image.thumbnail((511, 511))

                buf = io.BytesIO()
                image.save(buf, format="PNG")

                files = {
                    "input_image_0": (
                        "reference.png",
                        buf.getvalue(),
                        "image/png",
                    )
                }

            response = requests.post(
                url,
                headers={
                    "Authorization": f"Bearer {api_token}",
                },
                data=form_data,
                files=files,
                timeout=180,
            )
            response.raise_for_status()

            result = response.json()

            if not result.get("success"):
                return ToolResult(
                    success=False,
                    error=str(result.get("errors") or result),
                )

            image_data = result.get("result", {}).get("image")
            if not image_data:
                return ToolResult(
                    success=False,
                    error="Cloudflare returned no image.",
                )

            if image_data.startswith("data:") and "," in image_data:
                image_data = image_data.split(",", 1)[1]

            image_bytes = base64.b64decode(image_data)

            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_bytes(image_bytes)

        except Exception as e:
            return ToolResult(
                success=False,
                error=f"Cloudflare FLUX generation failed: {e}",
            )

        return ToolResult(
            success=True,
            data={
                "provider": "cloudflare",
                "model": model,
                "prompt": prompt,
                "generation_mode": mode,
                "output": str(output_path),
            },
            artifacts=[str(output_path)],
            cost_usd=0.0,
            duration_seconds=round(time.time() - start, 2),
            seed=inputs.get("seed"),
            model=model,
        )
