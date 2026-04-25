import numpy as np
import cv2
import math
from PIL import Image
from skimage.transform import PiecewiseAffineTransform, warp

def generate_skeletal_frames(img_pil, n_frames=24):
    from animation_engine.skeletal import _body_bottom, _find_leg_peaks, _build_leg_data, _walk_phases
    
    img_rgb = np.array(img_pil.convert("RGB"))
    gray = img_rgb.mean(axis=2).astype(np.uint8)
    _, stroke = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)
    H, W = stroke.shape

    bb = _body_bottom(stroke)
    peaks = _find_leg_peaks(stroke, bb)
    leg_data = _build_leg_data(stroke, peaks, bb)
    
    # Store foot_y for each leg
    for ld in leg_data:
        piv_x, piv_y = ld["pivot"]
        xl, xr = ld["xl"], ld["xr"]
        leg_stroke = stroke[piv_y:, xl:xr]
        ys, _ = np.where(leg_stroke > 0)
        if len(ys) > 0:
            ld["foot_y"] = piv_y + ys.max()
        else:
            ld["foot_y"] = ld["knee"][1] + 10

    # fixed body points: take some body pixels
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
    
    # Add leg pivot points to base_src (they are fixed!)
    for ld in leg_data:
        px, py = ld["pivot"]
        base_src = np.vstack((base_src, [[px, py]]))
        
    n_legs = len(leg_data)
    phases = _walk_phases(n_legs)
    freq = 1.0
    max_swing = 35.0
    max_knee_bend = 45.0
    max_lift = 20
    travel_x = min(int(W * 0.14), 120)
    
    frames = []
    
    # Original image for warping
    canvas_rgb = np.array(img_pil.convert("RGB"))
    
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
            
            # --- Upper leg rotation
            rad_h = math.radians(angle_hip)
            sh, ch = math.sin(rad_h), math.cos(rad_h)
            
            new_kx = px + ch*(kx - px) - sh*(ky - py)
            new_ky = py + sh*(kx - px) + ch*(ky - py) - lift
            
            src_pts.append([kx, ky])
            dst_pts.append([new_kx, new_ky])
            
            # --- Lower leg rotation
            rad_tot = math.radians(angle_hip + angle_knee)
            st, ct = math.sin(rad_tot), math.cos(rad_tot)
            
            new_fx = new_kx + ct*(fx - kx) - st*(fy - ky)
            new_fy = new_ky + st*(fx - kx) + ct*(fy - ky)
            
            src_pts.append([fx, fy])
            dst_pts.append([new_fx, new_fy])
            
            # Pad the leg width with extra points so the leg doesn't collapse!
            # Left and right of knee/foot
            lw = (ld["xr"] - ld["xl"]) // 2
            
            src_pts.append([kx - lw, ky])
            dst_pts.append([new_kx - ch*lw, new_ky - sh*lw])
            src_pts.append([kx + lw, ky])
            dst_pts.append([new_kx + ch*lw, new_ky + sh*lw])
            
            src_pts.append([fx - lw, fy])
            dst_pts.append([new_fx - ct*lw, new_fy - st*lw])
            src_pts.append([fx + lw, fy])
            dst_pts.append([new_fx + ct*lw, new_fy + st*lw])

        src_pts = np.array(src_pts)
        dst_pts = np.array(dst_pts)
        
        tform = PiecewiseAffineTransform()
        tform.estimate(dst_pts, src_pts) # warp requires dst -> src mapping! inverse
        warped = warp(canvas_rgb, tform, output_shape=(H, W), preserve_range=True, mode='constant', cval=255)
        
        # bob & walk
        img_w = Image.fromarray(warped.astype(np.uint8))
        bob = int(-3 * abs(math.sin(2 * freq * t)))
        x_off = int(travel_x * math.sin(t))
        final_transformed = img_w.transform(
            img_w.size, Image.AFFINE,
            (1, 0, -x_off, 0, 1, bob),
            resample=Image.NEAREST,
            fillcolor=(255, 255, 255),
        )
        frames.append(final_transformed)
        
    return frames

if __name__ == "__main__":
    img = Image.open('hyper sense participant drawings/Participant 14 - D/round_02.png')
    frames = generate_skeletal_frames(img)
    frames[0].save('mesh_skel.gif', save_all=True, append_images=frames[1:], loop=0, duration=83)
    print("Saved mesh_skel.gif")
