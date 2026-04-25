import re
from animation_engine.category_map import AnimationType

with open('/Users/cassie/.gemini/antigravity/brain/f41d9ccf-0362-4b4c-8263-b9a9f65c44ea/scratch/scratch_categories.py') as f:
    exec(f.read(), globals())

# 1. Update download_quickdraw.py
with open('download_quickdraw.py', 'r') as f:
    content = f.read()
categories_str = 'CATEGORIES = ' + str(ALL_CATEGORIES).replace("'", '"')
content = re.sub(r'CATEGORIES = \[[^\]]+\]', categories_str, content)
with open('download_quickdraw.py', 'w') as f:
    f.write(content)

# 2. Update train.py
with open('train.py', 'r') as f:
    content = f.read()

# Remove QUICKDRAW_CATEGORY_MAP logic in train.py and just use ALL_CATEGORIES
train_new = """import os
import glob
import numpy as np
import tensorflow as tf
from tensorflow.keras import layers, models
import json

DATA_DIR = "quickdraw_data"

CATEGORIES = """ + str(ALL_CATEGORIES).replace("'", '"') + """

# Reduce samples per class so 345 classes fit in RAM
NUM_SAMPLES_PER_CLASS = 1500
IMG_SIZE = (28, 28)

def load_data():
    X = []
    y = []
    
    unique_labels = sorted(CATEGORIES)
    label_to_id = {label: idx for idx, label in enumerate(unique_labels)}
    
    for filename in os.listdir(DATA_DIR):
        if not filename.endswith('.npy'):
            continue
            
        base_cat = filename.replace('.npy', '')
        if base_cat not in label_to_id:
            continue
            
        label_id = label_to_id[base_cat]
        filepath = os.path.join(DATA_DIR, filename)
        
        data = np.load(filepath)
        print(f"Loaded {filename} with shape {data.shape}")
        
        data = data[:NUM_SAMPLES_PER_CLASS]
        data = data.astype('float32') / 255.0
        data = data.reshape(-1, 28, 28, 1)
        
        X.append(data)
        y.extend([label_id] * len(data))
        
    if len(X) == 0:
        return np.array([]), np.array([]), unique_labels
        
    X = np.concatenate(X, axis=0)
    y = np.array(y)
    
    print(f"\\nFinal dataset shape: {X.shape}")
    print(f"Classes: {len(unique_labels)}")
    
    return X, y, unique_labels

def build_model(num_classes):
    model = models.Sequential([
        layers.Input(shape=(28, 28, 1)),
        layers.RandomTranslation(0.1, 0.1),
        layers.RandomZoom(0.1),
        
        layers.Conv2D(32, (3, 3), activation='relu', padding='same'),
        layers.MaxPooling2D((2, 2)),
        layers.Conv2D(64, (3, 3), activation='relu', padding='same'),
        layers.MaxPooling2D((2, 2)),
        layers.Conv2D(128, (3, 3), activation='relu', padding='same'),
        layers.MaxPooling2D((2, 2)),
        
        layers.Flatten(),
        layers.Dense(256, activation='relu'),
        layers.Dropout(0.5),
        layers.Dense(num_classes, activation='softmax')
    ])
    
    model.compile(optimizer='adam',
                  loss='sparse_categorical_crossentropy',
                  metrics=['accuracy'])
    return model

if __name__ == '__main__':
    X, y, classes = load_data()
    
    idx_to_class = {idx: label for idx, label in enumerate(classes)}
    with open('class_indices.json', 'w') as f:
        json.dump(idx_to_class, f)
        
    if len(X) == 0:
        print("No valid data found. Run download_quickdraw.py first.")
        exit(1)
        
    indices = np.arange(len(X))
    np.random.shuffle(indices)
    X = X[indices]
    y = y[indices]
    
    model = build_model(len(classes))
    model.summary()
    
    print("Training QuickDraw-based sketch model...")
    model.fit(X, y, epochs=10, batch_size=128, validation_split=0.1)
    
    model.save('sketch_model.keras')
    print("Training complete. Saved to sketch_model.keras")
"""
with open('train.py', 'w') as f:
    f.write(train_new)

# 3. Update category_map.py
with open('animation_engine/category_map.py', 'r') as f:
    lines = f.readlines()

new_lines = []
in_map = False
for line in lines:
    if line.startswith('CATEGORY_MAP = {'):
        in_map = True
        new_lines.append(line)
        for cat, anim in CATEGORY_MAP.items():
            new_lines.append(f'    "{cat}": {anim},\n')
    elif in_map and line.startswith('}'):
        in_map = False
        new_lines.append(line)
    elif not in_map:
        new_lines.append(line)

with open('animation_engine/category_map.py', 'w') as f:
    f.writelines(new_lines)
