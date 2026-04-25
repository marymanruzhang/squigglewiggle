import numpy as np
import math
from PIL import Image

def get_pil_affine(angle_deg, px, py, tx=0, ty=0):
    # angle_deg: standard rotation angle (same as in skeletal.py: angle_hip)
    # the code uses: 
    # rad = math.radians(angle)
    # cos, sin = cos(rad), sin(rad)
    # ux = cos * rel_x - sin * rel_y
    # uy = sin * rel_x + cos * rel_y - lift
    
    # We want matrix M such that [x_out, y_out, 1].T = M @ [x_in, y_in, 1].T
    # then return M_inv[:2].flatten()
    
    rad = math.radians(angle_deg)
    C, S = math.cos(rad), math.sin(rad)
    
    M_piv_to_ori = np.array([
        [1, 0, -px],
        [0, 1, -py],
        [0, 0, 1]
    ])
    M_rot = np.array([
        [C, -S, 0],
        [S, C, 0],
        [0, 0, 1]
    ])
    M_ori_to_piv_trans = np.array([
        [1, 0, px + tx],
        [0, 1, py + ty],
        [0, 0, 1]
    ])
    M_fwd = M_ori_to_piv_trans @ M_rot @ M_piv_to_ori
    M_inv = np.linalg.inv(M_fwd)
    
    return tuple(M_inv[:2].flatten())

print(get_pil_affine(45, 100, 100, 0, -20))
