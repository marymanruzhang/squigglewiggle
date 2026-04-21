"""
Auto-segment a sketch image into individual drawn objects.

Works on white-background line drawings:
  1. Threshold dark strokes
  2. Dilate to bridge gaps within one drawing
  3. Connected-component labelling
  4. Return each component's bounding box + isolated crop
"""

import numpy as np
import cv2
from PIL import Image


def segment_objects(
    img_pil: Image.Image,
    dilation_px: int = 20,
    min_area: int = 2000,
) -> list[dict]:
    """
    Detect and return individual drawn objects from a sketch.

    Returns a list of dicts:
        {
            "bbox": (x, y, w, h),   # pixel coords in original image
            "crop": PIL.Image,       # RGBA crop (white bg → transparent)
            "centroid": (cx, cy),
        }
    Sorted left-to-right, top-to-bottom.
    """
    img_np = np.array(img_pil.convert("RGB"))
    gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY)

    # Threshold: strokes are dark (<200), background is white
    _, binary = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)

    # Dilate to connect strokes belonging to the same object
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilation_px, dilation_px))
    dilated = cv2.dilate(binary, kernel)

    # Connected components
    n_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(dilated)

    objects = []
    for label in range(1, n_labels):  # skip background (label 0)
        area = stats[label, cv2.CC_STAT_AREA]
        if area < min_area:
            continue

        x = int(stats[label, cv2.CC_STAT_LEFT])
        y = int(stats[label, cv2.CC_STAT_TOP])
        w = int(stats[label, cv2.CC_STAT_WIDTH])
        h = int(stats[label, cv2.CC_STAT_HEIGHT])
        cx, cy = float(centroids[label][0]), float(centroids[label][1])

        # Pad bounding box slightly so strokes at edges aren't clipped
        pad = 10
        x1 = max(x - pad, 0)
        y1 = max(y - pad, 0)
        x2 = min(x + w + pad, img_pil.width)
        y2 = min(y + h + pad, img_pil.height)

        crop = img_pil.crop((x1, y1, x2, y2))

        objects.append({
            "bbox": (x1, y1, x2 - x1, y2 - y1),
            "crop": crop,
            "centroid": (cx, cy),
        })

    # Sort top-to-bottom, left-to-right
    objects.sort(key=lambda o: (o["centroid"][1], o["centroid"][0]))
    return objects
