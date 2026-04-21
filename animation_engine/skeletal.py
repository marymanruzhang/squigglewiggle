"""
Skeletal animation — each leg is extracted as stroke-pixel coordinates,
rotated around its pivot, and drawn independently each frame.

Walk cycle per leg (phase φ, t in [0, 2π]):
  forward  = sin(t + φ)           ← −1 = fully back, +1 = fully forward
  angle    = −max_swing * forward ← negative PIL angle = CW = rightward
  lift     = max_lift * max(0, forward)  ← upward shift, forward phase only

Drawing order each frame:
  1. Rotated leg pixels (black dots at computed positions)
  2. Body image ON TOP (body strokes excluding the leg pixels)
     → body naturally covers the pivot junction

Detection:
  _body_bottom      → lowest row whose horizontal stroke span > 12 % of W
  _find_leg_peaks   → column-projection peaks below body_bottom
  _build_leg_data   → per-leg: pivot, relative stroke-pixel coords, narrow column
"""

import math
import numpy as np
import cv2
from PIL import Image

from .animations import N_FRAMES


# -----------------------------------------------------------------------
# Detection helpers
# -----------------------------------------------------------------------

def _body_bottom(stroke: np.ndarray) -> int:
    H, W = stroke.shape
    for y in range(H - 1, H // 4, -1):
        nz = np.where(stroke[y] > 0)[0]
        if len(nz) >= 2 and (nz[-1] - nz[0]) > W * 0.12:
            return y
    return H * 2 // 3


def _find_leg_peaks(stroke: np.ndarray, body_bottom: int,
                    min_dist: int = 8, merge_gap: int = 15,
                    thresh_frac: float = 0.20) -> list[int]:
    col = stroke[max(0, body_bottom - 10):, :].sum(axis=0).astype(float)
    col_s = np.convolve(col, np.ones(3) / 3, mode='same')
    threshold = col_s.max() * thresh_frac

    peaks: list[int] = []
    i = 0
    while i < len(col_s):
        if col_s[i] > threshold:
            start = i
            while i < len(col_s) and col_s[i] > threshold:
                i += 1
            cx = (start + i - 1) // 2
            if not peaks or cx - peaks[-1] >= min_dist:
                peaks.append(cx)
        else:
            i += 1

    merged: list[int] = []
    for p in peaks:
        if merged and p - merged[-1] < merge_gap:
            merged[-1] = (merged[-1] + p) // 2
        else:
            merged.append(p)
    return merged


def _build_leg_data(stroke: np.ndarray, peaks: list[int],
                    body_bottom: int) -> list[dict]:
    """
    For each detected leg peak, return:
      pivot      : (x, y) in image coordinates
      rel_x/y   : stroke pixel offsets from pivot (for rotation)
      xl, xr    : narrow column bounds (used to erase from body image)
    """
    H, W = stroke.shape
    if not peaks:
        return []

    # Narrow column bounds: outer legs mirror the nearest inner gap
    # (prevents leg-0 from spanning x=0..413 and grabbing body-wall strokes)
    bounds: list[tuple[int, int]] = []
    for i, cx in enumerate(peaks):
        if i == 0:
            half = (peaks[1] - peaks[0]) // 2 if len(peaks) > 1 else cx
            left = max(0, cx - half)
        else:
            left = (cx + peaks[i - 1]) // 2

        if i == len(peaks) - 1:
            half = (peaks[-1] - peaks[-2]) // 2 if len(peaks) > 1 else W - cx
            right = min(W, cx + half)
        else:
            right = (cx + peaks[i + 1]) // 2
        bounds.append((left, right))

    legs = []
    for cx, (xl, xr) in zip(peaks, bounds):
        # Pivot: topmost stroke pixel near body_bottom in this column slice
        search_top = max(0, body_bottom - 30)
        search_bot = min(H, body_bottom + 20)
        window = stroke[search_top:search_bot, xl:xr]
        rows = np.where(window.any(axis=1))[0]
        piv_y = search_top + int(rows[0]) if len(rows) else body_bottom

        # Stroke pixels belonging to this leg: below pivot in its column
        seg = np.zeros_like(stroke)
        seg[piv_y:, xl:xr] = stroke[piv_y:, xl:xr]

        # Dilate 1 px so rotated strokes stay connected (fills rotation gaps)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        seg = cv2.dilate(seg, kernel, iterations=1)

        ys, xs = np.where(seg > 0)
        if len(ys) == 0:
            continue
            
        leg_height = ys.max() - piv_y
        if leg_height < 40:
            # Animal doesn't have limbs, just feet. Lower the pivot to avoid segmenting the body.
            piv_y = max(piv_y, ys.max() - 15)
            # Recompute the mask slice
            seg = np.zeros_like(stroke)
            seg[piv_y:, xl:xr] = stroke[piv_y:, xl:xr]
            seg = cv2.dilate(seg, kernel, iterations=1)
            ys, xs = np.where(seg > 0)
            # Place knee at the bottom to disable knee joints for feet-only animals
            knee_y = ys.max()
        else:
            knee_y = (ys.max() + piv_y) / 2
            
        knee_x = cx
        
        upper_mask = ys < knee_y
        lower_mask = ys >= knee_y

        legs.append({
            "pivot":  (cx, piv_y),
            "knee":   (knee_x, knee_y),
            "u_rel_x": (xs[upper_mask] - cx).astype(np.float32),
            "u_rel_y": (ys[upper_mask] - piv_y).astype(np.float32),
            "l_rel_x": (xs[lower_mask] - knee_x).astype(np.float32),
            "l_rel_y": (ys[lower_mask] - knee_y).astype(np.float32),
            "xl":     xl,
            "xr":     xr,
            "piv_y":  piv_y,
        })
    return legs


# -----------------------------------------------------------------------
# Gait phases
# -----------------------------------------------------------------------

def _walk_phases(n: int) -> list[float]:
    """Sequential walk — each leg offset by 2π/n."""
    return [i * (2 * math.pi / n) for i in range(n)]


# -----------------------------------------------------------------------
# Public entry point
# -----------------------------------------------------------------------

def generate_skeletal_frames(
    img_pil: Image.Image,
    n_frames: int = N_FRAMES,
) -> list[Image.Image]:
    """
    Animate with a lift-and-swing walk cycle.

    Each leg's stroke pixels are rotated around their pivot each frame.
    The body image (with leg pixels removed) is drawn on top to cover junctions.
    """
    from .animations import generate_frames
    from .category_map import AnimationType

    img_rgb = np.array(img_pil.convert("RGB"))
    gray    = img_rgb.mean(axis=2).astype(np.uint8)
    _, stroke = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)
    H, W = stroke.shape

    bb       = _body_bottom(stroke)
    peaks    = _find_leg_peaks(stroke, bb)
    leg_data = _build_leg_data(stroke, peaks, bb)

    if len(leg_data) < 2:
        return generate_frames(img_pil, AnimationType.WALK, n_frames)

    # Body image: full stroke MINUS each leg's pixels below its pivot.
    # This lets the animated legs show through without the body freezing them.
    body_np = np.where(stroke > 0, 0, 255).astype(np.uint8)
    for ld in leg_data:
        xl, xr, piv_y = ld["xl"], ld["xr"], ld["piv_y"]
        body_np[piv_y:, xl:xr] = np.where(
            stroke[piv_y:, xl:xr] > 0, 255, body_np[piv_y:, xl:xr]
        )
    body_pil = Image.fromarray(body_np).convert("RGB")
    body_arr = np.array(body_pil)

    n_legs    = len(leg_data)
    phases    = _walk_phases(n_legs)
    freq      = 1.0
    max_swing = 35.0   # degrees; larger = more visible on short legs
    max_lift  = 20     # pixels upward during forward phase
    travel_x  = min(int(W * 0.14), 120)
    max_knee_bend = 45.0  # degrees

    frames = []
    for fi in range(n_frames):
        t = (fi / n_frames) * 2 * math.pi

        # ── 1. white canvas (grayscale, convert to RGB at end) ───────
        canvas_np = np.full((H, W), 255, dtype=np.uint8)

        # ── 2. draw each leg's rotated stroke pixels ─────────────────
        for i, ld in enumerate(leg_data):
            forward = math.sin(freq * t + phases[i])   # −1 … +1
            angle_hip = -max_swing * forward            # CW = rightward swing
            angle_knee = max_knee_bend * max(0.0, forward) # bend backward to lift foot
            lift = int(max_lift * max(0.0, forward))    # upward, forward phase only

            piv_x, piv_y = ld["pivot"]
            
            # --- Upper leg rotation
            rad_h = math.radians(angle_hip)
            cos_h = math.cos(rad_h)
            sin_h = math.sin(rad_h)

            ux = cos_h * ld["u_rel_x"] - sin_h * ld["u_rel_y"]
            uy = sin_h * ld["u_rel_x"] + cos_h * ld["u_rel_y"] - lift
            
            px_u = np.round(ux + piv_x).astype(np.int32)
            py_u = np.round(uy + piv_y).astype(np.int32)
            
            valid_u = (px_u >= 0) & (px_u < W) & (py_u >= 0) & (py_u < H)
            canvas_np[py_u[valid_u], px_u[valid_u]] = 0   # black stroke pixel

            # --- Lower leg rotation
            rad_tot = math.radians(angle_hip + angle_knee)
            cos_tot = math.cos(rad_tot)
            sin_tot = math.sin(rad_tot)

            r_lx = cos_tot * ld["l_rel_x"] - sin_tot * ld["l_rel_y"]
            r_ly = sin_tot * ld["l_rel_x"] + cos_tot * ld["l_rel_y"]
            
            hk_dist = ld["knee"][1] - piv_y
            k_tx = -sin_h * hk_dist
            k_ty = cos_h * hk_dist - lift
            
            px_l = np.round(r_lx + k_tx + piv_x).astype(np.int32)
            py_l = np.round(r_ly + k_ty + piv_y).astype(np.int32)

            valid_l = (px_l >= 0) & (px_l < W) & (py_l >= 0) & (py_l < H)
            canvas_np[py_l[valid_l], px_l[valid_l]] = 0   # black stroke pixel

        # ── 3. body on top (covers pivot junctions) ──────────────────
        # body_arr is RGB; canvas_np is grayscale — broadcast to RGB then min
        canvas_rgb = np.stack([canvas_np] * 3, axis=2)
        canvas_rgb = np.minimum(canvas_rgb, body_arr)

        # ── 4. whole-body bob + horizontal walk ───────────────────────
        canvas = Image.fromarray(canvas_rgb)
        bob    = int(-3 * abs(math.sin(2 * freq * t)))
        x_off  = int(travel_x * math.sin(t))
        canvas = canvas.transform(
            canvas.size, Image.AFFINE,
            (1, 0, -x_off, 0, 1, bob),
            resample=Image.NEAREST,
            fillcolor=(255, 255, 255),
        )

        frames.append(canvas)

    return frames
