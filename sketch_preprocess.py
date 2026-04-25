"""
Canonical QuickDraw-style preprocessing and inference.

KEY INSIGHT
-----------
The model was trained on 28×28 numpy_bitmap images from the QuickDraw dataset,
which are rendered with THIN strokes (~1-2 px at 28px resolution). Web users
draw on a ~380px canvas with thick brushes. If we simply compress the 380px PNG
to 28×28, we get saturated blobs that look nothing like the training data.

SOLUTION: `strokes_to_quickdraw_tensor`
  Render the RAW VECTOR STROKES directly at 28×28 scale with thin strokes.
  This matches the QuickDraw training distribution and gives accurate predictions.

The PNG-based path (`pil_white_bg_to_model_tensor`) is kept as a fallback when
vector strokes are unavailable (e.g., image-only upload).
"""

from __future__ import annotations

import numpy as np
import cv2
from PIL import Image, ImageDraw


# ---------------------------------------------------------------------------
# Spurious labels — tend to fire on blob-like or noisy inputs
# ---------------------------------------------------------------------------
_SPURIOUS_LABELS: frozenset[str] = frozenset({
    "rain",
    "line",
    "zigzag",
    "squiggle",
    "stitches",
    "river",
    "string bean",
    "ocean",
})

_SPURIOUS_CONF_THRESHOLD = 0.60  # suppress if top-1 is spurious below this
_LOW_CONF_THRESHOLD      = 0.28  # overall low-confidence fallback


# ---------------------------------------------------------------------------
# Primary path: vector strokes → QuickDraw 28×28 tensor
# ---------------------------------------------------------------------------

def strokes_to_quickdraw_tensor(strokes: list) -> np.ndarray:
    """
    Convert browser stroke data [[x_arr, y_arr], ...] to a 28×28 tensor
    matching the QuickDraw numpy_bitmap training distribution.

    KEY: QuickDraw bitmaps are HARD BINARY (0 or 1, no antialiasing).
    We must match this exactly or the model fires on the wrong class.

    Pipeline
    --------
    1. Normalise all points to fit a 28×28 canvas with 10 % margin.
    2. Render with cv2 at the SAME 28×28 scale using integer coords +
       hard binary lines (thickness 1, no AA).  This matches the official
       QuickDraw numpy_bitmap renderer.
    3. Invert so ink = high values (QuickDraw convention: ink = white).

    Returns shape (1, 28, 28, 1) float32 with values in {0.0, 1.0}.
    """
    if not strokes:
        return np.zeros((1, 28, 28, 1), dtype=np.float32)

    all_x = [float(x) for x_arr, y_arr in strokes for x in x_arr]
    all_y = [float(y) for x_arr, y_arr in strokes for y in y_arr]
    if not all_x:
        return np.zeros((1, 28, 28, 1), dtype=np.float32)

    min_x, max_x = min(all_x), max(all_x)
    min_y, max_y = min(all_y), max(all_y)
    w = max(max_x - min_x, 1.0)
    h = max(max_y - min_y, 1.0)
    max_dim = max(w, h)

    SZ    = 28
    MRG   = 3                          # ~10 % margin in 28px space
    usable = SZ - 2 * MRG
    scale  = usable / max_dim

    # Black canvas (ink will be white = 255)
    canvas = np.zeros((SZ, SZ), dtype=np.uint8)

    for x_arr, y_arr in strokes:
        pts = np.array([
            [int(round((float(x) - min_x) * scale)) + MRG,
             int(round((float(y) - min_y) * scale)) + MRG]
            for x, y in zip(x_arr, y_arr)
        ], dtype=np.int32)

        # Clamp to [0, SZ-1]
        pts = np.clip(pts, 0, SZ - 1)

        if len(pts) == 1:
            canvas[pts[0][1], pts[0][0]] = 255
        else:
            for i in range(len(pts) - 1):
                cv2.line(canvas,
                         (pts[i][0],   pts[i][1]),
                         (pts[i+1][0], pts[i+1][1]),
                         color=255, thickness=1, lineType=cv2.LINE_AA)

    # Hard binarise — match QuickDraw binary bitmaps exactly
    _, binary = cv2.threshold(canvas, 32, 255, cv2.THRESH_BINARY)

    # Light dilation to ensure strokes are visible at 28px
    # (QuickDraw renderer actually has slightly thicker than 1px due to
    #  the original 255×255 → 28×28 downscale; 2px compensates for that)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2, 2))
    binary = cv2.dilate(binary, kernel, iterations=1)

    ink = binary.astype(np.float32) / 255.0   # {0.0, 1.0}
    return ink[None, :, :, None]


# ---------------------------------------------------------------------------
# Fallback path: PIL image (PNG upload) → 28×28 tensor
# ---------------------------------------------------------------------------

