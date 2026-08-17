"""OpenAI-compatible 远程视觉客户端（02 票冻结）。

- 凭据只从环境变量读取（Host 现取现用注入），绝不落盘。
- 429/5xx/网络错误退避重试（最多 maxRetries 次）；整操作硬超时。
- 上游错误正文先脱敏再带进异常信息。
"""
import base64
import json
import os
import ssl
import time
import urllib.error
import urllib.request

from . import contract
from .prompts import focus_hint


def _ssl_context():
    """TLS 校验上下文：优先 certifi（macOS 框架 Python 默认 CA 常常为空）。"""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def data_url(path):
    """本地图片 → data URL（远程端点直接消费）。"""
    try:
        with open(path, 'rb') as f:
            data = f.read()
    except OSError as exc:
        contract.fail('input', '无法读取图片 %s: %s' % (path, exc))
    ext = path.rsplit('.', 1)[-1].lower() if '.' in path else ''
    mime = {
        'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
        'gif': 'image/gif', 'webp': 'image/webp', 'bmp': 'image/bmp',
    }.get(ext)
    if mime is None:
        try:
            from PIL import Image
            import io
            im = Image.open(path).convert('RGB')
            buf = io.BytesIO()
            im.save(buf, format='JPEG', quality=92)
            data = buf.getvalue()
            mime = 'image/jpeg'
        except Exception as exc:
            contract.fail('input', '无法把 %s 转成图片: %s' % (path, exc))
    return 'data:%s;base64,%s' % (mime, base64.b64encode(data).decode())


class UpstreamError(Exception):
    def __init__(self, message):
        super().__init__(contract.sanitize(message))
        self.message = contract.sanitize(message)


def _http_post_json(url, payload, headers, timeout_s):
    body = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=body, headers=headers, method='POST')
    with urllib.request.urlopen(req, timeout=timeout_s, context=_ssl_context()) as resp:
        return json.loads(resp.read().decode('utf-8'))


def chat_completion(spec, system, user_text, image_paths):
    """一次视觉请求：{text, finishReason}；退避重试 429/5xx/网络错误。"""
    endpoint = (spec.get('endpoint') or '').strip().rstrip('/')
    model = (spec.get('model') or '').strip()
    if not endpoint or not model:
        contract.fail('config', '未配置视觉端点/模型（endpoint 与 model 均为空）')
    # D7：凭据只从环境变量读取（Host 现取现用注入），绝不进 argv/绝不落盘
    api_key = os.environ.get('DSH_VISION_API_KEY', '')
    timeout_s = max(1, int(spec.get('timeoutMs', 90000)) / 1000.0)
    max_retries = int(spec.get('maxRetries', 2))

    content = [{'type': 'text', 'text': user_text}]
    for p in image_paths:
        content.append({'type': 'image_url', 'image_url': {'url': data_url(p)}})
    payload = {
        'model': model,
        'max_tokens': int(spec.get('maxTokens', 1600)),
        'temperature': 0.2,
        'messages': [
            {'role': 'system', 'content': system},
            {'role': 'user', 'content': content},
        ],
    }
    headers = {'Content-Type': 'application/json'}
    if api_key:
        headers['Authorization'] = 'Bearer ' + api_key
    url = endpoint + '/chat/completions'

    last_error = '上游请求失败'
    for attempt in range(max_retries + 1):
        try:
            resp = _http_post_json(url, payload, headers, timeout_s)
        except urllib.error.HTTPError as exc:
            body = ''
            try:
                body = exc.read().decode('utf-8', 'replace')
            except Exception:
                pass
            if exc.code in (429,) or exc.code >= 500:
                last_error = 'HTTP %s: %s' % (exc.code, body[:300])
                if attempt < max_retries:
                    time.sleep(0.5 * (2 ** attempt))
                    continue
            contract.fail('upstream', 'HTTP %s: %s' % (exc.code, body[:300]))
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = '网络错误: %s' % exc
            if attempt < max_retries:
                time.sleep(0.5 * (2 ** attempt))
                continue
            contract.fail('upstream', last_error)
        break
    else:
        contract.fail('upstream', last_error)

    try:
        message = resp['choices'][0]['message']
        text = message.get('content') or ''
        finish = resp['choices'][0].get('finish_reason')
    except (KeyError, IndexError, TypeError):
        contract.fail('output', '上游返回结构异常（缺少 choices[0].message）')
    if not isinstance(text, str) or not text.strip():
        contract.fail('output', '上游返回空回答（非结构化回答视为 output 错误）')
    return {'text': text, 'finishReason': finish}


def parse_boxes_json(text, max_side=1000):
    """从 VLM 文本里解析唯一 JSON；容错首尾杂讯。"""
    text = text.strip()
    start = text.find('{')
    end = text.rfind('}')
    if start < 0 or end <= start:
        raise UpstreamError('回答里没有 JSON 对象: %s' % text[:200])
    try:
        data = json.loads(text[start:end + 1])
    except Exception:
        raise UpstreamError('回答 JSON 无法解析: %s' % text[:200])
    matches = data.get('matches')
    if not isinstance(matches, list):
        raise UpstreamError('JSON 缺少 matches 数组')
    out = []
    for item in matches:
        if not isinstance(item, dict):
            continue
        label = item.get('label')
        box = item.get('box')
        if not isinstance(label, str) or not isinstance(box, list) or len(box) != 4:
            continue
        try:
            x1, y1, x2, y2 = [float(v) for v in box]
        except (TypeError, ValueError):
            continue
        if not (0 <= x1 < x2 <= max_side and 0 <= y1 < y2 <= max_side):
            continue
        out.append({'label': label, 'box': [x1, y1, x2, y2]})
    return out
