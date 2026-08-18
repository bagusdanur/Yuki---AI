import numpy as np
import os
import io
import soundfile as sf
from kokoro_onnx import Kokoro

# Allow pickle in numpy 2.x
_orig_np_load = np.load
np.load = lambda *args, **kwargs: _orig_np_load(*args, **{**kwargs, "allow_pickle": True})

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "kokoro-v0_19.onnx")
VOICES_PATH = os.path.join(BASE_DIR, "voices.bin")

kokoro = Kokoro(model_path=MODEL_PATH, voices_path=VOICES_PATH)

print("Voices available:")
if hasattr(kokoro.voices, 'keys'):
    voice_names = list(kokoro.voices.keys())
    print("Voice list:", voice_names)
elif hasattr(kokoro.voices, 'files'):
    voice_names = list(kokoro.voices.files)
    print("Voice list:", voice_names)
else:
    print("Voices type:", type(kokoro.voices))

# Test Voice Blend: 60% af_bella + 40% jf_tebira (or jf_alpha)
voice_a = "af_bella"
voice_b = "jf_tebira" if "jf_tebira" in kokoro.voices else "jf_alpha" if "jf_alpha" in kokoro.voices else "af_sky"

print(f"Blending {voice_a} (60%) and {voice_b} (40%)...")
# Get voice vectors
style_a = kokoro.voices[voice_a]
style_b = kokoro.voices[voice_b]

# Blend
blended = 0.55 * style_a + 0.45 * style_b

# Generate sample audio
text = "Halo! Aku Yuki. Sekarang sudah jam sembilan malam. Kangen ya sama aku?"
samples, sample_rate = kokoro.create(
    text=text,
    voice=blended,
    speed=1.08,
    lang="en-us"
)

out_file = os.path.join(BASE_DIR, "test_vtuber_blend.wav")
sf.write(out_file, samples, sample_rate, format="WAV")
print(f"Saved blended audio to {out_file}, size: {os.path.getsize(out_file)} bytes")