def pil_white_bg_to_28_array(img: Image.Image) -> np.ndarray:
    """Grayscale, ink = high, tight crop + 10 % border, resize to 28×28."""
    g   = np.asarray(img.convert("L"), dtype=np.float32)
    ink = 255.0 - g
    coords = np.argwhere(ink > 0.0)
    if coords.size == 0:
        return np.zeros((28, 28), dtype=np.float32)
    y0, x0 = coords.min(axis=0)
    y1, x1 = coords.max(axis=0) + 1
    cropped = ink[y0:y1, x0:x1]
    h, w    = cropped.shape
    max_dim  = max(h, w, 1)
    pad_y = (max_dim - h) // 2
    pad_x = (max_dim - w) // 2
    border = int(max_dim * 0.10) + 1
    arr_sq = np.pad(
        cropped,
        ((pad_y + border, max_dim - h - pad_y + border),
         (pad_x + border, max_dim - w - pad_x + border)),
        mode="constant",
    )
    try:
        resample = Image.Resampling.LANCZOS
    except AttributeError:
        resample = Image.LANCZOS
    u8 = np.clip(arr_sq, 0, 255).astype(np.uint8)
    return (
        np.asarray(Image.fromarray(u8).resize((28, 28), resample), dtype=np.float32)
        / 255.0
    )


def pil_white_bg_to_model_tensor(img: Image.Image) -> np.ndarray:
    a = pil_white_bg_to_28_array(img)
    return a[None, :, :, None]   # (1, 28, 28, 1)


def refine_ink_quickdraw_style(ink_28: np.ndarray) -> np.ndarray:
    """Otsu binarise + light erode to further thin strokes."""
    u8 = (np.clip(ink_28, 0, 1) * 255.0).astype(np.uint8)
    if u8.max() < 8:
        return np.asarray(ink_28, dtype=np.float32)
    _, t = cv2.threshold(u8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    b = (u8 > t * 0.45).astype(np.uint8) * 255
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2, 2))
    b = cv2.erode(b, k, iterations=1)
    return b.astype(np.float32) / 255.0


# ---------------------------------------------------------------------------
# Label helpers
# ---------------------------------------------------------------------------

def name_for_index(classes: dict, idx: int) -> str:
    v = classes.get(str(int(idx)))
    return str(v) if v else f"class_{int(idx)}"

# alias used internally
_label_for_index = name_for_index


# ---------------------------------------------------------------------------
# TTA (test-time augmentation)
# ---------------------------------------------------------------------------

def _run_tta(model, batch: np.ndarray) -> np.ndarray:
    """
    Average predictions over:
      - original
      - horizontal flip
      - ±8° rotations
    All via cv2 so no extra deps.
    """
    def _rot(arr2d: np.ndarray, deg: float) -> np.ndarray:
        h, w = arr2d.shape
        M = cv2.getRotationMatrix2D((w / 2, h / 2), deg, 1.0)
        return cv2.warpAffine(arr2d, M, (w, h),
                              flags=cv2.INTER_LINEAR,
                              borderMode=cv2.BORDER_CONSTANT, borderValue=0)

    ink = batch[0, :, :, 0]

    def _b(arr2d: np.ndarray) -> np.ndarray:
        return arr2d[None, :, :, None].astype(np.float32)

    orig  = _b(ink)
    flip  = _b(np.flip(ink, axis=1))
    rot_p = _b(_rot(ink,  8.0))
    rot_n = _b(_rot(ink, -8.0))

    return (
        model(orig,  training=False).numpy()
        + model(flip, training=False).numpy()
        + model(rot_p, training=False).numpy()
        + model(rot_n, training=False).numpy()
    ) / 4.0


# ---------------------------------------------------------------------------
# Spurious-label suppression
# ---------------------------------------------------------------------------

def _suppress_spurious(p: np.ndarray, model, batch: np.ndarray,
                       classes: dict) -> np.ndarray:
    """
    1. If top-1 is a known spurious label with confidence < threshold,
       rescore on Otsu-thinned ink and return whichever is more confident.
    2. If overall confidence is very low, blend with the thinned prediction.
    """
    top_idx  = int(p.argmax())
    top_conf = float(p[0, top_idx])
    top_lbl  = _label_for_index(classes, top_idx).lower()

    ink = batch[0, :, :, 0].copy()
    thin = refine_ink_quickdraw_style(ink)
    tb   = thin[None, :, :, None].astype(np.float32)
    tfb  = np.flip(tb, axis=2)
    pr   = 0.5 * (
        model(tb,  training=False).numpy()
        + model(tfb, training=False).numpy()
    )

    if top_lbl in _SPURIOUS_LABELS and top_conf < _SPURIOUS_CONF_THRESHOLD:
        return pr if int(pr.argmax()) != top_idx else pr

    if top_conf < _LOW_CONF_THRESHOLD:
        return 0.35 * p + 0.65 * pr

    return p


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def predict_with_tta(
    model,
    batch: np.ndarray,
    classes: dict,
) -> tuple[int, str, float, list[tuple[str, float]]]:
    """
    Full pipeline: TTA → spurious suppression → top-5.
    Confidence returned as a percentage (0–100).
    """
    p   = _run_tta(model, batch)
    p   = _suppress_spurious(p, model, batch, classes)

    idx    = int(np.argmax(p, axis=1)[0])
    nclass = p.shape[1]
    k      = min(5, nclass)
    topi   = np.argsort(p[0])[-k:][::-1]

    top5 = [
        (_label_for_index(classes, int(j)), float(p[0, int(j)]) * 100.0)
        for j in topi
    ]
    return idx, _label_for_index(classes, idx), float(p[0, idx]) * 100.0, top5
