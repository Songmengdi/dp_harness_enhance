"""Host↔Python 契约：stdout 单段 JSON envelope + 稳定退出码 + 脱敏 stderr。

envelope（stdout 唯一格式）：
  {"ok": true,  "result": <子命令结果 JSON>}
  {"ok": false, "error": {"category": "<稳定错误类别>", "message": "<脱敏信息>"}}

稳定退出码（ok 为 0，其余与错误类别对应）：
  0 ok | 2 input | 3 config | 4 upstream | 5 runtime | 6 output
取消/超时由 Host 侧信号终止进程判定（cancelled / timeout），Python 不定义退出码。
"""
import json
import os
import sys

EXIT_BY_CATEGORY = {
    'input': 2,
    'config': 3,
    'upstream': 4,
    'runtime': 5,
    'output': 6,
}

# 疑似凭据的环境变量名：其值在任何 stderr/错误文本里都被替换。
_SECRET_NAME_HINTS = ('KEY', 'TOKEN', 'SECRET', 'PASSWORD', 'CREDENTIAL')


def _secret_values():
    values = []
    for name, value in os.environ.items():
        up = name.upper()
        if up.startswith('DSH_VISION_') and any(h in up for h in _SECRET_NAME_HINTS):
            if value:
                values.append(value)
    return values


def sanitize(text):
    """把已知凭据值从文本中移除，防止上游错误正文泄密。"""
    if not isinstance(text, str):
        text = str(text)
    for value in _secret_values():
        if value:
            text = text.replace(value, '[REDACTED]')
    return text


def ok(result):
    json.dump({'ok': True, 'result': result}, sys.stdout, ensure_ascii=False)
    sys.stdout.write('\n')
    sys.stdout.flush()


def fail(category, message, exit_code=None):
    """输出 envelope 并以稳定退出码退出；stderr 只留一行脱敏摘要。"""
    message = sanitize(message)
    json.dump({'ok': False, 'error': {'category': category, 'message': message}},
              sys.stdout, ensure_ascii=False)
    sys.stdout.write('\n')
    sys.stdout.flush()
    try:
        sys.stderr.write('[%s] %s\n' % (category, message))
        sys.stderr.flush()
    except Exception:
        pass
    sys.exit(EXIT_BY_CATEGORY.get(category, 5) if exit_code is None else exit_code)


def spec_file(spec, key='path', kind='文件'):
    """读取并校验 spec 中的输入文件路径。"""
    path = spec.get(key)
    if not isinstance(path, str) or not path:
        fail('input', '缺少参数 %s' % key)
    if not os.path.isfile(path):
        fail('input', '%s不存在或不是文件: %s' % (kind, path))
    if not os.access(path, os.R_OK):
        fail('input', '%s不可读: %s' % (kind, path))
    return path
