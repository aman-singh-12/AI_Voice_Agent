import uvicorn
import os
import sys
import socket
import subprocess

def free_port(port: int):
    """Frees the specified port if occupied by a stale process on Windows."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', port)) == 0:
                print(f"Port {port} is currently in use. Freeing port...")
                if sys.platform == "win32":
                    cmd = f'powershell -Command "Get-NetTCPConnection -LocalPort {port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ForEach-Object {{ if ($_ -ne {os.getpid()}) {{ Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }} }}"'
                    subprocess.run(cmd, shell=True, capture_output=True)
    except Exception as e:
        print(f"Port cleanup warning: {e}")

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8001))
    host = os.getenv("HOST", "0.0.0.0")
    
    free_port(port)
    
    print(f"\n=======================================================")
    print(f">> Voice AI Agent Live on: http://localhost:{port}")
    print(f"=======================================================\n")
    uvicorn.run("app:app", host=host, port=port, log_level="info", reload=True)

