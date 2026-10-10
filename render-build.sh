#!/usr/bin/env bash
set -Eeuo pipefail

# Render Free test build. The model is fetched during build, never committed to Git.
echo "[Render build] Installing Node dependencies..."
npm install --legacy-peer-deps

echo "[Render build] Installing Python dependencies..."
python3 -m pip install -r requirements.txt

MODEL_DIR="backlot/models"
MODEL_PATH="$MODEL_DIR/inswapper_128.onnx"
MODEL_URL="https://github.com/deepinsight/insightface/releases/download/model-zoo/inswapper_128.onnx"
mkdir -p "$MODEL_DIR"
if [[ ! -s "$MODEL_PATH" ]]; then
  echo "[Render build] Downloading INSwapper model (~554 MB)..."
  curl --fail --location --retry 3 --retry-delay 3 --connect-timeout 30 --max-time 1200 "$MODEL_URL" --output "$MODEL_PATH"
fi
MODEL_SIZE="$(stat -c '%s' "$MODEL_PATH")"
if [[ "$MODEL_SIZE" -lt 500000000 ]]; then
  echo "ERROR: INSwapper model download is incomplete ($MODEL_SIZE bytes)." >&2
  exit 1
fi
echo "[Render build] INSwapper model present: $MODEL_SIZE bytes"

echo "[Render build] Building Vite frontend..."
npm run build
echo "[Render build] COMPLETE"