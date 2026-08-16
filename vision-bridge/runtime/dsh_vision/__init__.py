"""dsh-vision runtime — vision-bridge Route C 的 Python 运行时。

单入口分派子命令；每个子命令无状态、argv 输入、stdout 输出一段 JSON；
错误用稳定退出码 + 脱敏 stderr。Host 侧通过
`<venv python> -m dsh_vision <sub> --spec '<json>'` 调用（argv 向量，无 shell）。
"""

__version__ = '0.1.0'
