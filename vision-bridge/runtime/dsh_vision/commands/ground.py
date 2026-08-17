"""vision_ground / vision_detect：远程 VLM 目标定位 / 元素盘点（输出映射回原图坐标）。"""
import os
import tempfile

from .. import contract
from .. import prompts
from ..vision_client import chat_completion, parse_boxes_json
from . import imgutil


def _run_grounded(spec, detect=False):
    path = contract.spec_file(spec, 'image', '图片')
    info = imgutil.image_info(path)
    target = spec.get('target')
    category = spec.get('category')
    if detect:
        prompt_target = ('请找出图中所有「%s」类元素' % category) if category else '请找出图中所有可辨识的元素'
    else:
        if not isinstance(target, str) or not target.strip():
            contract.fail('input', 'target 不能为空')
        prompt_target = '目标：' + target.strip()

    region = imgutil.parse_region(spec, info['width'], info['height'])
    image_for_vlm = path
    if region is not None:
        fd, cropped = tempfile.mkstemp(suffix='.png')
        os.close(fd)
        try:
            imgutil.crop_to_staging(path, region, cropped)
        except SystemExit:
            raise
        image_for_vlm = cropped

    hint = prompts.focus_hint(spec.get('hint'))
    system = prompts.SYSTEM_DETECT if detect else prompts.SYSTEM_GROUND
    user = prompt_target + ('\n' + hint if hint else '')
    try:
        resp = chat_completion(spec, system, user, [image_for_vlm])
        raw_boxes = parse_boxes_json(resp['text'])
    finally:
        if region is not None:
            try:
                os.unlink(cropped)
            except OSError:
                pass

    matches = []
    for item in raw_boxes:
        box = item['box']
        if region is not None:
            box = imgutil.map_box_back(box, region, info['width'], info['height'])
        else:
            x1, y1, x2, y2 = [round(v / 1000.0 * dim) for v, dim in
                              zip(box, [info['width'], info['height'], info['width'], info['height']])]
            if not (0 <= x1 < x2 <= info['width'] and 0 <= y1 < y2 <= info['height']):
                contract.fail('output', '上游返回的框越界或退化，拒绝')
            box = {'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2}
        matches.append({'label': item['label'], 'box': box})
    return {
        'target': target if not detect else None,
        'category': category if detect else None,
        'image': info,
        'imageWidth': info['width'],
        'imageHeight': info['height'],
        'matches': matches,
    }


def run(spec):
    return _run_grounded(spec, detect=False)


def run_detect(spec):
    return _run_grounded(spec, detect=True)
