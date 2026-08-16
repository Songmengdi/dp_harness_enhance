"""vision_frames：本地 ffmpeg 抽帧（视频 + 时间点 → 帧文件路径列表）。"""
import os
import re
import subprocess

from .. import contract

MAX_TIMES = 8


def run(spec):
    path = contract.spec_file(spec, 'path', '视频')
    times = spec.get('times')
    if not isinstance(times, list) or len(times) == 0:
        contract.fail('input', 'times 不能为空（时间点列表，如 ["0:05","10"]）')
    if len(times) > MAX_TIMES:
        contract.fail('input', '一次最多抽 %d 帧，收到 %d 个时间点' % (MAX_TIMES, len(times)))
    times = [str(t).strip() for t in times]
    if any(not t for t in times):
        contract.fail('input', 'times 含空时间点')
    out_dir = spec.get('outDir')
    if not isinstance(out_dir, str) or not out_dir:
        # 独立运行时兜底：与旧 CLI 行为一致（Host 总会传工作区 staging 目录）
        out_dir = re.sub(r'\.\w+$', '', path) + '__frames'
    os.makedirs(out_dir, exist_ok=True)
    frames = []
    for i, t in enumerate(times):
        safe = re.sub(r'[^0-9A-Za-z:._-]', '_', t)
        out = os.path.join(out_dir, 'frame_%02d_%s.png' % (i + 1, safe))
        try:
            r = subprocess.run(
                ['ffmpeg', '-y', '-ss', t, '-i', path, '-frames:v', '1', '-q:v', '2', out],
                capture_output=True, text=True, timeout=120,
            )
        except FileNotFoundError:
            contract.fail('runtime', '需要 ffmpeg/ffprobe（如 brew install ffmpeg）')
        if r.returncode != 0:
            contract.fail('runtime', '抽帧失败 (t=%s): %s' % (t, (r.stderr or '').strip()[-300:]))
        frames.append({'time': t, 'path': out})
    return {'dir': out_dir, 'frames': frames}
