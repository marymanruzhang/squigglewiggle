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

def check_image(img_path):
    img_pil = Image.open(img_path).convert("RGB")
    img_rgb = np.array(img_pil)
    gray = img_rgb.mean(axis=2).astype(np.uint8)
    _, stroke = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)
    H, W = stroke.shape
    bb = _body_bottom(stroke)
    peaks = _find_leg_peaks(stroke, bb)
    
    print(f"\n{img_path}:")
    print(f"Image H: {H}, W: {W}")
    print(f"body_bottom: {bb}")
    
    bounds = []
    for i, cx in enumerate(peaks):
        if i == 0:
            left = max(0, cx - ((peaks[1] - peaks[0]) // 2 if len(peaks) > 1 else cx))
        else:
            left = (cx + peaks[i - 1]) // 2
        
        if i == len(peaks) - 1:
            right = min(W, cx + ((peaks[-1] - peaks[-2]) // 2 if len(peaks) > 1 else W - cx))
        else:
            right = (cx + peaks[i + 1]) // 2
        bounds.append((left, right))
        
    for cx, (xl, xr) in zip(peaks, bounds):
        search_top = max(0, bb - 30)
        search_bot = min(H, bb + 20)
        window = stroke[search_top:search_bot, xl:xr]
        rows = np.where(window.any(axis=1))[0]
        piv_y = search_top + int(rows[0]) if len(rows) else bb
        
        seg = np.zeros_like(stroke)
        seg[piv_y:, xl:xr] = stroke[piv_y:, xl:xr]
        if not seg.any():
            continue
        ys, xs = np.where(seg > 0)
        leg_height = ys.max() - piv_y
        print(f"  Leg peak x={cx}: piv_y={piv_y}, bottom_y={ys.max()}, leg_height={leg_height}")

check_image("Participant 23/Copy of round_03.png")
check_image("Participant 23/Copy of round_04.png")

