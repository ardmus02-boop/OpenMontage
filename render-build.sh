#!/usr/bin/env bash
set -Eeuo pipefail

# Render Free test build. The model is fetched during build, never committed to Git.
echo "[Render build] Installing Node dependencies..."
npm install --legacy-peer-deps

echo "[Render build] Installing Python dependencies..."
python3 -m pip install -r requirements.txt
# DIRECT_FACESWAP_VENV_START
# Keep legacy InsightFace/NumPy/OpenCV dependencies isolated from other Python features.
echo "[Render build] Creating isolated Direct Face Swap Python environment..."
FS_VENV=".venv-faceswap"
python3 -m venv "$FS_VENV"
FS_PYTHON="$FS_VENV/bin/python"
"$FS_PYTHON" -m pip install --upgrade pip setuptools wheel
CONSTRAINTS_FILE="$(mktemp)"
printf 'numpy<2\n' > "$CONSTRAINTS_FILE"
"$FS_PYTHON" -m pip install -c "$CONSTRAINTS_FILE" -r requirements.txt
rm -f "$CONSTRAINTS_FILE"
"$FS_PYTHON" -m pip install \
  "numpy==1.26.4" \
  "Cython<3" \
  "onnx>=1.13,<2" \
  "onnxruntime==1.20.1" \
  "opencv-python-headless==4.10.0.84" \
  "scipy==1.13.1" \
  "scikit-image==0.24.0" \
  "scikit-learn==1.5.2" \
  "matplotlib==3.9.2" \
  "albucore==0.0.16" \
  "albumentations==1.4.8" \
  "prettytable>=3.10,<4" \
  "easydict>=1.9" \
  "tqdm>=4.66,<5"
"$FS_PYTHON" -m pip install --no-deps --no-build-isolation "insightface==0.7.3"
"$FS_PYTHON" -c 'from importlib.metadata import version; import cv2, numpy, onnxruntime, albucore, insightface; print("[Render build] FaceSwap runtime OK; numpy", numpy.__version__, "onnxruntime", onnxruntime.__version__, "albucore", version("albucore"))'
echo "[Render build] Isolated Direct Face Swap Python environment ready."
# DIRECT_FACESWAP_VENV_END

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
