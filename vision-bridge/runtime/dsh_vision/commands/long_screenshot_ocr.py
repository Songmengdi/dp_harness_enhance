"""vision_long_screenshot_ocr：长截图 → 低内容切口分块 → 逐块 OCR → 合并 Markdown + 边界审计。

同 runName + resume=true 复用已有分块与侧车文件；splitOnly 不发任何远程请求。
"""
import json
import os
import re

from PIL import Image

from .. import contract
from .. import prompts
from ..vision_client import chat_completion
from . import imgutil

CHUNK_TARGET = 1200
OVERLAP = 80
MAX_CHUNKS = 24


def row_energy(px, w, y):
    """一行的内容能量：水平梯度绝对值和（低内容切口 = 低能量）。"""
    total = 0
    prev = px[0, y]
    for x in range(1, w):
        cur = px[x, y]
        total += abs(cur - prev)
        prev = cur
    return total


def find_boundaries(px, w, h, n_chunks):
    """在目标高度 ±40% 窗口内选能量最低的行做切口。"""
    boundaries = []
    for i in range(1, n_chunks):
        target = int(h * i / n_chunks)
        window = max(40, int(CHUNK_TARGET * 0.2))
        lo = max(1, target - window)
        hi = min(h - 1, target + window)
        best_y, best_e = lo, None
        for y in range(lo, hi):
            e = row_energy(px, w, y)
            if best_e is None or e < best_e:
                best_e, best_y = e, y
        boundaries.append(best_y)
    return boundaries


def normalize(text):
    return re.sub(r'\s+', '', text or '')


def merge_chunks(texts, boundaries, audit_lines):
    """重叠处合并：把前一块末尾与后一块开头重复的行去掉（只合并确实重复的内容）。"""
    merged = []
    for i, text in enumerate(texts):
        lines = [l.rstrip() for l in text.splitlines()] if text else []
        if i > 0:
            prev_lines = merged
            removed = []
            while lines and prev_lines and normalize(lines[0]) == normalize(prev_lines[-1]):
                removed.append(lines.pop(0))
            audit_lines.append('边界 %d: 前块尾行「%s」，合并重复 %d 行' % (i, prev_lines[-1][:60] if prev_lines else '(空)', len(removed)))
        merged.extend(lines)
    return '\n'.join(merged) + '\n'


