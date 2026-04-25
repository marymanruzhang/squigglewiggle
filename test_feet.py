import math
import numpy as np
import cv2
from PIL import Image
from animation_engine.skeletal import _body_bottom, _find_leg_peaks, _walk_phases
from animation_engine.animations import N_FRAMES

def test_feet():
    img_pil = Image.open('hyper sense participant drawings/Participant 35 - B/round_03.png').convert('RGB')
    
    img_rgb = np.array(img_pil)
    gray    = img_rgb.mean(axis=2).astype(np.uint8)
    _, stroke = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)
    H, W = stroke.shape

    bb       = _body_bottom(stroke)
    peaks    = _find_leg_peaks(stroke, bb)
    
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

    legs = []
    for cx, (xl, xr) in zip(peaks, bounds):
        search_top = max(0, bb - 30)
        search_bot = min(H, bb + 20)
        window = stroke[search_top:search_bot, xl:xr]
        rows = np.where(window.any(axis=1))[0]
        piv_y = search_top + int(rows[0]) if len(rows) else bb

        seg = np.zeros_like(stroke)
        seg[piv_y:, xl:xr] = stroke[piv_y:, xl:xr]
        ys, xs = np.where(seg > 0)
        if len(ys) == 0:
            continue
            
        leg_height = ys.max() - piv_y
        if leg_height < 35:
            # Short leg (just feet). Lower the pivot so we don't grab the body.
            piv_y = max(piv_y, ys.max() - 12)
            # update segment
            seg = np.zeros_like(stroke)
            seg[piv_y:, xl:xr] = stroke[piv_y:, xl:xr]
            ys, xs = np.where(seg > 0)
            
        # Knee is at bottom for short legs, halfway for normal legs
        knee_y = ys.max() if leg_height < 35 else (ys.max() + piv_y) / 2
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
        
    # the rest of generate_skeletal_frames
    body_np = np.where(stroke > 0, 0, 255).astype(np.uint8)
    for ld in legs:
        xl, xr, piv_y = ld["xl"], ld["xr"], ld["piv_y"]
        body_np[piv_y:, xl:xr] = np.where(stroke[piv_y:, xl:xr] > 0, 255, body_np[piv_y:, xl:xr])
    body_pil = Image.fromarray(body_np).convert("RGB")
    body_arr = np.array(body_pil)

    try:
        from animation_engine.animations import FPS
    except ImportError:
        FPS = 12
    n_frames = N_FRAMES
    phases = _walk_phases(len(legs))
    freq = 1.0
    max_swing = 35.0
    max_lift = 20
    travel_x = min(int(W * 0.14), 120)
    max_knee_bend = 45.0
    
    frames = []
    for fi in range(n_frames):
        t = (fi / n_frames) * 2 * math.pi
        canvas_np = np.full((H, W), 255, dtype=np.uint8)

        for i, ld in enumerate(legs):
            forward = math.sin(freq * t + phases[i])
            angle_hip = -max_swing * forward
            angle_knee = max_knee_bend * max(0.0, forward)
            lift = int(max_lift * max(0.0, forward))
            piv_x, piv_y = ld["pivot"]
            
            rad_h = math.radians(angle_hip)
            cos_h, sin_h = math.cos(rad_h), math.sin(rad_h)

            ux = cos_h * ld["u_rel_x"] - sin_h * ld["u_rel_y"]
            uy = sin_h * ld["u_rel_x"] + cos_h * ld["u_rel_y"] - lift
            px_u, py_u = np.round(ux + piv_x).astype(np.int32), np.round(uy + piv_y).astype(np.int32)
            vu = (px_u >= 0) & (px_u < W) & (py_u >= 0) & (py_u < H)
            canvas_np[py_u[vu], px_u[vu]] = 0

            rad_tot = math.radians(angle_hip + angle_knee)
            cos_tot, sin_tot = math.cos(rad_tot), math.sin(rad_tot)
            r_lx = cos_tot * ld["l_rel_x"] - sin_tot * ld["l_rel_y"]
            r_ly = sin_tot * ld["l_rel_x"] + cos_tot * ld["l_rel_y"]
            
            hk_dist = ld["knee"][1] - piv_y
            k_tx, k_ty = -sin_h * hk_dist, cos_h * hk_dist - lift
            px_l, py_l = np.round(r_lx + k_tx + piv_x).astype(np.int32), np.round(r_ly + k_ty + piv_y).astype(np.int32)
            vl = (px_l >= 0) & (px_l < W) & (py_l >= 0) & (py_l < H)
            canvas_np[py_l[vl], px_l[vl]] = 0

        canvas_rgb = np.stack([canvas_np]*3, axis=2)
        canvas_rgb = np.minimum(canvas_rgb, body_arr)
        canvas = Image.fromarray(canvas_rgb)
        bob = int(-3 * abs(math.sin(2 * freq * t)))
        x_off = int(travel_x * math.sin(t))
        canvas = canvas.transform(canvas.size, Image.AFFINE, (1, 0, -x_off, 0, 1, bob), resample=Image.NEAREST, fillcolor=(255, 255, 255))
        frames.append(canvas)

    frames[0].save("test_feet.gif", format="GIF", save_all=True, append_images=frames[1:], loop=0, duration=int(1000/12), optimize=False)

test_feet()
