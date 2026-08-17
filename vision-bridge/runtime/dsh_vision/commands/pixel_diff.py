"""vision_pixel_diff：两图逐像素差异（比例 + 最差区域 + 热力图/报告产物）。"""
import os

from PIL import Image, ImageChops, ImageDraw, ImageStat

from .. import contract
from . import imgutil

GRID = 3


def _load_rgb(path):
    try:
        im = Image.open(path).convert('RGB')
        im.load()
    except Exception:
        contract.fail('input', '不是可解析的图片: %s' % path)
    return im


def run(spec):
    original = contract.spec_file(spec, 'original', '原图')
    rebuilt = contract.spec_file(spec, 'rebuilt', '重构图')
    run_name = spec.get('runName')
    out_dir = spec.get('outDir')
    if not isinstance(out_dir, str) or not out_dir:
        contract.fail('input', '缺少 outDir（staging 目录）')
    os.makedirs(out_dir, exist_ok=True)

    a = _load_rgb(original)
    b = _load_rgb(rebuilt)
    # 以原图尺寸为准：重构图缩放对齐后再比较
    if b.size != a.size:
        b = b.resize(a.size)
    w, h = a.size

    diff = ImageChops.difference(a, b)
    total = w * h
    # 每像素三通道平均差值 / 255 = 该像素差异占比
    pixel_sum = sum(ImageStat.Stat(diff).sum) / 3.0
    ratio_pct = round(pixel_sum / (total * 255.0) * 100.0, 2)

    # 最差区域（GRID×GRID 网格，原图坐标）
    cell_w = max(1, w // GRID)
    cell_h = max(1, h // GRID)
    worst = []
    for gy in range(GRID):
        for gx in range(GRID):
            x1, y1 = gx * cell_w, gy * cell_h
            x2 = min(w, x1 + cell_w)
            y2 = min(h, y1 + cell_h)
            if x2 <= x1 or y2 <= y1:
                continue  # 小图网格退化，跳过空单元格
            cell = diff.crop((x1, y1, x2, y2))
            cs = sum(ImageStat.Stat(cell).sum) / 3.0
            pct = round(cs / ((x2 - x1) * (y2 - y1) * 255.0) * 100.0, 2)
            worst.append({'box': {'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2}, 'ratioPct': pct})
    worst.sort(key=lambda item: -item['ratioPct'])
    worst = worst[:3]

    # 热力图：差异大的像素盖红（alpha 随差异强度）
    heat = a.copy().convert('RGBA')
    overlay = Image.new('RGBA', a.size, (0, 0, 0, 0))
    d = overlay.load()
    dp = diff.load()
    for y in range(h):
        for x in range(w):
            p = dp[x, y]
            strength = sum(p) / 3 / 255.0
            if strength > 0.02:
                d[x, y] = (255, 0, 0, int(40 + 180 * strength))
    heat = Image.alpha_composite(heat, overlay)
    heat_path = os.path.join(out_dir, 'heatmap.png')
    heat.save(heat_path, format='PNG')

    report_path = os.path.join(out_dir, 'report.md')
    lines = [
        '# vision_pixel_diff 报告' + ('' if not run_name else '（%s）' % run_name),
        '',
        '- 原图: %s (%dx%d)' % (original, w, h),
        '- 重构图: %s' % rebuilt,
        '- 差异比例: **%s%%**' % ratio_pct,
        '',
        '## 最差区域（原图像素坐标）',
        '',
    ]
    for i, item in enumerate(worst, 1):
        bx = item['box']
        lines.append('%d. (%d,%d)-(%d,%d): %s%%' % (i, bx['x1'], bx['y1'], bx['x2'], bx['y2'], item['ratioPct']))
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')

    return {
        'ratioPct': ratio_pct,
        'worstRegions': worst,
        'imageWidth': w,
        'imageHeight': h,
        'files': {'heatmap': heat_path, 'report': report_path},
    }
