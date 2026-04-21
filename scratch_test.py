import math
import numpy as np
import cv2
from PIL import Image

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

    peaks = []
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

    merged = []
    for p in peaks:
        if merged and p - merged[-1] < merge_gap:
            merged[-1] = (merged[-1] + p) // 2
        else:
            merged.append(p)
    return merged

def test_on_image():
    from animation_engine.skeletal import _body_bottom, _find_leg_peaks, _build_leg_data, _walk_phases
    img_pil = Image.open('Participant 12 - B/round_03.png').convert('RGB')
    
    img_rgb = np.array(img_pil)
    gray    = img_rgb.mean(axis=2).astype(np.uint8)
    _, stroke = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)
    H, W = stroke.shape

    bb       = _body_bottom(stroke)
    peaks    = _find_leg_peaks(stroke, bb)
    leg_data = _build_leg_data(stroke, peaks, bb)
    
    # Let's rewrite leg_data logic to include knees and see
    new_leg_data = []
    for ld in leg_data:
        cx, piv_y = ld["pivot"]
        rel_x, rel_y = ld["rel_x"], ld["rel_y"]
        ys = rel_y + piv_y
        xs = rel_x + cx
        knee_y = (ys.max() + piv_y) / 2
        knee_x = cx
        
        upper_mask = ys < knee_y
        lower_mask = ys >= knee_y
        
        new_leg_data.append({
            "pivot": (cx, piv_y),
            "knee": (knee_x, knee_y),
            "u_rel_x": (xs[upper_mask] - cx).astype(np.float32),
            "u_rel_y": (ys[upper_mask] - piv_y).astype(np.float32),
            "l_rel_x": (xs[lower_mask] - knee_x).astype(np.float32),
            "l_rel_y": (ys[lower_mask] - knee_y).astype(np.float32),
            "xl": ld["xl"],
            "xr": ld["xr"],
            "piv_y": piv_y
        })
    print(f"Detected {len(new_leg_data)} legs")
    for i, ld in enumerate(new_leg_data):
        print(f"Leg {i}: pivot {ld['pivot']}, knee {ld['knee']}, upper pts {len(ld['u_rel_x'])}, lower pts {len(ld['l_rel_x'])}")
        
test_on_image()
