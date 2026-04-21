"""
Procedural animation frame generators.

All transforms are PIL-only (no cv2.remap) so thin stroke lines are never
broken by bilinear interpolation — each pixel moves as part of a rigid patch.

PIL AFFINE convention:
  output(x, y) ← input(a·x + b·y + c,  d·x + e·y + f)
  To shift content RIGHT by dx: c = -dx  (source x = output_x - dx)
  To shift content DOWN  by dy: f = -dy

PIL MESH convention:
  Each (box, quad) maps an output rectangle to a source quadrilateral.
  quad = (tl_x, tl_y, tr_x, tr_y, br_x, br_y, bl_x, bl_y)
  For content moving RIGHT by dx: source corners have x = output_corner_x - dx
"""

import numpy as np
from PIL import Image

from .category_map import AnimationType

N_FRAMES = 24
FPS = 12


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _to_rgba(img: Image.Image) -> Image.Image:
    """Convert to RGBA and make near-white pixels transparent."""
    rgba = img.convert("RGBA")
    data = np.array(rgba, dtype=np.uint8)
    white = (data[:, :, 0] > 220) & (data[:, :, 1] > 220) & (data[:, :, 2] > 220)
    data[white, 3] = 0
    return Image.fromarray(data, "RGBA")


def _on_white(img_rgba: Image.Image) -> Image.Image:
    """Composite RGBA onto a white RGB background."""
    bg = Image.new("RGB", img_rgba.size, (255, 255, 255))
    bg.paste(img_rgba, mask=img_rgba.split()[3])
    return bg


def _affine_shift(img: Image.Image, sx: float, sy: float, fill=(255, 255, 255, 0)) -> Image.Image:
    """Translate image content by (sx, sy) pixels — positive sx = move right."""
    return img.transform(
        img.size, Image.AFFINE,
        (1, 0, -sx, 0, 1, -sy),
        resample=Image.BILINEAR,
        fillcolor=fill,
    )


def _object_bounds(alpha: np.ndarray):
    rows = np.where(alpha.any(axis=1))[0]
    cols = np.where(alpha.any(axis=0))[0]
    if len(rows) == 0:
        h, w = alpha.shape
        return 0, h, 0, w, w / 2, h / 2, h, w
    top, bottom = int(rows[0]), int(rows[-1])
    left, right = int(cols[0]), int(cols[-1])
    obj_h = max(bottom - top, 1)
    obj_w = max(right - left, 1)
    cx = (left + right) / 2
    cy = (top + bottom) / 2
    return top, bottom, left, right, cx, cy, obj_h, obj_w


# ---------------------------------------------------------------------------
# Animation generators — all return list[Image RGBA]
# ---------------------------------------------------------------------------

def _sway(img_np, alpha, n_frames):
    """
    Vertical-shear affine: base stays fixed, top leans L/R.
    Single PIL AFFINE — zero line-quality loss.

    Derivation: want  input_x = x - amp*(bottom-y)/obj_h
                             = x + (amp/obj_h)*y - amp*bottom/obj_h
    → (a,b,c, d,e,f) = (1, shear, -shear*bottom, 0, 1, 0)
    """
    top, bottom, left, right, cx, cy, obj_h, obj_w = _object_bounds(alpha)
    max_amp = obj_w * 0.07
    img_pil = Image.fromarray(img_np, "RGBA")

    frames = []
    for i in range(n_frames):
        t = (i / n_frames) * 2 * np.pi
        shear = (max_amp * np.sin(t)) / obj_h
        frame = img_pil.transform(
            img_pil.size, Image.AFFINE,
            (1, shear, -shear * bottom, 0, 1, 0),
            resample=Image.BILINEAR,
            fillcolor=(255, 255, 255, 0),
        )
        frames.append(frame)
    return frames


def _drift(img_np, alpha, n_frames):
    """Lissajous translation — no quality loss (pure affine shift)."""
    top, bottom, left, right, cx, cy, obj_h, obj_w = _object_bounds(alpha)
    amp_x = obj_w * 0.05
    amp_y = obj_h * 0.03
    img_pil = Image.fromarray(img_np, "RGBA")

    frames = []
    for i in range(n_frames):
        t = (i / n_frames) * 2 * np.pi
        frames.append(_affine_shift(img_pil,
                                    amp_x * np.sin(t),
                                    amp_y * np.sin(2 * t + 0.7)))
    return frames


def _spin(img_np, alpha, n_frames):
    """Oscillating rotation around centroid."""
    top, bottom, left, right, cx, cy, obj_h, obj_w = _object_bounds(alpha)
    img_pil = Image.fromarray(img_np, "RGBA")

    frames = []
    for i in range(n_frames):
        t = (i / n_frames) * 2 * np.pi
        frames.append(img_pil.rotate(12 * np.sin(t), center=(cx, cy),
                                     resample=Image.BILINEAR, expand=False))
    return frames