def run(spec):
    path = contract.spec_file(spec, 'image', '图片')
    info = imgutil.image_info(path)
    try:
        im = Image.open(path).convert('L')
        im.load()
    except Exception:
        contract.fail('input', '不是可解析的图片: %s' % path)
    w, h = im.size
    if h < 400:
        contract.fail('input', '截图高度 %d 太短（长截图 OCR 需要 ≥400px）' % h)
    mode = spec.get('mode') or 'general'
    if mode not in ('general', 'chat'):
        contract.fail('input', 'mode 必须是 general 或 chat')
    run_name = spec.get('runName') or 'run'
    if not re.match(r'^[0-9A-Za-z._-]{1,48}$', str(run_name)):
        contract.fail('input', 'runName 非法（最多 48 个 [0-9A-Za-z._-] 字符）')
    jobs = spec.get('jobs')
    if jobs is not None and (not isinstance(jobs, int) or isinstance(jobs, bool) or not 1 <= jobs <= 8):
        contract.fail('input', 'jobs 必须是 1-8 的整数')
    split_only = bool(spec.get('splitOnly'))
    resume = bool(spec.get('resume'))
    run_dir = spec.get('runDir')
    if not isinstance(run_dir, str) or not run_dir:
        contract.fail('input', '缺少 runDir')
    os.makedirs(run_dir, exist_ok=True)

    manifest_path = os.path.join(run_dir, 'manifest.json')
    chunk_paths = []
    existing_texts = []
    reused = {'chunks': 0, 'ocr': 0}

    manifest = None
    if resume and os.path.isfile(manifest_path):
        try:
            with open(manifest_path, encoding='utf-8') as f:
                manifest = json.load(f)
            for item in manifest.get('chunks', []):
                cp = os.path.join(run_dir, item['file'])
                if os.path.isfile(cp):
                    chunk_paths.append(cp)
                ocr_file = os.path.join(run_dir, item['ocrFile'])
                if os.path.isfile(ocr_file) and not split_only:
                    with open(ocr_file, encoding='utf-8') as f:
                        existing_texts.append(f.read())
                    reused['ocr'] += 1
            if chunk_paths:
                reused['chunks'] = len(chunk_paths)
        except Exception:
            manifest = None
            chunk_paths = []

    if not chunk_paths:
        # 分块：低内容切口
        n_chunks = max(2, min(MAX_CHUNKS, h // CHUNK_TARGET + (1 if h % CHUNK_TARGET else 0)))
        px = im.load()
        boundaries = find_boundaries(px, w, h, n_chunks)
        starts = [0] + [max(0, b - OVERLAP) for b in boundaries]
        ends = boundaries + [h]
        for i, (s, e) in enumerate(zip(starts, ends)):
            s = max(0, s)
            e = min(h, e)
            chunk = im.crop((0, s, w, e))
            chunk_file = 'chunk_%03d_%d_%d.png' % (i + 1, s, e)
            chunk.save(os.path.join(run_dir, chunk_file), format='PNG')
            chunk_paths.append(os.path.join(run_dir, chunk_file))
            existing_texts.append('')
        manifest = {
            'runName': run_name,
            'image': path,
            'width': w,
            'height': h,
            'mode': mode,
            'chunks': [
                {'file': os.path.basename(cp), 'ocrFile': 'ocr_%03d.txt' % (i + 1), 'y0': s, 'y1': e}
                for i, (cp, (s, e)) in enumerate(zip(chunk_paths, zip(starts, ends)))
            ],
        }
        with open(manifest_path, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
    else:
        manifest = manifest or {'chunks': []}
        starts = [c.get('y0', 0) for c in manifest['chunks']]
        ends = [c.get('y1', h) for c in manifest['chunks']]

    if split_only:
        return {
            'chunks': len(chunk_paths),
            'complete': False,
            'runDir': run_dir,
            'chunkFiles': [os.path.basename(p) for p in chunk_paths],
            'reused': reused,
            'ocr': False,
        }

    # OCR：逐块（resume 时已有侧车文件的块跳过远程）；jobs>1 时线程池并发
    jobs = spec.get('jobs') or 1
    texts = []
    todo = []
    for i, cp in enumerate(chunk_paths):
        ocr_file = os.path.join(run_dir, 'ocr_%03d.txt' % (i + 1))
        if resume and os.path.isfile(ocr_file):
            with open(ocr_file, encoding='utf-8') as f:
                texts.append(f.read())
            continue
        todo.append((i, cp, ocr_file))

    def ocr_one(item):
        i, cp, ocr_file = item
        system = prompts.SYSTEM_OCR + ('\n这是聊天截图，按消息顺序转写。' if mode == 'chat' else '')
        hint = prompts.focus_hint(spec.get('hint'))
        user = '请转写这张长截图分块中的全部文字。' + ('\n' + hint if hint else '')
        resp = chat_completion(spec, system, user, [cp])
        text = resp['text']
        with open(ocr_file, 'w', encoding='utf-8') as f:
            f.write(text)
        return i, text

    if len(todo) == 1 or jobs <= 1:
        results = [ocr_one(item) for item in todo]
    else:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=min(jobs, len(todo))) as pool:
            results = list(pool.map(ocr_one, todo))
    for i, text in sorted(results, key=lambda pair: pair[0]):
        while len(texts) <= i:
            texts.append('')
        texts[i] = text

    audit_lines = ['# vision_long_screenshot_ocr 边界审计', '', 'run: %s' % run_name, 'chunks: %d' % len(chunk_paths), '']
    merged_text = merge_chunks(texts, boundaries=[], audit_lines=audit_lines)
    merged_path = os.path.join(run_dir, 'merged.md')
    audit_path = os.path.join(run_dir, 'audit.md')
    with open(merged_path, 'w', encoding='utf-8') as f:
        f.write(merged_text)
    with open(audit_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(audit_lines) + '\n')

    return {
        'chunks': len(chunk_paths),
        'complete': True,
        'runDir': run_dir,
        'mergedFile': merged_path,
        'manifestFile': manifest_path,
        'auditFile': audit_path,
        'chunkFiles': [os.path.basename(p) for p in chunk_paths],
        'reused': reused,
        'ocr': True,
    }
