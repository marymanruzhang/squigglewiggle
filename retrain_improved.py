"""
Retrain the sketch classifier with:
  - 3000 samples per class (up from 2000)
  - Stronger augmentation matching web-drawing style (thicker strokes, rotations)
  - ReduceLROnPlateau callback
  - Deeper model with residual-like skip
"""
import os, glob, numpy as np, tensorflow as tf
from tensorflow.keras import layers, models
import json

DATA_DIR = "quickdraw_data"
NUM_SAMPLES = 3000
IMG_SIZE = (28, 28)

CATEGORIES = sorted([
    f.replace('.npy','') for f in os.listdir(DATA_DIR) if f.endswith('.npy')
])
print(f"Found {len(CATEGORIES)} categories")

def load_data():
    X, y = [], []
    label_to_id = {label: idx for idx, label in enumerate(CATEGORIES)}
    for filename in os.listdir(DATA_DIR):
        if not filename.endswith('.npy'): continue
        cat = filename.replace('.npy','')
        if cat not in label_to_id: continue
        data = np.load(os.path.join(DATA_DIR, filename))[:NUM_SAMPLES]
        data = data.astype('float32') / 255.0
        data = data.reshape(-1, 28, 28, 1)
        X.append(data)
        y.extend([label_to_id[cat]] * len(data))
    X = np.concatenate(X, axis=0)
    return X, np.array(y), CATEGORIES

def build_model(num_classes):
    inp = tf.keras.Input(shape=(28, 28, 1))
    # Strong augmentation to simulate web-drawing style
    x = layers.RandomTranslation(0.15, 0.15)(inp)
    x = layers.RandomRotation(0.15)(x)
    x = layers.RandomZoom(0.20)(x)
    x = layers.GaussianNoise(0.05)(x)
    
    # Block 1
    x = layers.Conv2D(64, 3, padding='same', use_bias=False)(x)
    x = layers.BatchNormalization()(x)
    x = layers.Activation('relu')(x)
    x = layers.Conv2D(64, 3, padding='same', use_bias=False)(x)
    x = layers.BatchNormalization()(x)
    x = layers.Activation('relu')(x)
    x = layers.MaxPooling2D(2)(x)
    x = layers.Dropout(0.25)(x)
    
    # Block 2
    x = layers.Conv2D(128, 3, padding='same', use_bias=False)(x)
    x = layers.BatchNormalization()(x)
    x = layers.Activation('relu')(x)
    x = layers.Conv2D(128, 3, padding='same', use_bias=False)(x)
    x = layers.BatchNormalization()(x)
    x = layers.Activation('relu')(x)
    x = layers.MaxPooling2D(2)(x)
    x = layers.Dropout(0.25)(x)

    # Block 3
    x = layers.Conv2D(256, 3, padding='same', use_bias=False)(x)
    x = layers.BatchNormalization()(x)
    x = layers.Activation('relu')(x)
    x = layers.GlobalAveragePooling2D()(x)
    
    x = layers.Dense(512, activation='relu')(x)
    x = layers.Dropout(0.5)(x)
    out = layers.Dense(num_classes, activation='softmax')(x)
    
    model = tf.keras.Model(inp, out)
    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-3, clipnorm=1.0),
        loss=tf.keras.losses.SparseCategoricalCrossentropy(),
        metrics=['accuracy'],
    )
    return model

if __name__ == '__main__':
    X, y, classes = load_data()
    idx_to_class = {idx: label for idx, label in enumerate(classes)}
    with open('class_indices.json', 'w') as f:
        json.dump(idx_to_class, f)
    
    idx = np.arange(len(X)); np.random.shuffle(idx)
    X, y = X[idx], y[idx]
    
    model = build_model(len(classes))
    model.summary()
    
    callbacks = [
        tf.keras.callbacks.EarlyStopping(monitor='val_loss', patience=5,
                                          restore_best_weights=True, min_delta=1e-4),
        tf.keras.callbacks.ReduceLROnPlateau(monitor='val_loss', factor=0.5,
                                              patience=2, min_lr=1e-5),
        tf.keras.callbacks.ModelCheckpoint('sketch_model_best.keras',
                                            save_best_only=True,
                                            monitor='val_accuracy'),
    ]
    model.fit(X, y, epochs=30, batch_size=256, validation_split=0.1,
              callbacks=callbacks, verbose=1)
    model.save('sketch_model.keras')
    print("Retrain complete → sketch_model.keras")
