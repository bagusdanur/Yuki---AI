import io
import os
import numpy as np

# Monkeypatch np.load to allow pickle with numpy 2.x for kokoro voice arrays
_orig_np_load = np.load
np.load = lambda *args, **kwargs: _orig_np_load(*args, **{**kwargs, "allow_pickle": True})

import soundfile as sf
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
from kokoro_onnx import Kokoro

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "kokoro-v1.0.onnx") if os.path.exists(os.path.join(BASE_DIR, "kokoro-v1.0.onnx")) else os.path.join(BASE_DIR, "kokoro-v0_19.onnx")
VOICES_PATH = os.path.join(BASE_DIR, "voices-v1.0.bin") if os.path.exists(os.path.join(BASE_DIR, "voices-v1.0.bin")) else os.path.join(BASE_DIR, "voices.bin")

print(f"[Kokoro TTS] Loading model from {MODEL_PATH} and voices from {VOICES_PATH}...")
kokoro = Kokoro(model_path=MODEL_PATH, voices_path=VOICES_PATH)
print("[Kokoro TTS] Model & voices loaded successfully.")

# Pre-calculate blended VTuber voice styles
def get_voice(name: str):
    if name in kokoro.voices:
        return kokoro.voices[name]
    return kokoro.voices.get("af_bella", list(kokoro.voices.values())[0])

# Pre-build blended VTuber vectors
def build_blended_vector(base_name="af_bella", jp_name="jf_tebira", base_weight=0.55):
    base_v = get_voice(base_name)
    jp_v = get_voice(jp_name) if jp_name in kokoro.voices else get_voice("jf_alpha") if "jf_alpha" in kokoro.voices else get_voice("af_sky")
    return (base_weight * base_v) + ((1.0 - base_weight) * jp_v)

VTUBER_STYLES = {
    "vtuber_cute": build_blended_vector("af_bella", "jf_tebira", 0.55),
    "vtuber_manja": build_blended_vector("af_sky", "jf_tebira", 0.50),
    "vtuber_tsundere": build_blended_vector("af_nicole", "jf_alpha", 0.55),
    "vtuber_calm": build_blended_vector("af_sarah", "jf_tebira", 0.60)
}

app = FastAPI(title="Kokoro VTuber TTS Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SynthesizeRequest(BaseModel):
    text: str
    preset: str = "vtuber_cute"
    voice: str = ""
    speed: float = 1.05
    lang: str = "en-us"

@app.get("/health")
def health():
    return {"status": "ok", "engine": "kokoro-onnx", "styles": list(VTUBER_STYLES.keys())}

@app.post("/synthesize")
async def synthesize(req: SynthesizeRequest):
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Teks tidak boleh kosong.")

    try:
        # Resolve voice vector: use VTUBER preset or custom voice
        if req.preset and req.preset in VTUBER_STYLES:
            style_vector = VTUBER_STYLES[req.preset]
        elif req.voice and req.voice in kokoro.voices:
            style_vector = kokoro.voices[req.voice]
        else:
            style_vector = VTUBER_STYLES["vtuber_cute"]

        samples, sample_rate = kokoro.create(
            text=text,
            voice=style_vector,
            speed=req.speed or 1.05,
            lang=req.lang or "en-us"
        )

        buf = io.BytesIO()
        sf.write(buf, samples, sample_rate, format="WAV")
        buf.seek(0)
        return Response(content=buf.read(), media_type="audio/wav")
    except Exception as e:
        print(f"[Kokoro TTS Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=50030, log_level="info")
