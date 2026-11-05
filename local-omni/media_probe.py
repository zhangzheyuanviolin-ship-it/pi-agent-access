"""Inspect inline media without loading model weights or following network URLs."""
import json, subprocess
from pathlib import Path

def media_streams(path, ffmpeg):
    probe = str(Path(ffmpeg).with_name('ffprobe'))
    result = subprocess.run([probe, '-v', 'error', '-protocol_whitelist', 'file,pipe',
                             '-show_entries', 'stream=codec_type', '-of', 'json', str(path)],
                            capture_output=True, timeout=20, check=True)
    return {row.get('codec_type') for row in json.loads(result.stdout).get('streams', [])}

def media_kind(path, ffmpeg, declared):
    if declared == 'image':
        return declared
    kinds = media_streams(path, ffmpeg)
    if declared == 'audio' and 'audio' not in kinds:
        raise ValueError('Audio input contains no audio stream')
    if declared == 'video':
        if 'video' in kinds:
            return 'video'
        if 'audio' in kinds:
            return 'audio'
        raise ValueError('Media contains neither video nor audio')
    return declared
