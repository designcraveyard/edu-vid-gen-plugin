"""
Video generation backends.
Each backend implements: submit_job(), poll_job(), download_result()
Usage: python3 generate-video.py --backend veo|wan [other args]
"""

import importlib

BACKENDS = {
    'veo': 'backends.veo',
    'wan': 'backends.wan',
}

def get_backend(name):
    if name not in BACKENDS:
        raise ValueError(f"Unknown backend '{name}'. Available: {', '.join(BACKENDS)}")
    module = importlib.import_module(BACKENDS[name], package='backends')
    return module
