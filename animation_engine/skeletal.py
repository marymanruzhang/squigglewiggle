"""
Limb / mesh animation (local substitute for the “AnimatedDrawings”-style
pipeline: detect vertical limb regions, then piecewise-affine warp + walk).

This path runs only when `limb_bearing.should_use_limb_mesh(category)` is True.

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


def generate_skeletal_frames(img_pil: Image.Image, n_frames: int = N_FRAMES) -> list[Image.Image]:
    """
    Find legs, walk cycle via piecewise-affine mesh so strokes bend continuously (fewer breaks).
    """
    from .category_map import AnimationType
    img_rgb = np.array(img_pil.convert("RGB"))
    gray    = img_rgb.mean(axis=2).astype(np.uint8)
    _, stroke = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)
    H, W = stroke.shape

    bb       = _body_bottom(stroke)
    peaks    = _find_leg_peaks(stroke, bb)
    leg_data = _build_leg_data(stroke, peaks, bb)

    if len(leg_data) < 2:
        from .animations import generate_frames
        return generate_frames(img_pil, AnimationType.WALK, n_frames)

    # Pre-calculate extended foot geometry limits for each leg
    for ld in leg_data:
        piv_x, piv_y = ld["pivot"]
        xl, xr = ld["xl"], ld["xr"]
        leg_stroke = stroke[piv_y:, xl:xr]
        ys, _ = np.where(leg_stroke > 0)
        if len(ys) > 0:
            ld["foot_y"] = piv_y + ys.max()
        else:
            ld["foot_y"] = ld["knee"][1] + 10

    # Mesh Configuration: Build rigid anchors covering the body
    body_ys, body_xs = np.where((stroke > 0) & (np.arange(H)[:, None] < bb))
    if len(body_ys) > 100:
        idx = np.linspace(0, len(body_ys)-1, 50, dtype=int)
        fixed_body = np.column_stack((body_xs[idx], body_ys[idx]))
    else:
        fixed_body = np.column_stack((body_xs, body_ys))
        
    corners = np.array([
        [0, 0], [W-1, 0], [0, H-1], [W-1, H-1],
        [0, H//2], [W-1, H//2], [W//2, 0]
    ])
    
    base_src = np.vstack((corners, fixed_body))
    
    for ld in leg_data:
        px, py = ld["pivot"]
        base_src = np.vstack((base_src, [[px, py]]))

    n_legs    = len(leg_data)
    phases    = _walk_phases(n_legs)
    freq      = 1.0
    max_swing = 35.0
    max_lift  = 20
    travel_x  = min(int(W * 0.14), 120)
    max_knee_bend = 45.0
    
    canvas_rgb = np.array(img_pil.convert("RGB"))
    from skimage.transform import PiecewiseAffineTransform, warp

    frames = []
    for fi in range(n_frames):
        t = (fi / n_frames) * 2 * math.pi
        
        src_pts = list(base_src)
        dst_pts = list(base_src)

        for i, ld in enumerate(leg_data):
            forward = math.sin(freq * t + phases[i])
            angle_hip = -max_swing * forward
            angle_knee = max_knee_bend * max(0.0, forward)
            lift = int(max_lift * max(0.0, forward))
            
            px, py = ld["pivot"]
            kx, ky = ld["knee"]
            fx = px
            fy = ld["foot_y"]
            
            rad_h = math.radians(angle_hip)
            sh, ch = math.sin(rad_h), math.cos(rad_h)
            
            new_kx = px + ch*(kx - px) - sh*(ky - py)
            new_ky = py + sh*(kx - px) + ch*(ky - py) - lift
            
            src_pts.append([kx, ky])
            dst_pts.append([new_kx, new_ky])
            
            rad_tot = math.radians(angle_hip + angle_knee)
            st, ct = math.sin(rad_tot), math.cos(rad_tot)
            
            new_fx = new_kx + ct*(fx - kx) - st*(fy - ky)
            new_fy = new_ky + st*(fx - kx) + ct*(fy - ky)
            
            src_pts.append([fx, fy])
            dst_pts.append([new_fx, new_fy])
            
            lw = (ld["xr"] - ld["xl"]) // 2
            
            src_pts.extend([[kx - lw, ky], [kx + lw, ky], [fx - lw, fy], [fx + lw, fy]])
            dst_pts.extend([
                [new_kx - ch*lw, new_ky - sh*lw], [new_kx + ch*lw, new_ky + sh*lw],
                [new_fx - ct*lw, new_fy - st*lw], [new_fx + ct*lw, new_fy + st*lw]
            ])

        src_pts = np.array(src_pts)
        dst_pts = np.array(dst_pts)
        
        tform = PiecewiseAffineTransform()
        tform.estimate(dst_pts, src_pts) 
        warped = warp(
            canvas_rgb,
            tform,
            output_shape=(H, W),
            order=1,
            preserve_range=True,
            mode="constant",
            cval=255.0,
        )
        img_w = Image.fromarray(np.clip(warped, 0, 255).astype(np.uint8))
        bob = int(-3 * abs(math.sin(2 * freq * t)))
        x_off = int(travel_x * math.sin(t))
        final_transformed = img_w.transform(
            img_w.size,
            Image.AFFINE,
            (1, 0, -x_off, 0, 1, bob),
            resample=Image.BICUBIC,
            fillcolor=(255, 255, 255),
        )

        frames.append(final_transformed)

    return frames
