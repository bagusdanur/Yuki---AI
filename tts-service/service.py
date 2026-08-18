import io
import os
import soundfile as sf
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
from kokoro_onnx import Kokoro

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "kokoro-v0_19.onnx")
VOICES_PATH = os.path.join(BASE_DIR, "voices.json")

print(f"[Kokoro TTS] Loading ONNX model from {MODEL_PATH}...")
kokoro = Kokoro(model_path=MODEL_PATH, voices_path=VOICES_PATH)
print("[Kokoro TTS] Model loaded successfully.")

app = FastAPI(title="Kokoro AI TTS Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SynthesizeRequest(BaseModel):
    text: str
    voice: str = "af_bella"
    speed: float = 1.0
    lang: str = "en-us"

@app.get("/health")
def health():
    return {"status": "ok", "engine": "kokoro-onnx", "model": "kokoro-v0_19"}

@app.post("/synthesize")
async def synthesize(req: SynthesizeRequest):
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Teks tidak boleh kosong.")

    try:
        # Generate samples with Kokoro ONNX
        samples, sample_rate = kokoro.create(
            text=text,
            voice=req.voice or "af_bella",
            speed=req.speed or 1.0,
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
