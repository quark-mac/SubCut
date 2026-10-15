"""Windows/local launch entry, serving the built UI and API on one origin."""
import argparse
import os
from pathlib import Path
import shutil
import threading
import time
import webbrowser

import uvicorn


def main():
    parser = argparse.ArgumentParser(description="本机字幕校对工作台")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if not shutil.which("ffprobe"):
        parser.error("未找到 ffprobe，请将 FFmpeg 的 bin 目录加入 PATH")
    if not (Path(__file__).parent / "frontend" / "dist" / "index.html").is_file():
        parser.error("尚未构建前端，请在 webui/frontend 执行 npm ci 和 npm run build")
    if args.workspace:
        os.environ["WEBUI_WORKSPACE"] = str(args.workspace.resolve())
    server = uvicorn.Server(uvicorn.Config("webui.backend.app:app", host="127.0.0.1", port=args.port))
    if not args.no_browser:
        def open_when_ready():
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline and not server.should_exit:
                if server.started:
                    webbrowser.open(f"http://127.0.0.1:{args.port}")
                    return
                time.sleep(0.1)
        threading.Thread(target=open_when_ready, daemon=True).start()
    server.run()


if __name__ == "__main__":
    main()
