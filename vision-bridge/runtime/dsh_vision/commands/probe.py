"""probe：运行时健康探针（managed venv 就绪性检查）。"""
import sys

from .. import __version__


def run(spec):
    return {
        'ok': True,
        'runtime': 'dsh-vision',
        'version': __version__,
        'python': '%d.%d.%d' % sys.version_info[:3],
    }
