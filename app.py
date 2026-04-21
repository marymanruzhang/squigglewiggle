import os
import io
import json
import base64
import uuid
import numpy as np
import tensorflow as tf
from PIL import Image, ImageDraw
from flask import Flask, request, jsonify, send_from_directory
from animation_engine.pipeline import animate

app = Flask(__name__, static_folder='static')
app.config['OUTPUT_FOLDER'] = 'output_api'
os.makedirs(app.config['OUTPUT_FOLDER'], exist_ok=True)

MODEL_PATH = 'sketch_model.keras'
CLASS_IDX_PATH = 'class_indices.json'

model = None
classes = []

@app.before_request
def load_model():
    global model, classes
    if model is None and os.path.exists(MODEL_PATH):
        try:
            model = tf.keras.models.load_model(MODEL_PATH)
            with open(CLASS_IDX_PATH, 'r') as f:
                classes = json.load(f)
        except Exception as e:
            print("Error loading model:", e)

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/static/<path:filename>')
def serve_static(filename):
    return send_from_directory('static', filename)

@app.route('/output/<path:filename>')
def serve_output(filename):
    return send_from_directory(app.config['OUTPUT_FOLDER'], filename)

@app.route('/api/animate', methods=['POST'])
def animate_sketch():
    if model is None:
        return jsonify({'error': 'Model not loaded yet. Wait for training to complete.'}), 503

    data = request.json
    if not data or 'image' not in data:
        return jsonify({'error': 'No image provided'}), 400

    image_data = data['image']
    if 'base64,' in image_data:
        image_data = image_data.split('base64,')[1]
    
    image_bytes = base64.b64decode(image_data)
    img = Image.open(io.BytesIO(image_bytes))
    
    filename_base = str(uuid.uuid4())
    raw_path = os.path.join(app.config['OUTPUT_FOLDER'], f"{filename_base}.png")
    
    if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
        bg = Image.new('RGB', img.size, (255, 255, 255))
        if len(img.split()) == 4:
            bg.paste(img, mask=img.split()[3])
        else:
            bg.paste(img)
        bg.save(raw_path)
    strokes = data.get('strokes', [])
    if strokes:
        min_x = min([min(x_arr) for x_arr, y_arr in strokes])
        max_x = max([max(x_arr) for x_arr, y_arr in strokes])
        min_y = min([min(y_arr) for x_arr, y_arr in strokes])
        max_y = max([max(y_arr) for x_arr, y_arr in strokes])
        
        width = max(max_x - min_x, 1)
        height = max(max_y - min_y, 1)
        max_dim = max(width, height)
        
        scale = 230.0 / max_dim
        x_offset = (255 - width * scale) / 2
        y_offset = (255 - height * scale) / 2
        
        img_qd = Image.new('L', (256, 256), 0)
        draw = ImageDraw.Draw(img_qd)
        
        for x_arr, y_arr in strokes:
            pts = [( (x - min_x) * scale + x_offset, (y - min_y) * scale + y_offset ) for x, y in zip(x_arr, y_arr)]
            if len(pts) == 1:
                draw.point(pts[0], fill=255)
            elif len(pts) > 1:
                draw.line(pts, fill=255, width=12)
                
        try:
            resample_filter = Image.Resampling.BILINEAR
        except AttributeError:
            resample_filter = Image.BILINEAR
            
        img_processed = img_qd.resize((28, 28), resample_filter)
        arr = np.array(img_processed).astype('float32') / 255.0
    else:
        inf_img = Image.open(raw_path).convert('L')
        arr_raw = 255 - np.array(inf_img)
        coords = np.argwhere(arr_raw > 0)
        
        if coords.size > 0:
            y0, x0 = coords.min(axis=0)
            y1, x1 = coords.max(axis=0) + 1
            cropped = arr_raw[y0:y1, x0:x1]
            h, w = cropped.shape
            max_dim = max(h, w)
            pad_y = (max_dim - h) // 2
            pad_x = (max_dim - w) // 2
            border = int(max_dim * 0.1) + 1
            arr_square = np.pad(cropped, ((pad_y+border, max_dim-h-pad_y+border), (pad_x+border, max_dim-w-pad_x+border)), mode='constant')
        else:
            arr_square = arr_raw
            
        try:
            resample_filter = Image.Resampling.BOX
        except AttributeError:
            resample_filter = Image.BOX
            
        img_processed = Image.fromarray(arr_square.astype(np.uint8)).resize((28, 28), resample_filter)
        arr = np.array(img_processed).astype('float32') / 255.0

    arr = np.expand_dims(arr, -1)
    arr = np.expand_dims(arr, 0)
    
    preds = model.predict(arr)[0]
    best_idx = np.argmax(preds)
    predicted_category = classes[str(int(best_idx))]
    confidence = float(preds[best_idx])
    
    gif_filename = f"{filename_base}.gif"
    gif_path = os.path.join(app.config['OUTPUT_FOLDER'], gif_filename)
    
    try:
        animate(raw_path, {"category": predicted_category}, gif_path)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
        
    return jsonify({
        'category': predicted_category,
        'confidence': confidence,
        'gif_url': f'/output/{gif_filename}'
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)
