def fix_joints(canvas_rgba, ld, angle_hip, angle_knee, lift, piv_x, piv_y):
    from PIL import ImageDraw
    import math
    draw = ImageDraw.Draw(canvas_rgba)
    R = 6 # approximate stroke radius
    
    # Draw pivot joint
    draw.ellipse([(piv_x-R, piv_y-lift-R), (piv_x+R, piv_y-lift+R)], fill=(0,0,0,255))
    
    # Calculate new knee location
    rad_h = math.radians(angle_hip)
    sin_h = math.sin(rad_h)
    cos_h = math.cos(rad_h)
    hk_dist = ld["knee"][1] - piv_y
    new_knee_x = piv_x - sin_h * hk_dist
    new_knee_y = piv_y + cos_h * hk_dist - lift
    
    # Draw knee joint
    draw.ellipse([(new_knee_x-R, new_knee_y-R), (new_knee_x+R, new_knee_y+R)], fill=(0,0,0,255))
