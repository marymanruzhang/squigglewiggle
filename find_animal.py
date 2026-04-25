import os
import json
from PIL import Image
import numpy as np
import tensorflow as tf
from sketch_preprocess import pil_white_bg_to_model_tensor

model = tf.keras.models.load_model("sketch_model.keras")
with open("class_indices.json") as f:
    classes = json.load(f)

for root, dirs, files in os.walk('hyper sense participant drawings'):
    for file in files:
        if file.endswith('.png'):
            path = os.path.join(root, file)
            arr = pil_white_bg_to_model_tensor(Image.open(path).convert("RGB"))
            preds = model.predict(arr, verbose=0)[0]
            best_idx = np.argmax(preds)
            cat = classes[str(int(best_idx))]
            # the mega categories model (from early training) has "four_legged_animals"
            if cat == "four_legged_animals" or cat in ["dog", "cat", "horse", "pig", "cow", "lion", "tiger"]:
                print(path)
                exit(0)
