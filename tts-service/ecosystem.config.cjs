module.exports = {
  apps: [
    {
      name: 'kokoro-tts',
      cwd: '/home/ryukomik/Yuki---AI/tts-service',
      script: 'venv/bin/uvicorn',
      args: 'service:app --host 127.0.0.1 --port 50030',
      interpreter: 'none',
      env: {
        PYTHONUNBUFFERED: '1'
      }
    }
  ]
}
