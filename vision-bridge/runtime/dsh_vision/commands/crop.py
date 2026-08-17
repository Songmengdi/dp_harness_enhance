"""vision_crop：本地裁剪（像素框 → PNG 文件，交给 Host 提交产物）。"""
import os

from .. import contract
from . import imgutil


def run(spec):
    path = contract.spec_file(spec, 'image', '图片')
    info = imgutil.image_info(path)
    region = imgutil.parse_region(spec, info['width'], info['height'], required=True)
    scale = spec.get('scale')
    if scale is None:
        scale = 1
    if not isinstance(scale, int) or isinstance(scale, bool) or not 1 <= scale <= 8:
        contract.fail('input', 'scale 必须是 1-8 的整数')
    out_dir = spec.get('outDir')
    if not isinstance(out_dir, str) or not out_dir:
        contract.fail('input', '缺少 outDir（staging 目录）')
    os.makedirs(out_dir, exist_ok=True)
    out_name = spec.get('outName') or 'crop.png'
    if not isinstance(out_name, str) or '/' in out_name or '\\' in out_name or out_name.startswith('.'):
        contract.fail('input', 'outName 非法')
    out_path = os.path.join(out_dir, out_name)
    meta = imgutil.crop_to_staging(path, region, out_path, scale)
    return {
        'box': {'x1': meta['x1'], 'y1': meta['y1'], 'x2': meta['x2'], 'y2': meta['y2']},
        'width': meta['width'],
        'height': meta['height'],
        'format': 'png',
        'file': out_path,
    }
