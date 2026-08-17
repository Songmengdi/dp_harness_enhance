"""vision_glance：远程 VLM（图 + 问题/OCR → 回答）。"""
from .. import contract
from .. import prompts
from ..vision_client import chat_completion


def run(spec):
    images = spec.get('images')
    if not isinstance(images, list) or not images or not all(isinstance(p, str) for p in images):
        contract.fail('input', 'images 必须是非空路径数组')
    if len(images) > 10:
        contract.fail('input', '一次最多 10 张图')
    query = spec.get('query')
    ocr = spec.get('ocr')
    if query is not None and not isinstance(query, str):
        contract.fail('input', 'query 必须是字符串')
    if query and ocr:
        contract.fail('input', 'query 与 ocr 互斥，不能同时给')
    region = spec.get('region')
    if region is not None and len(images) != 1:
        contract.fail('input', 'region 只允许单图')

    # 只做文件存在性校验，宽高信息由 PIL 读取
    from . import imgutil
    metas = [imgutil.image_info(p) for p in images]

    hint = prompts.focus_hint(spec.get('hint'))
    if ocr:
        mode = 'ocr'
        system = prompts.SYSTEM_OCR
        user = '请转写图片中的全部文字。' + ('\n' + hint if hint else '')
    elif query:
        mode = 'qa'
        system = prompts.SYSTEM_ASK
        parts = ['问题：' + query, '共 %d 张图片，按顺序编号为 图1 ~ 图%d。' % (len(images), len(images))]
        if hint:
            parts.append(hint)
        user = '\n'.join(parts)
    else:
        mode = 'describe'
        system = prompts.SYSTEM_DESCRIBE
        parts = ['请完整描述这张图片。' if len(images) == 1 else '请逐一独立描述以下 %d 张图片（图1 ~ 图%d）。' % (len(images), len(images))]
        if hint:
            parts.append(hint)
        user = '\n'.join(parts)

    resp = chat_completion(spec, system, user, images)
    return {
        'images': metas,
        'mode': mode,
        'answer': resp['text'],
        'truncated': resp.get('finishReason') == 'length',
    }
