import uvicorn
import os

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8001))
    host = os.getenv("HOST", "0.0.0.0")
    print(f"Starting Voice AI Agent on http://localhost:{port}")
    uvicorn.run("app:app", host=host, port=port, log_level="info")