def _bounce(img_np, alpha, n_frames):
    """Vertical bounce with squash/stretch — pure affine."""
    top, bottom, left, right, cx, cy, obj_h, obj_w = _object_bounds(alpha)
    amp = obj_h * 0.07
    img_pil = Image.fromarray(img_np, "RGBA")

    frames = []
    for i in range(n_frames):
        t = (i / n_frames) * 2 * np.pi
        phase = abs(np.sin(t))
        sy = -amp * phase
        squash = 1.0 - 0.04 * phase
        stretch = 1.0 + 0.02 * phase
        frame = img_pil.transform(
            img_pil.size, Image.AFFINE,
            (1 / stretch, 0, cx * (1 - 1 / stretch),
             0, 1 / squash, cy * (1 - 1 / squash) + sy),
            resample=Image.BILINEAR,
            fillcolor=(255, 255, 255, 0),
        )
        frames.append(frame)
    return frames


def _wiggle(img_np, alpha, n_frames):
    """
    Gentle rocking rotation — no mesh needed, zero line artifacts.
    Looks natural for amorphous objects (mushroom, bowl, tank).
    """
    top, bottom, left, right, cx, cy, obj_h, obj_w = _object_bounds(alpha)
    img_pil = Image.fromarray(img_np, "RGBA")

    frames = []
    for i in range(n_frames):
        t = (i / n_frames) * 2 * np.pi
        # Combine rotation with slight vertical bob for liveliness
        angle = 7 * np.sin(t)
        sy = -obj_h * 0.015 * abs(np.sin(2 * t))
        rotated = img_pil.rotate(angle, center=(cx, cy),
                                 resample=Image.BILINEAR, expand=False)
        frame = _affine_shift(rotated, 0, sy)
        frames.append(frame)
    return frames


def _swim(img_np, alpha, n_frames):
    """
    Body wave via PIL MESH vertical strips.
    Many narrow strips (30) keep inter-strip gaps < 1 px for gentle amplitudes.
    """
    top, bottom, left, right, cx, cy, obj_h, obj_w = _object_bounds(alpha)
    H, W = img_np.shape[:2]
    amp = obj_h * 0.09
    wavelength = obj_w * 2.0          # long wavelength → gentle gradient
    img_pil = Image.fromarray(img_np, "RGBA")

    n_strips = 30
    strip_w = W / n_strips

    frames = []
    for i in range(n_frames):
        t = (i / n_frames) * 2 * np.pi
        mesh = []
        for gx in range(n_strips):
            x0 = int(gx * strip_w)
            x1 = int((gx + 1) * strip_w)
            x_c = (gx + 0.5) * strip_w

            # Tail factor: 1 at left edge (tail), 0 at right edge (head)
            x_norm = np.clip((x_c - left) / max(obj_w, 1), 0, 1)
            tail = 1.0 - x_norm

            # Vertical displacement — content moves down when dy > 0
            # source_y = output_y - dy  →  quad y = (0 - dy, H - dy)
            dy = amp * tail * np.sin(2 * np.pi * x_c / wavelength - t)
            mesh.append(((x0, 0, x1, H),
                         (x0, -dy, x0, H - dy, x1, H - dy, x1, -dy)))

        frame = img_pil.transform(img_pil.size, Image.MESH, mesh,
                                  resample=Image.BILINEAR)
        frames.append(frame)
    return frames


def _walk(img_np, alpha, n_frames):
    """Body bob + gentle sway — pure affine."""
    top, bottom, left, right, cx, cy, obj_h, obj_w = _object_bounds(alpha)
    amp_y = obj_h * 0.035
    amp_x = obj_w * 0.020
    img_pil = Image.fromarray(img_np, "RGBA")

    frames = []
    for i in range(n_frames):
        t = (i / n_frames) * 2 * np.pi
        frames.append(_affine_shift(img_pil,
                                    amp_x * np.sin(t),
                                    -amp_y * abs(np.sin(2 * t))))
    return frames


def _shake(img_np, alpha, n_frames):
    """Rapid irregular x-jitter — pure affine."""
    top, bottom, left, right, cx, cy, obj_h, obj_w = _object_bounds(alpha)
    amp = obj_w * 0.018
    img_pil = Image.fromarray(img_np, "RGBA")

    frames = []
    for i in range(n_frames):
        t = (i / n_frames) * 2 * np.pi
        frames.append(_affine_shift(img_pil, amp * np.sin(4 * t) * np.cos(9 * t), 0))
    return frames


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

_GENERATORS = {
    AnimationType.SWAY:   _sway,
    AnimationType.DRIFT:  _drift,
    AnimationType.SPIN:   _spin,
    AnimationType.BOUNCE: _bounce,
    AnimationType.WIGGLE: _wiggle,
    AnimationType.SWIM:   _swim,
    AnimationType.WALK:   _walk,
    AnimationType.SHAKE:  _shake,
}


def generate_frames(
    img_pil: Image.Image,
    anim_type: AnimationType,
    n_frames: int = N_FRAMES,
) -> list[Image.Image]:
    """Return n_frames PIL RGB images forming one seamless loop."""
    img_rgba = _to_rgba(img_pil)
    img_np = np.array(img_rgba, dtype=np.uint8)
    alpha = img_np[:, :, 3]

    gen = _GENERATORS.get(anim_type, _wiggle)
    rgba_frames = gen(img_np, alpha, n_frames)

    return [_on_white(f) for f in rgba_frames]
