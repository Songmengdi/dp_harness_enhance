// vision-hook：纯文本模型外挂视觉（工具级钩子 + 粘贴图片落地转路径）
// 真实 Cordis 插件：挂在 agent preset 里，工具事件按会话作用域过滤。
export const name = 'vision-hook'

export function apply(ctx) {
  const shell = ctx.get('shell')
  if (shell === undefined) return
  const llm = ctx.get('llm')
  const settings = ctx.get('settings')
  const credentials = ctx.get('credentials')
  const fs = ctx.get('fs')
  const systemPrompt = ctx.get('systemPrompt')
  const agentDefaultModel = ctx.get('agentDefaultModel')
  const attachments = ctx.get('attachments')

  // ── CLI 源解析：优先读项目内 cli/dsh-vision（唯一真源），缺失时回退内嵌副本 ──
  let projectCliPath = null
  try {
    const u = new URL('../../cli/dsh-vision', import.meta.url)
    if (u.protocol === 'file:') projectCliPath = decodeURIComponent(u.pathname)
  } catch (e) {}

  const shq = function (s) {
    return "'" + String(s).replace(/'/g, "'\\''") + "'"
  }

  async function runCmd(command, opts) {
    opts = opts || {}
    const req = {
      command: command,
      timeoutMs: opts.timeoutMs || 60000,
      stdoutMaxBytes: opts.stdoutMaxBytes || 262144,
    }
    return shell.run(shell.resolve(req))
  }

  let cachedHome = null
  async function readHome() {
    if (cachedHome !== null) return cachedHome
    const r = await runCmd('printenv HOME || true', { stdoutMaxBytes: 4096 })
    cachedHome = (r.stdout.text || '').trim() || '/tmp'
    return cachedHome
  }

  // ══ CLI_SRC_BEGIN ══（由 vision-bridge/sync-cli.js 从 cli/dsh-vision 自动同步，勿手改此块）
  const CLI_SRC = String.raw`#!/usr/bin/env python3
# dsh-vision — 视觉桥 CLI
# 由 vision-hook 插件安装到 ~/.dsh/bin/dsh-vision；配置缓存 ~/.dsh/vision-bridge/cli.json
import argparse
import base64
import io
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

CONFIG_PATH = os.path.expanduser('~/.dsh/vision-bridge/cli.json')

USAGE = '''用法（通过 bash 工具执行）：
  dsh-vision describe <图1> [图2 ...] [--question "..."] [--focus "..."] [--max-tokens N]
      核心命令：让明眼人看图。
      · 一张图 + 无 --question：完整独立全景描述（对象/颜色/位置/文字/布局 + 关键事实清单）
      · 一张图 + --question：五段式回答（直接回答/实际所见/证据/信心/补充），绝不只答是/否
      · 多张图：逐张独立描述（图1/图2…），互不参考；差异对比由你自己推理，别让 VLM 总结
  dsh-vision pixel <图> [--mode grid|points|region|hist|edges] [--n N] [--points "x,y;x,y"] [--region "x,y,w,h"]
      像素级颜色/亮度数据
  dsh-vision media <文件>
      ffprobe 元数据：时长/分辨率/帧率/编码（图片与音视频均可）
  dsh-vision frames <视频> --times "0:05,10,1:30.5"
      ffmpeg 抽帧（逗号分隔时间点，最多 8 个），返回帧路径，再逐帧 describe
  dsh-vision config
      显示当前视觉模型配置（不显示 key）

指挥视觉模型的提问方法（明眼人协议）：
  1) 第一轮不要提问，先要全景描述，再核对你的假设（你的猜测不是事实）。
  2) 提问要具体可观测（数量/颜色名/方位+坐标/文字逐字）。
  3) 每次提问都要求五段式回答（直接回答/实际所见/证据/信心/补充），绝不接受只答是/否。
  4) 对关键声明追问证据；对方说不确定就要求明说，禁止编造。
'''

SYSTEM_DESCRIBE = (
    '你是一名视觉向导，为一位完全没有视觉能力的 AI 同事描述图像。这位同事可能带着错误的预设提问，'
    '因此你绝不能只回答它预设的问题，而必须先如实描述图像全貌。规则：'
    '1) 先给完整、独立的全景描述：场景类型；每个主要物体的名称、颜色、形状、材质与可见文字；'
    '物体位置（用九宫格方位加近似比例，如「画面左上角约 (10%, 25%)」）；物体之间的空间关系；整体布局与构图。'
    '2) 图中所有可见文字必须逐字转写（包括小字、水印、按钮），并注明位置。'
    '3) 描述尽量具体、可核对：给出数量、颜色名、近似坐标、比例。'
    '4) 看不清或不确定处必须明说「不确定」，禁止编造。'
    '5) 结尾输出【关键事实清单】，逐条列出图中确定的事实。'
    '若同时给多张图片，必须逐张独立描述（标清图1、图2…），不得互相参考，不得输出对比结论。'
    '用中文回答。'
)

SYSTEM_ASK = (
    '你是一名视觉向导，为一位完全没有视觉能力的 AI 同事看图答疑。'
    '这位同事可能基于完全错误的假设提问（比如指着消防栓问「这是不是水桶」）。'
    '你的回答必须包含五个部分：1)【直接回答】明确回答它的问题；'
    '2)【实际所见】不管它的预设是什么，先描述图中该区域实际是什么样子（物体名称、颜色、形状、位置、文字）；'
    '3)【证据】支撑判断的具体视觉特征；4)【信心】0-10 分并说明理由；5)【补充】它可能还想知道的相邻信息。'
    '禁止只回答「是/不是/没有」，每次回答都必须携带实际描述。'
    '若同时给多张图片，先逐张描述（标清图1、图2…），再针对问题回答。'
    '用中文回答。'
)


def load_config():
    try:
        with open(CONFIG_PATH, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def ensure_config():
    cfg = load_config()
    if not cfg or not cfg.get('model') or not cfg.get('endpoint'):
        print(
            '未找到视觉模型配置。请在 Harness 设置 → 模型页配置一个声明了图片输入（input 含 image）的模型，'
            'vision-hook 插件会自动刷新本缓存（~/.dsh/vision-bridge/cli.json）。',
            file=sys.stderr,
        )
        sys.exit(2)
    return cfg


def to_data_url(path):
    data = open(path, 'rb').read()
    ext = os.path.splitext(path)[1].lower().lstrip('.')
    mime = {
        'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
        'gif': 'image/gif', 'webp': 'image/webp', 'bmp': 'image/bmp',
    }.get(ext)
    if mime is None:
        try:
            from PIL import Image
            im = Image.open(path).convert('RGB')
            buf = io.BytesIO()
            im.save(buf, format='JPEG', quality=92)
            data = buf.getvalue()
            mime = 'image/jpeg'
        except Exception:
            try:
                out = path + '.dshconv.jpg'
                subprocess.run(['magick', path, out], check=True, capture_output=True)
                data = open(out, 'rb').read()
                os.unlink(out)
                mime = 'image/jpeg'
            except Exception as exc:
                print('无法读取图片 %s: %s' % (path, exc), file=sys.stderr)
                sys.exit(1)
    return 'data:%s;base64,%s' % (mime, base64.b64encode(data).decode())


def http_post_json(url, payload, headers):
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=170) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode('utf-8', 'replace')
        print('HTTP %s: %s' % (exc.code, body[:400]), file=sys.stderr)
        sys.exit(3)
    except Exception as exc:
        print('网络错误: %s' % exc, file=sys.stderr)
        sys.exit(3)


def build_user_text(paths, question, focus):
    n = len(paths)
    parts = []
    if question:
        parts.append('问题：' + question)
        parts.append('共 %d 张图片，按顺序编号为 图1 ~ 图%d。' % (n, n))
    elif n > 1:
        parts.append('请逐一独立描述以下 %d 张图片（图1 ~ 图%d）。' % (n, n))
    else:
        parts.append('请完整描述这张图片。')
    if focus:
        parts.append('重点：' + focus)
    return '\n'.join(parts)


def cmd_describe(args):
    cfg = ensure_config()
    paths = args.paths
    if len(paths) > 10:
        print('一次最多 10 张图，请分批调用。', file=sys.stderr)
        sys.exit(2)
    system = SYSTEM_ASK if args.question else SYSTEM_DESCRIBE
    user = build_user_text(paths, args.question, args.focus)
    max_tokens = args.max_tokens or 1600
    protocol = args.protocol or cfg.get('protocol') or 'openai-completions'
    if protocol == 'anthropic-messages':
        content = [{'type': 'text', 'text': user}]
        for p in paths:
            head, b64 = to_data_url(p).split(',', 1)
            content.append({
                'type': 'image',
                'source': {'type': 'base64', 'media_type': head[5:], 'data': b64},
            })
        body = {
            'model': cfg['model'], 'max_tokens': max_tokens, 'temperature': 0.2,
            'system': system,
            'messages': [{'role': 'user', 'content': content}],
        }
        headers = {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
        }
        if cfg.get('apiKey'):
            headers['x-api-key'] = cfg['apiKey']
        resp = http_post_json(cfg['endpoint'].rstrip('/') + '/v1/messages', body, headers)
        texts = [b.get('text', '') for b in resp.get('content', []) if b.get('type') == 'text']
        print(''.join(texts))
    else:
        content = [{'type': 'text', 'text': user}]
        for p in paths:
            content.append({'type': 'image_url', 'image_url': {'url': to_data_url(p)}})
        body = {
            'model': cfg['model'], 'max_tokens': max_tokens, 'temperature': 0.2,
            'messages': [
                {'role': 'system', 'content': system},
                {'role': 'user', 'content': content},
            ],
        }
        headers = {'Content-Type': 'application/json'}
        if cfg.get('apiKey'):
            headers['Authorization'] = 'Bearer ' + cfg['apiKey']
        resp = http_post_json(cfg['endpoint'].rstrip('/') + '/chat/completions', body, headers)
        print(resp['choices'][0]['message']['content'])


def cmd_pixel(args):
    spec = {'mode': args.mode or 'grid', 'n': args.n or 8}
    if args.points:
        spec['points'] = [[int(v) for v in pt.split(',')] for pt in args.points.split(';')]
    if args.region:
        spec['region'] = [int(v) for v in args.region.split(',')]
    env = dict(os.environ)
    env['P_PATH'] = args.path
    env['P_SPEC'] = json.dumps(spec)
    script = r'''
import os, json
from PIL import Image, ImageFilter, ImageStat
path = os.environ['P_PATH']
spec = json.loads(os.environ['P_SPEC'])
im = Image.open(path).convert('RGB')
W, H = im.size
out = {'width': W, 'height': H, 'mode': spec.get('mode', 'grid')}
mode = out['mode']
def quantize_counts(box, colors):
    try:
        q = box.quantize(colors=colors, method=Image.MEDIANCUT).convert('RGB')
        counts = q.getcolors(maxcolors=100000)
        if not counts:
            return []
        counts.sort(reverse=True)
        return counts
    except Exception:
        return []
if mode == 'points':
    px = im.load()
    out['points'] = [
        {'x': x, 'y': y, 'rgb': list(px[x, y]), 'hex': '#%02x%02x%02x' % px[x, y]}
        for x, y in spec.get('points', []) if 0 <= x < W and 0 <= y < H
    ]
elif mode == 'region':
    x, y, w, h = spec.get('region', [0, 0, W, H])
    box = im.crop((x, y, min(x + w, W), min(y + h, H)))
    st = ImageStat.Stat(box)
    total = box.size[0] * box.size[1]
    dom = [{'rgb': list(c), 'hex': '#%02x%02x%02x' % c, 'pct': round(n * 100.0 / total, 1)}
           for n, c in quantize_counts(box, 5)[:5]]
    out['region'] = {'x': x, 'y': y, 'w': box.size[0], 'h': box.size[1],
                     'mean_rgb': [round(v) for v in st.mean], 'extrema_rgb': st.extrema, 'dominant': dom}
elif mode == 'grid':
    n = int(spec.get('n', 8))
    small = im.resize((n, n))
    sp = small.load()
    out['grid'] = [['#%02x%02x%02x' % sp[gx, gy] for gx in range(n)] for gy in range(n)]
    g = im.convert('L').resize((n * 2, n))
    gp = g.load()
    chars = ' .:-=+*#%@'
    out['ascii'] = [''.join(chars[min(9, gp[gx, gy] * 10 // 256)] for gx in range(n * 2)) for gy in range(n)]
elif mode == 'edges':
    e = im.convert('L').filter(ImageFilter.FIND_EDGES)
    st = ImageStat.Stat(e)
    hist = e.histogram()
    out['edge_mean'] = round(st.mean[0], 1)
    out['edge_pixel_pct'] = round(sum(hist[64:]) * 100.0 / (W * H), 1)
elif mode == 'hist':
    total = W * H
    out['dominant'] = [{'rgb': list(c), 'hex': '#%02x%02x%02x' % c, 'pct': round(n * 100.0 / total, 1)}
                       for n, c in quantize_counts(im, 8)[:8]]
else:
    out['error'] = 'unknown mode: ' + mode
print(json.dumps(out))
'''
    try:
        r = subprocess.run(['python3', '-c', script], env=env, capture_output=True, text=True, timeout=60)
    except Exception as exc:
        print('像素检查执行失败: %s' % exc, file=sys.stderr)
        sys.exit(4)
    if r.returncode != 0:
        print('像素检查失败: %s' % r.stderr[-400:], file=sys.stderr)
        sys.exit(4)
    print(r.stdout.strip())


def cmd_media(args):
    try:
        r = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-print_format', 'json',
             '-show_format', '-show_streams', args.path],
            capture_output=True, text=True, timeout=30,
        )
    except FileNotFoundError:
        print('需要 ffmpeg/ffprobe。', file=sys.stderr)
        sys.exit(6)
    if r.returncode != 0:
        print('ffprobe 失败: %s' % r.stderr[-300:], file=sys.stderr)
        sys.exit(6)
    data = json.loads(r.stdout)
    fmt = data.get('format', {})
    streams = []
    for s in data.get('streams', []):
        streams.append({
            'type': s.get('codec_type'), 'codec': s.get('codec_name'),
            'width': s.get('width'), 'height': s.get('height'),
            'fps': s.get('avg_frame_rate') or s.get('r_frame_rate'),
            'sampleRate': s.get('sample_rate'), 'channels': s.get('channels'),
            'pixFmt': s.get('pix_fmt'), 'duration': s.get('duration'),
        })
    print(json.dumps({
        'path': args.path,
        'durationSeconds': fmt.get('duration'),
        'sizeBytes': fmt.get('size'),
        'bitRate': fmt.get('bit_rate'),
        'formatName': fmt.get('format_name'),
        'streams': streams,
    }, ensure_ascii=False))


def cmd_frames(args):
    times = [t.strip() for t in (args.times or '').split(',') if t.strip()]
    if not times:
        print('--times 不能为空，如 --times "0:05,10,1:30.5"', file=sys.stderr)
        sys.exit(2)
    if len(times) > 8:
        print('一次最多抽 8 帧。', file=sys.stderr)
        sys.exit(2)
    import re
    out_dir = re.sub(r'\.\w+$', '', args.path) + '__frames'
    os.makedirs(out_dir, exist_ok=True)
    frames = []
    for i, t in enumerate(times):
        safe = re.sub(r'[^0-9A-Za-z:.]', '_', t)
        out = os.path.join(out_dir, 'frame_%02d_%s.png' % (i + 1, safe))
        r = subprocess.run(
            ['ffmpeg', '-y', '-ss', t, '-i', args.path, '-frames:v', '1', '-q:v', '2', out],
            capture_output=True, text=True, timeout=120,
        )
        if r.returncode != 0:
            print('抽帧失败 (t=%s): %s' % (t, r.stderr[-300:]), file=sys.stderr)
            sys.exit(7)
        frames.append({'time': t, 'path': out})
    print(json.dumps({'dir': out_dir, 'frames': frames}, ensure_ascii=False))


def cmd_config(args):
    cfg = load_config()
    if not cfg:
        print('未找到配置缓存：%s' % CONFIG_PATH)
        sys.exit(2)
    shown = {k: v for k, v in cfg.items() if k != 'apiKey'}
    print(json.dumps(shown, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(prog='dsh-vision', add_help=False)
    sub = parser.add_subparsers(dest='command')
    p_desc = sub.add_parser('describe', add_help=False)
    p_desc.add_argument('paths', nargs='+')
    p_desc.add_argument('--question')
    p_desc.add_argument('--focus')
    p_desc.add_argument('--max-tokens', type=int)
    p_desc.add_argument('--protocol', choices=['openai-completions', 'anthropic-messages'])
    p_pix = sub.add_parser('pixel', add_help=False)
    p_pix.add_argument('path')
    p_pix.add_argument('--mode', choices=['grid', 'points', 'region', 'hist', 'edges'])
    p_pix.add_argument('--n', type=int)
    p_pix.add_argument('--points')
    p_pix.add_argument('--region')
    p_med = sub.add_parser('media', add_help=False)
    p_med.add_argument('path')
    p_frm = sub.add_parser('frames', add_help=False)
    p_frm.add_argument('path')
    p_frm.add_argument('--times')
    sub.add_parser('config', add_help=False)
    args = parser.parse_args()
    if args.command == 'describe':
        cmd_describe(args)
    elif args.command == 'pixel':
        cmd_pixel(args)
    elif args.command == 'media':
        cmd_media(args)
    elif args.command == 'frames':
        cmd_frames(args)
    elif args.command == 'config':
        cmd_config(args)
    else:
        print(USAGE)


if __name__ == '__main__':
    main()
`
  // ══ CLI_SRC_END ══（以上内嵌 CLI 由 sync-cli.js 自动同步；运行时优先读 cli/dsh-vision）
  // ── 状态 ───────────────────────────────────────────────
  let stickyOn = false                // 工具级钩子触发后，会话内持续注入用法
  let defaultSeesImages = false       // 默认模型是否原生支持图片（用于协议段注入判断）
  const capCache = {}                 // 'provider|model' → 是否原生支持图片

  const USAGE_SECTION = [
    '# 视觉桥 CLI（dsh-vision）——本会话已启用视觉能力',
    '用 bash 工具执行 ~/.dsh/bin/dsh-vision（不带参数可看完整用法）：',
    '· describe <图1> [图2 …] [--question "…"] [--focus "…"] ← 核心：让视觉模型看图。无 --question = 完整独立全景描述；有 --question = 围绕问题做五段式回答',
    '· pixel <图> --mode grid|points|region|hist|edges ← 读取像素级颜色/亮度数据',
    '· media <文件>（ffprobe 元数据） · frames <视频> --times "0:05,10"（抽帧后逐帧 describe）',
    '· 用户粘贴的截图会自动保存到系统临时目录并把路径注入上下文，直接用 describe 查看即可',
    '【指挥视觉模型的方法——明眼人协议】',
    '1. 第一轮不要提问，先要全景描述（物体/颜色/形状/位置/文字逐字/布局）；你的预设可能是错的，先拿描述再核对假设。',
    '2. 提问要具体可观测：数量、颜色名、九宫格方位+比例坐标、文字逐字转写；拒绝模糊的主观判断。',
    '3. 每次提问都要求：直接回答 + 实际所见 + 视觉证据 + 信心(0-10) + 补充；绝不接受只答「是/否/没有」。',
    '4. 对关键声明追问到证据层（在哪里看到、什么特征支撑）；对方说「不确定」就要求明说，禁止编造。',
    '5. 多图时要求逐张独立描述，对比结论由你推理。',
  ].join('\n')

  // ── 调试日志（保留最近 200 行） ────────────────────────
  async function debugLog(line) {
    try {
      if (fs === undefined) return
      const home = await readHome()
      await runCmd('mkdir -p ' + shq(home + '/.dsh/vision-bridge'), { timeoutMs: 10000 })
      const t = await fs.resolve(home + '/.dsh/vision-bridge/prestep.log')
      let prev = ''
      try { prev = await fs.readText(t) } catch (e) { prev = '' }
      const lines = (prev + String(line) + '\n').split('\n').filter(Boolean).slice(-200)
      await fs.writeText(t, lines.join('\n') + '\n')
    } catch (e) {}
  }

  // ── 核心：按 Agent 真实模型判断是否原生支持图片 ─────────
  async function agentSeesImages(agent) {
    if (llm === undefined) return false
    let provider
    let model
    if (agent && agent.options) {
      provider = agent.options.provider
      model = agent.options.model
    }
    if (!provider || !model) {
      try {
        const adm = agentDefaultModel
        const sel = adm ? adm.currentSelection() : null
        if (sel) {
          provider = sel.provider
          model = sel.model
        }
      } catch (e) {}
    }
    if (!provider || !model) return false
    const key = String(provider) + '|' + String(model)
    if (Object.prototype.hasOwnProperty.call(capCache, key)) return capCache[key]
    let sees = false
    try {
      const info = await llm.resolveModelInfo(String(provider), String(model))
      const input = (info && info.inputModalities) || []
      sees = input.indexOf('image') >= 0
    } catch (e) {
      sees = false
    }
    capCache[key] = sees
    return sees
  }

  async function refreshDefaultCapability() {
    try {
      const adm = agentDefaultModel
      if (adm === undefined) {
        defaultSeesImages = false
        return
      }
      const sel = adm.currentSelection()
      if (!sel || !sel.provider || !sel.model) {
        defaultSeesImages = false
        return
      }
      defaultSeesImages = await agentSeesImages(null)
      await debugLog('default model ' + String(sel.provider) + '/' + String(sel.model) + ' seesImages=' + String(defaultSeesImages))
    } catch (e) {
      await debugLog('capability refresh failed: ' + String((e && e.message) || e))
    }
  }

  // ── 配置缓存刷新（settings → cli.json） ────────────────
  async function refreshConfig() {
    if (settings === undefined || fs === undefined) return
    const home = await readHome()
    let section = {}
    try { section = settings.get('llm-pi-ai') || {} } catch (e) { return }
    const providers = section.providers || {}
    let chosen = null
    const routes = Object.keys(providers)
    for (let i = 0; i < routes.length && chosen === null; i++) {
      const route = routes[i]
      const profile = providers[route] || {}
      const models = profile.models || []
      for (let j = 0; j < models.length; j++) {
        const input = (models[j] && models[j].input) || []
        if (input.indexOf('image') >= 0) {
          chosen = { route: route, profile: profile, model: String(models[j].id) }
          break
        }
      }
    }
    if (chosen === null) {
      try { await runCmd('rm -f ' + shq(home + '/.dsh/vision-bridge/cli.json'), { timeoutMs: 10000 }) } catch (e) {}
      await debugLog('refresh: no image-capable provider found — cache removed')
      return
    }
    const profile = chosen.profile
    const baseURL = String(profile.baseURL || '')
    const api = String(profile.api || '')
    let protocol = api
    if (!protocol) {
      if (baseURL.indexOf('/api/plan') >= 0) protocol = 'anthropic-messages'
      else if (['anthropic', 'claude', 'amazon-bedrock', 'azure-anthropic'].indexOf(chosen.route) >= 0) protocol = 'anthropic-messages'
      else protocol = 'openai-completions'
    }
    let apiKey = ''
    const keyEnv = String(profile.apiKeyEnv || '')
    if (keyEnv && credentials !== undefined) {
      try {
        const hit = await credentials.resolve(keyEnv)
        if (hit && hit.value) apiKey = String(hit.value)
      } catch (e) {}
    }
    if (!apiKey && keyEnv) {
      try {
        const r = await runCmd('printenv ' + shq(keyEnv) + ' || true', { stdoutMaxBytes: 4096 })
        apiKey = (r.stdout.text || '').trim()
      } catch (e) {}
    }
    const cfg = {
      provider: chosen.route,
      displayName: String(profile.displayName || chosen.route),
      endpoint: baseURL,
      protocol: protocol,
      model: chosen.model,
      apiKey: apiKey,
    }
    try {
      await runCmd('mkdir -p ' + shq(home + '/.dsh/vision-bridge'), { timeoutMs: 10000 })
      const t = await fs.resolve(home + '/.dsh/vision-bridge/cli.json')
      await fs.writeText(t, JSON.stringify(cfg, null, 2))
      await runCmd('chmod 600 ' + shq(home + '/.dsh/vision-bridge/cli.json'), { timeoutMs: 10000 })
      await debugLog('refresh: cache written for ' + chosen.route + '/' + chosen.model + ' protocol=' + protocol)
    } catch (e) {
      await debugLog('refresh write failed: ' + String((e && e.message) || e))
    }
  }

  // ── CLI 安装 ───────────────────────────────────────────
  async function installCli() {
    if (fs === undefined) return
    try {
      const home = await readHome()
      await runCmd('mkdir -p ' + shq(home + '/.dsh/bin'), { timeoutMs: 10000 })
      const t = await fs.resolve(home + '/.dsh/bin/dsh-vision')
      // 优先安装项目内 cli/dsh-vision（唯一真源）；读不到时回退内嵌副本
      let src = CLI_SRC
      let origin = 'embedded'
      if (projectCliPath !== null) {
        try {
          const txt = await fs.readText(await fs.resolve(projectCliPath))
          if (typeof txt === 'string' && txt.indexOf('#!/usr/bin/env python3') >= 0 && txt.indexOf('dsh-vision') >= 0) {
            src = txt
            origin = 'project'
          }
        } catch (e) {
          await debugLog('project cli unreadable, fallback to embedded: ' + String((e && e.message) || e))
        }
      }
      await fs.writeText(t, src)
      await runCmd('chmod +x ' + shq(home + '/.dsh/bin/dsh-vision'), { timeoutMs: 10000 })
      await debugLog('cli installed to ' + home + '/.dsh/bin/dsh-vision (source: ' + origin + ')')
    } catch (e) {
      await debugLog('cli install failed: ' + String((e && e.message) || e))
    }
  }

  // ── 检测正则（工具级钩子用） ───────────────────────────
  const IMG_PATH = /\b[\w./~-]+\.(png|jpe?g|webp|gif|heic|bmp|avif|tiff?)\b/i
  const SHOT_CMD = /screencapture|screenshot|x11grab|avfoundation|gnome-screenshot|scrot|maim/i
  const IMG_PATH_GLOBAL = /[\w./~-]+\.(png|jpe?g|webp|gif|heic|bmp)\b/gi

  function collectImagePaths(command, resultText) {
    const seen = {}
    const source = command + '\n' + (resultText || '')
    let m
    IMG_PATH_GLOBAL.lastIndex = 0
    while ((m = IMG_PATH_GLOBAL.exec(source)) !== null) {
      const p = m[0]
      if (!seen[p]) seen[p] = true
      if (Object.keys(seen).length >= 2) break
    }
    return Object.keys(seen)
  }

  // ── 钩子 1：tools/pre-execute（PreToolUse：read/read_image 读图拦截） ──
  ctx.on('tools/pre-execute', async function (exec, next) {
    try {
      if (exec && (exec.name === 'read' || exec.name === 'read_image')) {
        const args = exec.arguments || {}
        const p = String(args.file_path || '')
        if (IMG_PATH.test(p)) {
          const sees = await agentSeesImages(exec.agent)
          if (!sees) {
            stickyOn = true
            await debugLog('PRE-EXECUTE denied ' + exec.name + ' on image (model cannot see images): ' + p)
            return {
              kind: 'deny',
              reason: '目标 ' + p + ' 是图片文件，而当前会话的模型不支持图片输入，read 无法读取图片内容。' +
                '你无法直接看到这张图，请通过视觉桥 CLI 指挥视觉模型代看，bash 执行：\n' +
                '~/.dsh/bin/dsh-vision describe ' + p + ' [--question "你的问题"] [--focus "重点"]\n\n' +
                '【指挥视觉模型的方法——明眼人协议】\n' +
                '1. 第一轮不要提问，先要全景：要求视觉模型独立描述图中实际有什么（物体、颜色、形状、位置、文字逐字转写、布局）。你的预设可能是错的（你以为的水桶也许是消防栓），先拿描述，再用描述核对你的假设。\n' +
                '2. 提问要具体可观测：问数量、颜色名、九宫格方位加比例坐标、文字逐字转写；不要问模糊的主观判断。\n' +
                '3. 每次提问都要求结构化回答：①直接回答你的问题 ②实际所见 ③视觉证据 ④信心(0-10) ⑤补充信息。绝不接受只答「是/否/没有」。\n' +
                '4. 追问到证据层：对它的每个关键声明，追问「在哪里看到、什么颜色/形状/文字支撑」；它说「不确定」就要求明说，禁止编造。\n' +
                '5. 多张图时要求逐张独立描述（图1、图2…），对比结论由你自己推理，别交给它。',
            }
          }
          await debugLog('PRE-EXECUTE passed ' + exec.name + ' (model sees images natively)')
        }
      }
    } catch (e) {
      await debugLog('pre-execute error: ' + String((e && e.message) || e))
    }
    return next()
  })

  // ── 钩子 2：tools/post-execute（PostToolUse：bash 图片检测 + 截图自动描述） ──
  ctx.on('tools/post-execute', async function (exec, result, next) {
    try {
      if (!exec || exec.name !== 'bash') return next()
      const sees = await agentSeesImages(exec.agent)
      if (sees) return next()
      const args = exec.arguments || {}
      const cmd = String(args.command || '')
      const resultText = ((result && result.content) || []).map(function (b) {
        return (b && b.type === 'text' && typeof b.text === 'string') ? b.text : ''
      }).join('\n')
      const paths = collectImagePaths(cmd, resultText)
      if (paths.length === 0) return next()
      const existing = []
      for (let i = 0; i < paths.length; i++) {
        const wait = 'i=0; while [ $i -lt 12 ]; do test -f ' + shq(paths[i]) + ' && exit 0; i=$((i+1)); sleep 0.25; done; exit 1'
        const r = await runCmd(wait, { timeoutMs: 15000, stdoutMaxBytes: 4096 })
        if (r.exitCode === 0) existing.push(paths[i])
      }
      if (existing.length === 0) return next()
      stickyOn = true
      const isShot = SHOT_CMD.test(cmd)
      let extra = '【视觉桥】检测到图片 ' + existing.join('、') + '。查看：~/.dsh/bin/dsh-vision describe <路径>（多图可一次传入）。'
      if (isShot) {
        const home = await readHome()
        const bin = home + '/.dsh/bin/dsh-vision'
        const d = await runCmd(bin + ' describe ' + existing.slice(0, 2).map(shq).join(' ') + ' --max-tokens 1200', { timeoutMs: 200000, stdoutMaxBytes: 524288 })
        if (d.exitCode === 0 && (d.stdout.text || '').trim()) {
          extra = extra + '\n\n【视觉桥自动描述】\n' + d.stdout.text.trim()
        }
      }
      await debugLog('POST-EXECUTE enriched bash: shot=' + String(isShot) + ' paths=' + existing.join(','))
      const base = await next()
      if (!base || base.kind !== 'accept') return base
      if (base.value !== undefined) return base
      const content = ((base.content !== undefined ? base.content : (result && result.content) || []).slice())
      content.push({ type: 'text', text: extra })
      const out = { kind: 'accept', content: content }
      if (base.additionalContexts !== undefined) out.additionalContexts = base.additionalContexts
      return out
    } catch (e) {
      await debugLog('post-execute error: ' + String((e && e.message) || e))
      return next()
    }
  })

  // ── 钩子 3：agent/pre-step（粘贴图片 block → 落地文件 + 路径注入） ──
  // 纯文本模型会话中，用户粘贴的截图以 image block 进入消息；
  // 适配器对不支持图片的模型会直接报 UNSUPPORTED_CONTENT。
  // 本钩子不调用视觉模型：只把图片字节落地成文件，再把 block 替换成
  // 纯文件路径文本（不附加任何说明），让模型按原有流程自己用 dsh-vision 看。
  const EXT_BY_MEDIA = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

  function toBase64(bytes) {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
    }
    let bin = ''
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
    }
    return btoa(bin)
  }

  let cachedPasteDir = null
  async function pasteDir() {
    if (cachedPasteDir !== null) return cachedPasteDir
    const r = await runCmd('printenv TMPDIR || true', { timeoutMs: 10000, stdoutMaxBytes: 4096 })
    const tmp = (r.stdout.text || '').trim()
    cachedPasteDir = (tmp || '/tmp').replace(/\/+$/, '') + '/dsh-vision-paste'
    return cachedPasteDir
  }

  async function savePastedImage(ref) {
    const dir = await pasteDir()
    const id = String((ref && ref.attachmentId) || 'img')
    const ext = EXT_BY_MEDIA[String((ref && ref.mediaType) || '')] || 'png'
    const imgPath = dir + '/' + id + '.' + ext
    const sizeCmd = 'test -f ' + shq(imgPath) + ' && wc -c < ' + shq(imgPath) + ' | tr -d " " || echo 0'
    const sizeR = await runCmd(sizeCmd, { timeoutMs: 10000, stdoutMaxBytes: 4096 })
    if (String(parseInt(sizeR.stdout.text, 10)) === String(ref.bytes)) return imgPath
    if (attachments === undefined) return null
    const stored = await attachments.readImage(ref)
    await runCmd('mkdir -p ' + shq(dir), { timeoutMs: 10000 })
    const b64Path = dir + '/' + id + '.b64'
    await fs.writeText(await fs.resolve(b64Path), toBase64(stored.data))
    const prog = 'import base64,sys;open(sys.argv[1],"wb").write(base64.b64decode(open(sys.argv[2],"rb").read()))'
    const r = await runCmd('python3 -c ' + shq(prog) + ' ' + shq(imgPath) + ' ' + shq(b64Path), { timeoutMs: 60000, stdoutMaxBytes: 4096 })
    await runCmd('rm -f ' + shq(b64Path), { timeoutMs: 10000 })
    return r.exitCode === 0 ? imgPath : null
  }

  // image block → 替换文本：只保留落盘路径，不附加任何说明
  function pastedImageText(ref, path) {
    if (path === null || path === undefined) {
      return '（粘贴的图片未能保存到本地，请让用户把截图另存为文件后再试）'
    }
    return path
  }

  ctx.on('agent/pre-step', async function (payload, next) {
    const decision = await next()
    if (!decision || decision.kind !== 'enter') return decision
    try {
      const sees = await agentSeesImages(payload.agent)
      if (sees) return decision
      const messages = decision.messages || []
      let hit = false
      const out = []
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]
        const blocks = (msg && Array.isArray(msg.content)) ? msg.content : null
        if (blocks === null || !blocks.some(function (b) { return b && b.type === 'image' })) {
          out.push(msg)
          continue
        }
        hit = true
        const newBlocks = []
        for (let j = 0; j < blocks.length; j++) {
          const b = blocks[j]
          if (b && b.type === 'image') {
            let path = null
            try {
              path = await savePastedImage(b.attachment)
            } catch (e) {
              await debugLog('PRE-STEP save pasted image failed: ' + String((e && e.message) || e))
            }
            await debugLog('PRE-STEP pasted image → ' + String(path))
            newBlocks.push({ type: 'text', text: pastedImageText(b.attachment, path) })
          } else {
            newBlocks.push(b)
          }
        }
        const copy = {}
        for (const k of Object.keys(msg)) copy[k] = msg[k]
        copy.content = newBlocks
        out.push(copy)
      }
      if (!hit) return decision
      stickyOn = true
      return { kind: 'enter', messages: out }
    } catch (e) {
      await debugLog('agent/pre-step error: ' + String((e && e.message) || e))
      return decision
    }
  })

  // ── 按步注入：协议段（文本模型触发后开启；视觉模型永不注入） ──
  if (systemPrompt !== undefined) {
    systemPrompt.section({
      name: 'vision:dsh-vision-cli',
      order: 135,
      text: function () {
        return (stickyOn && !defaultSeesImages) ? USAGE_SECTION : ''
      },
    })
  }

  // ── 配置/拓扑变化 → 清缓存 + 刷新 ─────────────────────
  ctx.on('settings/updated', function () {
    for (const k of Object.keys(capCache)) delete capCache[k]
    refreshConfig()
    refreshDefaultCapability()
  })
  ctx.on('credentials/updated', function () {
    refreshConfig()
  })
  ctx.on('llm/adapters-updated', function () {
    for (const k of Object.keys(capCache)) delete capCache[k]
    refreshDefaultCapability()
  })

  // ── 启动：安装 CLI + 生成缓存 + 能力检测 ──────────────
  installCli().then(function () {
    return refreshConfig()
  }).then(function () {
    return refreshDefaultCapability()
  })
}
