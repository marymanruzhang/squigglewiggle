from PIL import Image
try:
    from utils import get_image_info
except:
    pass
# Wait, I don't need to check what it is, I can just see what the prediction was!
# Let me evaluate the image using the current sketch model!
import os
import io
import numpy as np
import tensorflow as tf

def test_pred():
    if not os.path.exists("sketch_model.keras"):
        print("Model not trained yet")
        return
    model = tf.keras.models.load_model("sketch_model.keras")
    import json
    with open("class_indices.json") as f:
        classes = json.load(f)
        
    img = Image.open('hyper sense participant drawings/Participant 35 - B/round_05.png').convert('L')
    arr_raw = 255 - np.array(img)
    coords = np.argwhere(arr_raw > 0)
    y0, x0 = coords.min(axis=0)
    y1, x1 = coords.max(axis=0) + 1
    cropped = arr_raw[y0:y1, x0:x1]
    h, w = cropped.shape
    max_dim = max(h, w)
    pad_y = (max_dim - h) // 2
    pad_x = (max_dim - w) // 2
    border = int(max_dim * 0.1) + 1
    arr_square = np.pad(cropped, ((pad_y+border, max_dim-h-pad_y+border), (pad_x+border, max_dim-w-pad_x+border)), mode='constant')
    
    img_processed = Image.fromarray(arr_square.astype(np.uint8)).resize((28, 28), Image.Resampling.BOX)
    arr = np.array(img_processed).astype('float32') / 255.0
    arr = np.expand_dims(arr, -1)
    arr = np.expand_dims(arr, 0)
    
    preds = model.predict(arr)[0]
    best_idx = np.argmax(preds)
    print(f"Predicted: {classes[str(int(best_idx))]}")

test_pred()
