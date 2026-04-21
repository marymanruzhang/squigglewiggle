import numpy as np
from PIL import Image

# Create a small image (e.g. 10x10) with a single white pixel at (1, 1) to test MESH bounds
img = Image.new("RGB", (10, 10), "black")
pixels = img.load()
pixels[1, 1] = (255, 255, 255)

# We want to map output box (0,0,10,10) to source box (0,0,10,10).
# Let's try tl, bl, br, tr
mesh_bl = [((0, 0, 10, 10), (0, 0, 0, 10, 10, 10, 10, 0))]
img_bl = img.transform((10, 10), Image.MESH, mesh_bl)

# Let's try tl, tr, br, bl
mesh_tr = [((0, 0, 10, 10), (0, 0, 10, 0, 10, 10, 0, 10))]
img_tr = img.transform((10, 10), Image.MESH, mesh_tr)

print("TL, BL, BR, TR result is white at (1,1):", img_bl.getpixel((1, 1)) == (255, 255, 255))
print("TL, TR, BR, BL result is white at (1,1):", img_tr.getpixel((1, 1)) == (255, 255, 255))
