import numpy as np
from PIL import Image


def cosine_similarity(a, b):
    a_flat = a.flatten().astype(float)
    b_flat = b.flatten().astype(float)
    return np.dot(a_flat, b_flat) / (
        np.linalg.norm(a_flat) * np.linalg.norm(b_flat) + 1e-8
    )


def shifted_mse(a, b, max_shift=2):
    h, w = a.shape
    best = float("inf")
    
    for dy in range(-max_shift, max_shift + 1):
        for dx in range(-max_shift, max_shift + 1):
            y1, y2 = max(0, dy), min(h, h + dy)
            x1, x2 = max(0, dx), min(w, w + dx)

            a_crop = a[y1:y2, x1:x2]
            b_crop = b[y1-dy:y2-dy, x1-dx:x2-dx]

            if a_crop.size == 0:
                continue

            best = min(best, np.mean((a_crop - b_crop) ** 2))
    
    return best




def check_pair_similar(path_a: str, path_b: str, threshold: float = 0.91) -> bool:
    try:
        img_a = np.array(Image.open(path_a).convert("RGB"))
        img_b = np.array(Image.open(path_b).convert("RGB"))
    except Exception:
        return False
    sim = cosine_similarity(img_a, img_b)
    return sim >= threshold