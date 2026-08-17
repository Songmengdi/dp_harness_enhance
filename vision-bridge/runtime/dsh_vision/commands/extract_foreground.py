"""vision_extract_foreground：图标/logo → 透明 PNG（自动背景分割；失败可手工区域/排除色）。"""
import os

from PIL import Image

from .. import contract
from . import imgutil

TOLERANCE = 24
MIN_COMPONENT = 8


def flood_from_borders(px, w, h, bg, tol):
    """从四周边界泛洪背景；返回背景布尔矩阵。"""
    from collections import deque
    visited = [[False] * w for _ in range(h)]
    queue = deque()
    for x in range(w):
        for y in (0, h - 1):
            queue.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            queue.append((x, y))
    while queue:
        x, y = queue.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or visited[y][x]:
            continue
        p = px[x, y]
        if sum((p[i] - bg[i]) ** 2 for i in range(3)) > tol ** 2:
            continue
        visited[y][x] = True
        queue.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    return visited


def components_of(mask, w, h):
    """8 连通前景分量。"""
    labels = [[0] * w for _ in range(h)]
    stack = []
    sizes = []
    label = 0
    for y in range(h):
        for x in range(w):
            if not mask[y][x] or labels[y][x]:
                continue
            label += 1
            size = 0
            stack.append((x, y))
            labels[y][x] = label
            while stack:
                cx, cy = stack.pop()
                size += 1
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = cx + dx, cy + dy
                        if 0 <= nx < w and 0 <= ny < h and mask[ny][nx] and not labels[ny][nx]:
                            labels[ny][nx] = label
                            stack.append((nx, ny))
            sizes.append(size)
    return label, sizes


def run(spec):
    path = contract.spec_file(spec, 'image', '图片')
    info = imgutil.image_info(path)
    try:
        im = Image.open(path).convert('RGB')
        im.load()
    except Exception:
        contract.fail('input', '不是可解析的图片: %s' % path)
    w, h = im.size
    region = imgutil.parse_region(spec, info['width'], info['height'])
    mode = spec.get('mode') or 'auto'
    if mode not in ('auto', 'manual'):
        contract.fail('input', 'mode 必须是 auto 或 manual')
    exclude = spec.get('excludeColor')
    if exclude is not None and not isinstance(exclude, str):
        contract.fail('input', 'excludeColor 必须是 #rrggbb')

    px = im.load()
    if mode == 'manual':
        if region is None and exclude is None:
            contract.fail('input', 'manual 模式需要 region 或 excludeColor')
        bg_rgb = None
        if exclude is not None:
            try:
                bg_rgb = tuple(int(exclude.lstrip('#')[i:i + 2], 16) for i in (0, 2, 4))
            except (ValueError, IndexError):
                contract.fail('input', 'excludeColor 非法: %s' % exclude)
        if bg_rgb is None:
            counts = {}
            for x in range(w):
                for y in (0, h - 1):
                    counts[px[x, y]] = counts.get(px[x, y], 0) + 1
            bg_rgb = max(counts, key=counts.get)
        mask = [[False] * w for _ in range(h)]
        if region is not None:
            for y in range(region['y'], region['y2']):
                for x in range(region['x'], region['x2']):
                    mask[y][x] = sum((px[x, y][i] - bg_rgb[i]) ** 2 for i in range(3)) > TOLERANCE ** 2
        else:
            for y in range(h):
                for x in range(w):
                    mask[y][x] = sum((px[x, y][i] - bg_rgb[i]) ** 2 for i in range(3)) > TOLERANCE ** 2
    else:
        # auto：边界主导色为背景，泛洪后取反
        counts = {}
        for x in range(w):
            for y in (0, h - 1):
                counts[px[x, y]] = counts.get(px[x, y], 0) + 1
        for y in range(h):
            for x in (0, w - 1):
                counts[px[x, y]] = counts.get(px[x, y], 0) + 1
        bg_rgb = max(counts, key=counts.get)
        bg_mask = flood_from_borders(px, w, h, bg_rgb, TOLERANCE)
        mask = [[not bg_mask[y][x] for x in range(w)] for y in range(h)]

    total = w * h
    coverage = sum(1 for y in range(h) for x in range(w) if mask[y][x])
    coverage_pct = round(coverage * 100.0 / total, 2)
    if coverage == 0:
        contract.fail('output', '自动模式未找到前景；请用 mode=manual + region/excludeColor 重试')
    if coverage_pct > 98:
        contract.fail('output', '前景覆盖几乎整图（背景估计失败）；请用 mode=manual 指定区域或排除色')

    component_count, sizes = components_of(mask, w, h)
    kept = [s for s in sizes if s >= MIN_COMPONENT]
    if not kept:
        contract.fail('output', '前景分量都太小（可能是噪点）；请用 mode=manual 指定区域')

    # 透明 PNG：保留全部前景，其余透明
    rgba = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    rp = rgba.load()
    for y in range(h):
        for x in range(w):
            if mask[y][x]:
                r, g, b = px[x, y]
                rp[x, y] = (r, g, b, 255)

    # box = 前景最小外接框
    xs = [x for y in range(h) for x in range(w) if mask[y][x]]
    ys = [y for y in range(h) for x in range(w) if mask[y][x]]
    box = {'x1': min(xs), 'y1': min(ys), 'x2': max(xs) + 1, 'y2': max(ys) + 1}

    out_dir = spec.get('outDir')
    if not isinstance(out_dir, str) or not out_dir:
        contract.fail('input', '缺少 outDir（staging 目录）')
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, 'foreground.png')
    rgba.save(out_path, format='PNG')
    return {
        'box': box,
        'components': len(kept),
        'coveragePct': coverage_pct,
        'width': w,
        'height': h,
        'file': out_path,
    }
