from PIL import Image
from animation_engine.skeletal import generate_skeletal_frames

img = Image.open('hyper sense participant drawings/Participant 14 - D/round_02.png').convert('RGB')
frames = generate_skeletal_frames(img, n_frames=24)
frames[0].save('test_skel.gif', save_all=True, append_images=frames[1:], loop=0, duration=83)
print("Saved test_skel.gif")
