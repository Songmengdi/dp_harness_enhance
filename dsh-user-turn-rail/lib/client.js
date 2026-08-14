window.__ModuleLoader__.load({
  id: "dsh-user-turn-rail",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    let React = require("react");
    if (React !== null && typeof React === "object" && typeof React.createElement !== "function" && React.default && typeof React.default.createElement === "function") {
      React = React.default;
    }

    const RAIL_CSS = `
.dyn-utr-rail {
  position: fixed;
  top: 50%;
  transform: translateY(-50%);
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: auto;
}
.dyn-utr-row {
  position: relative;
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 6px 12px 6px 2px;
  margin: -6px 0;
}
.dyn-utr-line {
  height: 3px;
  border-radius: 999px;
  transition: width 0.24s cubic-bezier(0.22, 0.8, 0.36, 1), background-color 0.2s ease, opacity 0.2s ease;
}
.dyn-utr-card {
  position: absolute;
  left: calc(100% + 14px);
  top: 50%;
  transform: translateY(-50%) translateX(-5px) scale(0.97);
  transform-origin: left center;
  opacity: 0;
  pointer-events: none;
  min-width: 244px;
  max-width: 324px;
  background: var(--dsw-alias-bg-overlay, #202123);
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
  border-radius: 12px;
  padding: 12px 14px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.05);
  transition: opacity 0.16s ease, transform 0.16s ease;
}
.dyn-utr-row:hover .dyn-utr-card {
  opacity: 1;
  transform: translateY(-50%) translateX(0) scale(1);
}
.dyn-utr-card::before {
  content: '';
  position: absolute;
  left: -5px;
  top: 50%;
  transform: translateY(-50%) rotate(45deg);
  width: 9px;
  height: 9px;
  background: var(--dsw-alias-bg-overlay, #202123);
  border-left: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
}
.dyn-utr-card-head {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 8px;
}
.dyn-utr-badge {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.4px;
  color: var(--dsw-alias-label-primary, #eeeeee);
  background: rgba(128, 128, 128, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 999px;
  padding: 2px 9px;
}
.dyn-utr-card-head-sub {
  font-size: 11px;
  letter-spacing: 0.3px;
  color: var(--dsw-alias-label-secondary, #999999);
}
.dyn-utr-card-divider {
  height: 1px;
  margin-bottom: 8px;
  background: linear-gradient(90deg, var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.12)), rgba(255, 255, 255, 0));
}
.dyn-utr-card-text {
  font-size: 12.5px;
  line-height: 1.62;
  color: var(--dsw-alias-label-primary, #eeeeee);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 128px;
  overflow: hidden;
}
`;

    /**
     * Content width architecture:
     * 1) --dsh-chat-content-width: fixed pixel tiers by viewport breakpoint
     *    (no percentages — the two consumers, chat column and composer card,
     *    resolve percentages against different containing blocks and would
     *    misalign).
     * 2) Breathing room comes from --dsh-composer-side-clearance: the chat
     *    flow gets clearance + 16px per side, the composer gets clearance per
     *    side — the shipped alignment relation is preserved. When the middle
     *    column narrows, content shrinks automatically and the side clearance
     *    stays constant.
     */
    const WIDTH_CSS = `
[data-phase] {
  --dsh-chat-content-width: 748px;
}
[data-phase="active"] {
  --dsh-composer-side-clearance: 65px;
}
@media (min-width: 1920px) { [data-phase] { --dsh-chat-content-width: 1080px; } }
@media (min-width: 2304px) { [data-phase] { --dsh-chat-content-width: 1240px; } }
@media (min-width: 2688px) { [data-phase] { --dsh-chat-content-width: 1420px; } }
@media (min-width: 3072px) { [data-phase] { --dsh-chat-content-width: 1600px; } }
@media (min-width: 3456px) { [data-phase] { --dsh-chat-content-width: 1800px; } }
`;

    function previewText(content) {
      let text = '';
      if (Array.isArray(content)) {
        text = content
          .filter((block) => block !== null && block !== undefined && block.type === 'text')
          .map((block) => String(block.text === undefined || block.text === null ? '' : block.text))
          .join('\n');
      }
      const lines = text.split('\n').filter((line) => line.trim().length > 0);
      if (lines.length === 0) return '（无文本内容）';
      let out = lines.slice(0, 4).join('\n');
      if (lines.length > 4) out += '\n…';
      if (out.length > 260) out = out.slice(0, 260) + '…';
      return out;
    }

    const BASE_WIDTH = 13;
    const PEAK_WIDTH = 26;
    const RAMP_STEP = 3;
    const MIN_WIDTH = 13;

    function UserTurnRail(props) {
      const useSession = props.useSession;
      if (typeof useSession !== 'function') return null;
      const sessionId = props.sessionId;
      const [left, setLeft] = React.useState(null);
      const [hovered, setHovered] = React.useState(-1);
      const [selected, setSelected] = React.useState(-1);

      const nodes = useSession((snapshot) => snapshot.nodes);
      const turns = [];
      if (Array.isArray(nodes)) {
        for (const node of nodes) {
          if (node !== null && node !== undefined && node.kind === 'user') {
            turns.push({ seq: node.seq, text: previewText(node.content) });
          }
        }
      }

      React.useEffect(() => {
        if (turns.length === 0) return;
        let alive = true;
        let observer = null;
        let raf = 0;
        const measure = () => {
          if (!alive) return;
          const el = document.querySelector('[data-conversation-scroll]');
          if (el === null) {
            raf = window.requestAnimationFrame(measure);
            return;
          }
          setLeft(el.getBoundingClientRect().left);
          if (observer === null && typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver(measure);
            observer.observe(el);
          }
        };
        measure();
        window.addEventListener('resize', measure);
        return () => {
          alive = false;
          if (raf !== 0) window.cancelAnimationFrame(raf);
          if (observer !== null) observer.disconnect();
          window.removeEventListener('resize', measure);
        };
      }, [sessionId, turns.length]);

      if (turns.length === 0 || left === null) return null;

      const activeIndex = selected >= 0 && selected < turns.length ? selected : turns.length - 1;

      const goTo = (index) => {
        setSelected(index);
        const rows = document.querySelectorAll('[data-chat-flow-kind="user"]');
        const row = rows[index];
        if (row === undefined || row === null) return;
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };

      const rows = turns.map((turn, index) => {
        const bright = index === activeIndex || index === hovered;
        const dist = hovered < 0 ? -1 : Math.abs(index - hovered);
        const width = hovered < 0 ? BASE_WIDTH : Math.max(MIN_WIDTH, PEAK_WIDTH - dist * RAMP_STEP);
        let opacity = bright ? 1 : 0.5;
        if (hovered >= 0 && !bright) opacity = Math.max(0.26, 0.5 - dist * 0.06);
        const line = React.createElement('div', {
          className: 'dyn-utr-line',
          style: {
            width: width + 'px',
            backgroundColor: bright ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
            opacity,
          },
        });
        const card = React.createElement(
          'div',
          { className: 'dyn-utr-card' },
          React.createElement(
            'div',
            { className: 'dyn-utr-card-head' },
            React.createElement('div', { className: 'dyn-utr-badge' }, '第 ' + (index + 1) + ' 轮'),
            React.createElement('div', { className: 'dyn-utr-card-head-sub' }, '用户输入预览'),
          ),
          React.createElement('div', { className: 'dyn-utr-card-divider' }),
          React.createElement('div', { className: 'dyn-utr-card-text' }, turn.text),
        );
        return React.createElement(
          'div',
          {
            key: String(turn.seq),
            className: 'dyn-utr-row',
            onMouseEnter: () => setHovered(index),
            onMouseLeave: () => setHovered(-1),
            onClick: () => goTo(index),
          },
          line,
          card,
        );
      });

      return React.createElement(
        'div',
        { className: 'dyn-utr-rail', style: { left: Math.round(left + 10) + 'px' } },
        ...rows,
      );
    }

    exports.apply = function apply(ctx) {
      const slots = ctx.get('slots');
      if (slots === undefined) return;
      const styleTag = document.createElement('style');
      styleTag.setAttribute('data-plugin', 'dsh-user-turn-rail');
      styleTag.textContent = RAIL_CSS + '\n' + WIDTH_CSS;
      document.head.appendChild(styleTag);
      ctx.effect(() => () => {
        if (styleTag.parentNode !== null) styleTag.parentNode.removeChild(styleTag);
      });
      slots.inject('conversation.session.header.utilities', () => slots.register(
        { name: 'conversation.session.header.utilities', id: 'dsh-user-turn-rail', label: '用户轮次定位' },
        (props) => React.createElement(UserTurnRail, props),
      ));
    };
    exports.inject = ['slots'];

    return module.exports;
  },
});
