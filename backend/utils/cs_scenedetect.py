import numpy as np
from PIL import Image
import os

DISSIM_THRESHOLD = 0.10  # tune this for the dissimilarity threshold for a cut, less = more strict
POOL_DIM         = 8     # mosaic block size, larger = more blurry image to scan for scene similarity

def pooling(arr: np.ndarray, dim: int) -> np.ndarray:
    """Average-pool (H, W, C) or (H, W) by block size `dim`."""
    h = (arr.shape[0] // dim) * dim
    w = (arr.shape[1] // dim) * dim
    arr = arr[:h, :w]
    if arr.ndim == 3:
        c = arr.shape[2]
        return arr.reshape(h // dim, dim, w // dim, dim, c).mean(axis=(1, 3))
    return arr.reshape(h // dim, dim, w // dim, dim).mean(axis=(1, 3))


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    a_f = a.flatten().astype(np.float32)
    b_f = b.flatten().astype(np.float32)
    denom = np.linalg.norm(a_f) * np.linalg.norm(b_f)
    if denom == 0:
        return 1.0
    return float(np.dot(a_f, b_f) / denom)


def check_pair_similar(path_a: str, path_b: str, threshold: float = DISSIM_THRESHOLD) -> bool:
    try:
        img_a = np.array(Image.open(path_a).convert("RGB"))
        img_b = np.array(Image.open(path_b).convert("RGB"))
    except Exception:
        return False

    sim    = cosine_similarity(pooling(img_a, POOL_DIM), pooling(img_b, POOL_DIM))
    dissim = 1.0 - sim

    return dissim < threshold