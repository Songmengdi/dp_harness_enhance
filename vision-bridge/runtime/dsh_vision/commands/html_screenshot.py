"""vision_html_screenshot：本地 HTML → 视口 PNG（无头浏览器；禁网 + 一次性临时 profile）。"""
import os
import shutil
import subprocess
import tempfile
import time

from PIL import Image

from .. import contract
from . import imgutil

CHROME_CANDIDATES = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]

SHOT_TIMEOUT_S = 60


def find_browser():
    env = os.environ.get('DSH_VISION_CHROME')
    if env and os.path.isfile(env):
        return env
    for candidate in CHROME_CANDIDATES:
        if os.path.isfile(candidate):
            return candidate
    for name in ('google-chrome', 'chromium', 'chromium-browser', 'chrome', 'msedge'):
        found = shutil.which(name)
        if found:
            return found
    return None


def run(spec):
    path = contract.spec_file(spec, 'source', 'HTML')
    ext = os.path.splitext(path)[1].lower()
    if ext not in ('.html', '.htm'):
        contract.fail('input', '只接受工作区内的本地 .html/.htm（拒绝 URL 与 data URI）: %s' % path)
    width = spec.get('width') or 1280
    height = spec.get('height') or 800
    scale = spec.get('scale') or 1
    wait_ms = spec.get('waitMs') or 300
    for name, value in (('width', width), ('height', height)):
        if not isinstance(value, int) or isinstance(value, bool) or not 64 <= value <= 5120:
            contract.fail('input', '%s 必须是 64-5120 的整数' % name)
    if not isinstance(scale, int) or isinstance(scale, bool) or not 1 <= scale <= 4:
        contract.fail('input', 'scale 必须是 1-4 的整数')
    if not isinstance(wait_ms, int) or isinstance(wait_ms, bool) or not 0 <= wait_ms <= 30000:
        contract.fail('input', 'waitMs 必须是 0-30000 的整数')

    browser = find_browser()
    if browser is None:
        contract.fail('runtime', '找不到 Chrome/Chromium/Edge（仅 vision_html_screenshot 不可用，其他工具不受影响）')

    out_dir = spec.get('outDir')
    if not isinstance(out_dir, str) or not out_dir:
        contract.fail('input', '缺少 outDir（staging 目录）')
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, 'shot.png')
    profile = tempfile.mkdtemp(prefix='dsh-vision-chrome-')
    proc = None
    try:
        url = 'file://' + os.path.abspath(path)
        argv = [
            browser,
            '--headless=new',
            '--disable-gpu',
            '--no-sandbox',
            '--disable-extensions',
            '--disable-background-networking',
            '--no-first-run',
            '--use-mock-keychain',
            '--disable-dev-shm-usage',
            '--hide-scrollbars',
            # 禁用网络：所有主机名解析到不存在（file:// 本地内容不受影响）
            '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost',
            '--user-data-dir=' + profile,
            '--window-size=%d,%d' % (width, height),
            '--force-device-scale-factor=%d' % scale,
            '--virtual-time-budget=%d' % wait_ms,
            '--screenshot=' + out_path,
            url,
        ]
        try:
            proc = subprocess.Popen(argv, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except FileNotFoundError:
            contract.fail('runtime', '浏览器可执行文件不可用: %s' % browser)
        # 某些 Chrome 版本写出截图后进程不退出（后台网络噪声），以产物文件为准
        deadline = time.time() + SHOT_TIMEOUT_S
        shot_ok = False
        while time.time() < deadline:
            if proc.poll() is not None:
                break
            if os.path.isfile(out_path) and os.path.getsize(out_path) > 0:
                shot_ok = True
                break
            time.sleep(0.2)
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except Exception:
                proc.kill()
        if not shot_ok:
            contract.fail('runtime', '无头浏览器渲染失败（%ds 内未产出截图）' % SHOT_TIMEOUT_S)
        try:
            shot = Image.open(out_path)
            sw, sh = shot.size
            shot.load()
            shot.close()
        except Exception:
            contract.fail('output', '截图不是合法 PNG')
        return {
            'source': {'path': path, 'bytes': os.path.getsize(path)},
            'viewport': {'width': width, 'height': height},
            'rendered': {'width': sw, 'height': sh},
            'file': out_path,
        }
    finally:
        if proc is not None and proc.poll() is None:
            try:
                proc.kill()
            except Exception:
                pass
        shutil.rmtree(profile, ignore_errors=True)

