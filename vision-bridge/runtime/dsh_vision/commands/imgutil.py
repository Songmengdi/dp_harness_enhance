"""图片与区域通用工具（crop/区域映射/元信息）。"""
import os

from PIL import Image

from .. import contract


def image_info(path):
    try:
        im = Image.open(path)
        width, height = im.size
        fmt = (im.format or '').lower() or os.path.splitext(path)[1].lstrip('.').lower()
        im.load()
        im.close()
    except Exception:
        contract.fail('input', '不是可解析的图片: %s' % path)
    try:
        size_bytes = os.path.getsize(path)
    except OSError:
        size_bytes = 0
    return {'path': path, 'bytes': size_bytes, 'width': width, 'height': height, 'format': fmt}


def parse_region(spec, width, height, required=False):
    """解析 "x,y,w,h"；越界/退化框拒绝（input 类别）。"""
    raw = spec.get('region')
    if raw is None:
        if required:
            contract.fail('input', '缺少 region（"x,y,w,h" 像素框）')
        return None
    if not isinstance(raw, str) or not raw.strip():
        contract.fail('input', 'region 必须是 "x,y,w,h" 字符串')
    parts = raw.split(',')
    if len(parts) != 4:
        contract.fail('input', 'region 必须是 4 个整数（x,y,w,h）: %s' % raw)
    try:
        x, y, w, h = [int(float(p.strip())) for p in parts]
    except ValueError:
        contract.fail('input', 'region 必须是整数（x,y,w,h）: %s' % raw)
    if w < 1 or h < 1:
        contract.fail('input', 'region 宽高必须 ≥1（退化框被拒绝）: %s' % raw)
    if x < 0 or y < 0 or x + w > width or y + h > height:
        contract.fail('input', 'region 越界（图 %dx%d）: %s' % (width, height, raw))
    return {'x': x, 'y': y, 'w': w, 'h': h, 'x1': x, 'y1': y, 'x2': x + w, 'y2': y + h}


def crop_to_staging(path, region, out_path, scale=1):
    """按 region 裁剪（可放大 scale），写入 out_path（PNG）。"""
    try:
        im = Image.open(path)
        box = im.convert('RGB').crop((region['x'], region['y'], region['x2'], region['y2']))
        im.close()
    except Exception as exc:
        contract.fail('runtime', '裁剪失败: %s' % exc)
    if scale and scale > 1:
        try:
            box = box.resize((box.width * scale, box.height * scale), Image.LANCZOS)
        except Exception:
            box = box.resize((box.width * scale, box.height * scale))
    try:
        box.save(out_path, format='PNG')
    except Exception as exc:
        contract.fail('runtime', '裁剪结果写入失败: %s' % exc)
    return {'x1': region['x1'], 'y1': region['y1'], 'x2': region['x2'], 'y2': region['y2'],
            'width': region['w'] * (scale or 1), 'height': region['h'] * (scale or 1)}


def map_box_back(box, region, width, height):
    """归一化 0-1000 框（基于裁剪区域）映射回原图像素坐标；越界/退化拒绝。"""
    x1 = region['x'] + box[0] / 1000.0 * region['w']
    y1 = region['y'] + box[1] / 1000.0 * region['h']
    x2 = region['x'] + box[2] / 1000.0 * region['w']
    y2 = region['y'] + box[3] / 1000.0 * region['h']
    x1, y1, x2, y2 = [round(v) for v in (x1, y1, x2, y2)]
    if not (0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height):
        contract.fail('output', '上游返回的框映射回原图后越界或退化，拒绝')
    return {'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2}
