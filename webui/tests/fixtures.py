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


def create_preview_fixture(root: Path, offset=0, silent=False):
    """Nine seconds: red/440Hz, black/silence, green/880Hz, black, blue/1320Hz."""
    root.mkdir(parents=True, exist_ok=True)
    video = root / f"markers-offset-{offset}-silent-{silent}.mkv"
    subtitle = root / 'markers.srt'
    filters = ','.join(f"drawbox=c={color}:t=fill:enable='between(t,{start},{end})'"
                       for color, start, end in [('red', 0, 2), ('lime', 4, 6), ('blue', 8, 9)])
    command = ['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i',
               f'color=c=black:s=320x180:r=25:d=9,{filters}']
    if not silent:
        command += ['-f', 'lavfi', '-i',
                    "aevalsrc='0.4*(sin(2*PI*440*t)*between(t,0,2)+sin(2*PI*880*t)*between(t,4,6)+sin(2*PI*1320*t)*between(t,8,9))':s=48000:d=9"]
    command += ['-c:v', 'ffv1', '-c:a', 'pcm_s16le', '-output_ts_offset', str(offset), str(video)]
    subprocess.run(command, check=True, timeout=60)
    subtitle.write_text('1\n00:00:00,200 --> 00:00:01,800\n红色 440Hz 开头\n\n2\n00:00:04,200 --> 00:00:05,800\n绿色 880Hz 中部\n\n3\n00:00:08,100 --> 00:00:08,900\n蓝色 1320Hz 结尾\n', encoding='utf-8')
    return video, subtitle
