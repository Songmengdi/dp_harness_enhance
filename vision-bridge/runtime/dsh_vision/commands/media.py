"""vision_media：本地 ffprobe 元数据（文件 → 时长/分辨率/流/编码 JSON）。"""
import json
import subprocess

from .. import contract


def run(spec):
    path = contract.spec_file(spec)
    try:
        r = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-print_format', 'json',
             '-show_format', '-show_streams', path],
            capture_output=True, text=True, timeout=30,
        )
    except FileNotFoundError:
        contract.fail('runtime', '需要 ffmpeg/ffprobe（如 brew install ffmpeg）')
    if r.returncode != 0:
        contract.fail('input', '不是可解析的媒体文件: %s' % (r.stderr or '').strip()[-300:])
    try:
        data = json.loads(r.stdout)
    except Exception:
        contract.fail('output', 'ffprobe 输出无法解析为 JSON')
    fmt = data.get('format', {}) or {}
    streams = []
    for s in data.get('streams', []) or []:
        streams.append({
            'type': s.get('codec_type'),
            'codec': s.get('codec_name'),
            'width': s.get('width'),
            'height': s.get('height'),
            'fps': s.get('avg_frame_rate') or s.get('r_frame_rate'),
            'sampleRate': s.get('sample_rate'),
            'channels': s.get('channels'),
            'pixFmt': s.get('pix_fmt'),
            'duration': s.get('duration'),
        })
    return {
        'path': path,
        'durationSeconds': fmt.get('duration'),
        'sizeBytes': fmt.get('size'),
        'bitRate': fmt.get('bit_rate'),
        'formatName': fmt.get('format_name'),
        'streams': streams,
    }
