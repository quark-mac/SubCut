"""Disposable test/demo service using generated input, never production material."""
import argparse
import os
from pathlib import Path

import uvicorn

from webui.tests.fixtures import create_fixtures


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--port", type=int, default=18761)
    args = parser.parse_args()
    root = args.root.resolve()
    video, subtitle = create_fixtures(root / "inputs")
    os.environ["WEBUI_WORKSPACE"] = str(root / "projects")
    print(f"Video: {video}\nSRT: {subtitle}", flush=True)
    uvicorn.run("webui.backend.app:app", host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
