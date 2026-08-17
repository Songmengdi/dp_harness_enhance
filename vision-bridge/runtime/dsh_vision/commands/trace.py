"""vision_trace：扁平图形 → SVG 几何（小图标先放大分析，输出按原图坐标）。"""
import math
import os

from PIL import Image, ImageFilter

from .. import contract
from . import imgutil

MAX_ANALYSIS_SIDE = 1024


def otsu_threshold(gray):
    hist = gray.histogram()
    total = sum(hist)
    if total == 0:
        return 127
    sum_all = sum(i * hist[i] for i in range(256))
    sum_b, w_b, best, best_v = 0.0, 0.0, 127, -1.0
    for t in range(256):
        w_b += hist[t]
        if w_b == 0:
            continue
        w_f = total - w_b
        if w_f == 0:
            break
        sum_b += t * hist[t]
        m_b = sum_b / w_b
        m_f = (sum_all - sum_b) / w_f
        between = w_b * w_f * (m_b - m_f) ** 2
        if between > best_v:
            best_v, best = between, t
    return best


def douglas_peucker(points, eps):
    if len(points) < 3:
        return points
    dmax, index = 0.0, 0
    end = len(points) - 1
    for i in range(1, end):
        x1, y1 = points[0]
        x2, y2 = points[end]
        dx, dy = x2 - x1, y2 - y1
        denom = math.hypot(dx, dy)
        d = abs(dy * points[i][0] - dx * points[i][1] + x2 * y1 - y2 * x1) / denom if denom else math.hypot(points[i][0] - x1, points[i][1] - y1)
        if d > dmax:
            dmax, index = d, i
    if dmax > eps:
        left = douglas_peucker(points[:index + 1], eps)
        right = douglas_peucker(points[index:], eps)
        return left[:-1] + right
    return [points[0], points[end]]


NEIGHBORS8 = [(-1, -1), (0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0)]


def trace_mask(mask, w, h):
    """对 bool 掩码做 Moore 边界追踪：每个连通墨迹区域一条闭合轮廓。"""
    ink = mask
    contours = []
    on_boundary = [[False] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            if not ink[y][x]:
                continue
            edge = False
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if nx < 0 or ny < 0 or nx >= w or ny >= h or not ink[ny][nx]:
                    edge = True
                    break
            if not edge or on_boundary[y][x]:
                continue
            contour = moore_trace(ink, w, h, x, y)
            if len(contour) >= 6:
                contours.append(contour)
                for px, py in contour:
                    on_boundary[py][px] = True
    return contours


def moore_trace(ink, w, h, sx, sy):
    """从边界像素出发逆时针追踪闭合轮廓。"""
    points = [(sx, sy)]
    cx, cy = sx, sy
    direction = 0  # 初始朝右（来向为左）
    while True:
        found = None
        # 从当前方向的顺时针侧开始找下一个墨迹像素
        for i in range(8):
            d = (direction + i) % 8
            dx, dy = NEIGHBORS8[d]
            nx, ny = cx + dx, cy + dy
            if 0 <= nx < w and 0 <= ny < h and ink[ny][nx]:
                found = (nx, ny)
                direction = (d + 5) % 8  # 面向来向的左侧回退
                break
        if found is None:
            break
        if found == (sx, sy) and len(points) > 1:
            break
        if len(points) > 4 * (w + h):
            break  # 防死循环
        cx, cy = found
        points.append(found)
    return points


def to_svg(contours, scale, width, height, color_enabled, color_image, analysis_w, analysis_h):
    """把分析坐标下的轮廓转成原图坐标的 SVG path。"""
    lines = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">' % (width, height, width, height),
    ]
    for contour in contours:
        simplified = douglas_peucker(contour, eps=max(1.0, 1.2 * scale))
        if len(simplified) < 3:
            continue
        scaled = [((x + 0.5) / scale, (y + 0.5) / scale) for x, y in simplified]
        d = 'M %.2f %.2f ' % scaled[0]
        for x, y in scaled[1:]:
            d += 'L %.2f %.2f ' % (x, y)
        d += 'Z'
        fill = 'none'
        if color_enabled:
            px = min(analysis_w - 1, simplified[0][0])
            py = min(analysis_h - 1, simplified[0][1])
            r, g, b = color_image.getpixel((px, py))[:3]
            fill = '#%02x%02x%02x' % (r, g, b)
        lines.append('  <path d="%s" fill="%s" stroke="#000" stroke-width="0.8"/>' % (d, fill))
    lines.append('</svg>')
    return '\n'.join(lines) + '\n'


def svg_is_safe(text):
    """SVG 安全校验：合法 XML、单一 svg 根、拒绝危险结构。"""
    import xml.etree.ElementTree as ET
    lowered = text.lower()
    if '<!doctype' in lowered or '<script' in lowered or 'javascript:' in lowered or '<foreignobject' in lowered:
        return False, '危险结构（DOCTYPE/script/foreignObject/javascript:）'
    try:
        root = ET.fromstring(text)
    except Exception as exc:
        return False, '不是合法 XML: %s' % exc
    tag = root.tag.split('}')[-1].lower()
    if tag != 'svg':
        return False, '根元素不是 svg'
    return True, ''


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

    orig_w, orig_h = im.size
    # 小图标先放大分析（保持输出几何按原图坐标）
    scale = 1
    if min(orig_w, orig_h) < 64:
        scale = min(4, math.ceil(64.0 / max(1, min(orig_w, orig_h))))
        analysis = im.resize((orig_w * scale, orig_h * scale), Image.NEAREST)
    else:
        analysis = im
    if max(analysis.size) > MAX_ANALYSIS_SIDE:
        factor = MAX_ANALYSIS_SIDE / max(analysis.size)
        analysis = analysis.resize((max(1, int(analysis.width * factor)), max(1, int(analysis.height * factor))), Image.NEAREST)
        scale = scale * factor
    aw, ah = analysis.size

    gray = analysis.convert('L')
    thr = otsu_threshold(gray)
    corner = sum(gray.getpixel(p) for p in ((0, 0), (aw - 1, 0), (0, ah - 1), (aw - 1, ah - 1))) / 4.0
    dark_ink = corner > 127
    px = gray.load()
    ink = [[(px[x, y] <= thr) if dark_ink else (px[x, y] >= thr) for x in range(aw)] for y in range(ah)]

    contours = trace_mask(ink, aw, ah)
    if not contours:
        contract.fail('output', '未追踪到任何轮廓（图片可能不是扁平高对比图形）')

    color_enabled = bool(spec.get('color'))
    outline = bool(spec.get('outline'))
    svg_text = to_svg(contours, scale, orig_w, orig_h, color_enabled, analysis, aw, ah)
    ok, reason = svg_is_safe(svg_text)
    if not ok:
        contract.fail('output', 'SVG 校验失败: %s' % reason)

    out_dir = spec.get('outDir')
    if not isinstance(out_dir, str) or not out_dir:
        contract.fail('input', '缺少 outDir（staging 目录）')
    os.makedirs(out_dir, exist_ok=True)
    out_name = 'trace.svg'
    out_path = os.path.join(out_dir, out_name)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(svg_text)
    return {
        'svg': out_path,
        'paths': len(contours),
        'width': orig_w,
        'height': orig_h,
        'scale': round(scale, 3),
        'file': out_path,
    }
