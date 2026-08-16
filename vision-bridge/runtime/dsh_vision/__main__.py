"""单入口分派：python -m dsh_vision <sub> --spec '<json>'。

argv 向量 + 环境变量输入；stdout 单段 JSON；错误稳定退出码 + 脱敏 stderr。
"""
import json
import sys

from . import contract
from .commands import frames, media, probe

SUBCOMMANDS = {
    'probe': probe,
    'media': media,
    'frames': frames,
}


def parse_argv(argv):
    if not argv:
        contract.fail('input', '缺少子命令，可用: %s' % ', '.join(sorted(SUBCOMMANDS)))
    sub = argv[0]
    rest = argv[1:]
    spec = {}
    if rest:
        if len(rest) == 2 and rest[0] == '--spec':
            raw = rest[1]
        elif len(rest) == 1 and rest[0].startswith('{'):
            raw = rest[0]
        else:
            contract.fail('input', '参数必须是 --spec <json>（argv 向量，无 shell）')
        try:
            spec = json.loads(raw)
        except Exception:
            contract.fail('input', '--spec 不是合法 JSON')
        if not isinstance(spec, dict):
            contract.fail('input', '--spec 必须是 JSON 对象')
    return sub, spec


def main(argv=None):
    sub, spec = parse_argv(list(sys.argv[1:] if argv is None else argv))
    module = SUBCOMMANDS.get(sub)
    if module is None:
        contract.fail('input', '未知子命令 %s，可用: %s' % (sub, ', '.join(sorted(SUBCOMMANDS))))
    try:
        contract.ok(module.run(spec))
    except SystemExit:
        raise
    except Exception as exc:  # 未预期异常 → runtime 类别，脱敏短摘要
        contract.fail('runtime', '%s: %s' % (type(exc).__name__, contract.sanitize(str(exc)[:400])))


if __name__ == '__main__':
    main()
