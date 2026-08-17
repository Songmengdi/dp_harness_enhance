"""vision_dominant_colors：区域主色分布 + 候选色打分（本地确定性）。"""
from PIL import Image

from .. import contract
from . import imgutil


def _hex(rgb):
    return '#%02x%02x%02x' % tuple(rgb)


def _quantize(im, n):
    try:
        q = im.quantize(colors=n, method=Image.MEDIANCUT).convert('RGB')
        counts = q.getcolors(maxcolors=100000)
    except Exception:
        return []
    if not counts:
        return []
    counts.sort(reverse=True)
    return counts


def candidate_shares(im, rgb_list):
    """候选色打分：每个像素投票给最近候选色；64 色量化桶加速。"""
    total = im.size[0] * im.size[1]
    if total == 0:
        return [0.0] * len(rgb_list)
    try:
        q = im.quantize(colors=64, method=Image.MEDIANCUT)  # P 模式
        palette = q.getpalette()
        palette_rgb = [tuple(palette[i:i + 3]) for i in range(0, len(palette), 3)]
        buckets = q.getcolors(maxcolors=4096) or []  # [(count, palette_index), ...]
        votes = [0] * len(rgb_list)
        for count, idx in buckets:
            bucket_rgb = palette_rgb[idx]
            best_i = min(range(len(rgb_list)),
                         key=lambda i: sum((a - b) ** 2 for a, b in zip(bucket_rgb, rgb_list[i])))
            votes[best_i] += count
        return [round(v * 100.0 / total, 1) for v in votes]
    except Exception:
        return [0.0] * len(rgb_list)


def run(spec):
    path = contract.spec_file(spec, 'image', '图片')
    info = imgutil.image_info(path)
    try:
        im = Image.open(path).convert('RGB')
        im.load()
    except Exception:
        contract.fail('input', '不是可解析的图片: %s' % path)
    region = imgutil.parse_region(spec, info['width'], info['height'])
    if region is not None:
        im = im.crop((region['x'], region['y'], region['x2'], region['y2']))
    top = spec.get('top')
    if top is None:
        top = 5
    if not isinstance(top, int) or isinstance(top, bool) or not 1 <= top <= 16:
        contract.fail('input', 'top 必须是 1-16 的整数')

    total = im.size[0] * im.size[1]
    colors = []
    for n, rgb in _quantize(im, top):
        colors.append({'color': _hex(rgb), 'sharePct': round(n * 100.0 / total, 1)})

    candidates_raw = spec.get('candidates')
    out = {'colors': colors}
    if candidates_raw is not None:
        if not isinstance(candidates_raw, list) or not candidates_raw or not all(isinstance(c, str) for c in candidates_raw):
            contract.fail('input', 'candidates 必须是非空颜色字符串数组（如 #ff0000）')
        rgb_list = []
        for c in candidates_raw:
            try:
                rgb_list.append(tuple(int(c.lstrip('#')[i:i + 2], 16) for i in (0, 2, 4)))
            except (ValueError, IndexError):
                contract.fail('input', '候选色非法: %s' % c)
        shares = candidate_shares(im, rgb_list)
        best = candidates_raw[max(range(len(shares)), key=shares.__getitem__)]
        scored = [
            {'color': c, 'sharePct': shares[i], 'winner': c == best}
            for i, c in enumerate(candidates_raw)
        ]
        out['candidates'] = scored
        out['winner'] = best
    return out
