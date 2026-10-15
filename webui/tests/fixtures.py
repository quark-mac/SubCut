"""Small original-timebase fixtures, shared by HTTP and browser checks."""
import subprocess
from pathlib import Path


SRT = "17\n00:00:03,000 --> 00:00:05,000\n稍后的字幕\n\n9\n00:00:01,000 --> 00:00:04,000\n[不是人物] 原样保留：正文\n第二行\n\n23\n00:00:01,000 --> 00:00:04,000\n同时出现\n"


def create_fixtures(root: Path):
    root.mkdir(parents=True, exist_ok=True)
    video = root / "短片.mp4"
    subtitle = root / "来源.srt"
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
        "-t", "8", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-movflags", "+faststart", str(video),
    ], check=True, timeout=60)
    subtitle.write_text(SRT, encoding="utf-8")
    return video, subtitle
