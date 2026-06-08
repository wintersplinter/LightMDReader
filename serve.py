import http.server
import socketserver
import webbrowser
import threading
import os
import sys
import time
import subprocess
import platform
import re

PORT = 5173

def open_browser():
    webbrowser.open(f"http://localhost:{PORT}/")

def find_pids_on_port(port: int) -> list[int]:
    system = platform.system().lower()

    if "windows" in system:
        # netstat -ano | findstr :5173  -> last column is PID
        out = subprocess.check_output(["netstat", "-ano"], text=True, errors="ignore")
        pids = set()
        for line in out.splitlines():
            if f":{port} " in line and ("LISTENING" in line or "ESTABLISHED" in line):
                parts = line.split()
                if parts and parts[-1].isdigit():
                    pids.add(int(parts[-1]))
        return sorted(pids)

    # macOS / Linux
    # lsof -ti tcp:5173
    try:
        out = subprocess.check_output(["lsof", "-ti", f"tcp:{port}"], text=True, errors="ignore")
        pids = [int(x) for x in out.split() if x.strip().isdigit()]
        return sorted(set(pids))
    except Exception:
        return []

def kill_pid(pid: int):
    system = platform.system().lower()
    if "windows" in system:
        subprocess.run(["taskkill", "/PID", str(pid), "/F"], check=False)
    else:
        subprocess.run(["kill", "-9", str(pid)], check=False)

def ensure_port_free(port: int):
    pids = find_pids_on_port(port)
    if not pids:
        return

    print(f"Port {port} is in use by PID(s): {pids}. Attempting to stop them…")
    for pid in pids:
        kill_pid(pid)

    # give the OS a moment to release the port
    time.sleep(0.5)

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    # This prevents normal HTTP caching while developing
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    ensure_port_free(PORT)

    with socketserver.TCPServer(("", PORT), NoCacheHandler) as httpd:
        print(f"Serving at http://localhost:{PORT}")

        threading.Timer(1.0, open_browser).start()

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")
