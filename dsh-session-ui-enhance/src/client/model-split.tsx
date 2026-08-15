/**
 * dsh-session-ui-enhance — 输入区模型选择与推理等级拆分。
 *
 * 产品官方 ui-model-selection 在 composer 的 `conversation.input.model`
 * seat 上渲染一个触发器:按钮把「模型 · 推理等级」并成一段文本,点开后
 * 先进入「模型 / 推理等级」二级菜单再各自级联(内部级联)。本模块以
 * `priority: -1` 注册同一个 single slot 使其成为渲染赢家(shadowing,
 * 官方条目仍在 ledger 上,插件卸载即自动还原),改为在用户输入区直接放
 * 两个并列触发器:模型一个按钮、推理等级一个按钮,各自直接弹出自己的
 * 列表(直接级联),不再经过中间层。
 *
 * 数据与提交完全复用官方的 `ctx.modelDirectories` / `ctx.sessions` 服务
 * 和每会话共享的 ModelDirectory store:与 `/model` popup 选择、路由可用
 * 性 composer block 保持同源,本模块不另起一套选择状态。因此这里只做
 * 值导入零官方包、类型导入(构建时被擦除)与 Cordis 服务协作,符合 client
 * purity 门禁。
 *
 * 纯派生逻辑(当前模型查找、effort 标签、effort 选项)导出为无 DOM 纯
 * 函数,由 test/model-split.test.js 守护。
 *
 * @module dsh-session-ui-enhance/client/model-split
 */

import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only:拉入 ui-conversation 的 SlotMap merge(conversation.input.model)。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import React from 'react'
import styles from './model-split.module.css'
import { configNow, subscribeConfig } from './live-config'
import {
  COPY,
  currentModelOf,
  effectiveEffortOf,
  effortChoicesOf,
  effortLabelOf,
  splitLocale,
  type ModelCatalogModel,
  type ModelProviderGroup,
} from './model-split-logic'

// ── 纯视图小件──────────────────────────────────────────────────────────────────

function cx(...parts: Array<string | null | undefined | false>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' ')
}

function ChevronGlyph({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg
      className={cx(styles.chevron, open && styles.chevronOpen)}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      aria-hidden="true"
      focusable="false"
      fill="none"
    >
      <path d="M3.5 5.5 7 9l3.5-3.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CheckGlyph(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none">
      <path d="m3.5 8.5 3 3L12.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── seat 组件 ─────────────────────────────────────────────────────────────────

/** 本 seat 通过 slot inject 获得的数据/动作面(与官方 ModelSelectInjected 同构)。 */
interface SplitSeatInjected {
  available: boolean
  directory: SnapshotStore<ModelDirectoryState>
  load: () => void
  select: (selection: ModelSelection) => Promise<boolean>
}

type SplitSeatProps = PropsRuntime<'conversation.input.model'> & SplitSeatInjected

type SplitPane = 'model' | 'effort'

/**
 * 输入区双按钮模型 seat:模型与推理等级各自直接级联弹出列表。
 * @param props - owner locked + framework session kit + 本插件的注入面。
 * @returns 双按钮(无 reasoning 元数据时只显示模型按钮)。
 */
export function SplitModelEffortSeat({ locked, available, directory, load, select }: SplitSeatProps): React.ReactElement | null {
  const subscribe = React.useCallback((notify: () => void) => directory.subscribe(notify), [directory])
  const getSnapshot = React.useCallback(() => directory.getSnapshot(), [directory])
  const state = React.useSyncExternalStore(subscribe, getSnapshot)

  const [pane, setPane] = React.useState<SplitPane | null>(null)
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const modelTriggerRef = React.useRef<HTMLButtonElement | null>(null)
  const effortTriggerRef = React.useRef<HTMLButtonElement | null>(null)
  const aliveRef = React.useRef(true)
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([])
  const menuId = React.useId()

  React.useEffect(() => {
    if (available) load()
  }, [available, load])

  React.useEffect(() => {
    if (pane === null) return
    const onMouseDown = (event: MouseEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return
      setPane(null)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [pane])

  React.useEffect(() => () => {
    aliveRef.current = false
  }, [])

  if (!available) return null

  const lang = splitLocale(document.documentElement.lang)
  const copy = COPY[lang]
  const currentModel = currentModelOf(state)
  const reasoning = currentModel?.reasoning
  const effectiveEffort = effectiveEffortOf(state, reasoning)
  const modelLabel = currentModel?.name ?? copy.selectModel
  const effortLabel = effortLabelOf(effectiveEffort, reasoning, lang)
  const efforts = effortChoicesOf(reasoning, lang)
  const busy = state.status === 'selecting'

  const close = (restoreFocus: boolean) => {
    setPane(null)
    if (!restoreFocus) return
    queueMicrotask(() => {
      const ref = pane === 'effort' ? effortTriggerRef : modelTriggerRef
      ref.current?.focus()
    })
  }

  const reload = () => {
    load()
  }

  const show = (next: SplitPane) => {
    setPane(next)
    load()
  }

  const moveFocus = (offset: number) => {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null)
    if (items.length === 0) return
    const active = items.findIndex(item => item === document.activeElement)
    const next = (Math.max(active, 0) + offset + items.length) % items.length
    items[next]?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (pane === null) return
    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  const onBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
    setPane(null)
  }

  const chooseModel = (group: ModelProviderGroup, model: ModelCatalogModel) => {
    const current = state.current
    if (current !== null && current.provider === group.id && current.model === model.id) {
      close(true)
      return
    }
    void select({ provider: group.id, model: model.id }).then((accepted) => {
      if (accepted && aliveRef.current) close(true)
    })
  }

  const chooseEffort = (effort: string | undefined) => {
    const current = state.current
    if (current === null) return
    if (effectiveEffort === effort) {
      close(true)
      return
    }
    const selection: ModelSelection = effort === undefined
      ? { provider: current.provider, model: current.model }
      : { provider: current.provider, model: current.model, reasoningEffort: effort }
    void select(selection).then((accepted) => {
      if (accepted && aliveRef.current) close(true)
    })
  }

  itemRefs.current = []
  let itemIndex = 0
  const itemRef = () => {
    const at = itemIndex++
    return (node: HTMLButtonElement | null) => {
      itemRefs.current[at] = node
    }
  }

  const errorBlock = state.error === null ? null : (
    <div className={styles.error}>
      <span>{copy.error(state.error)}</span>
      <button type="button" className={styles.retry} onClick={reload}>{copy.retry}</button>
    </div>
  )
  const warningBlocks = state.failures.map(failure => (
    <div key={failure.id} className={styles.warning}>
      <span>{copy.warning(failure.name, failure.message)}</span>
      <button type="button" className={styles.retry} onClick={reload}>{copy.retry}</button>
    </div>
  ))
  const loadingBlock = state.status === 'loading'
    ? <div className={styles.status}>{copy.loading}</div>
    : null

  return (
    <div
      ref={rootRef}
      className={styles.root}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <div className={styles.part}>
        <button
          ref={modelTriggerRef}
          type="button"
          className={styles.trigger}
          aria-label={currentModel === undefined ? copy.selectModel : copy.selectModelAria(modelLabel)}
          aria-haspopup="menu"
          aria-expanded={pane === 'model'}
          aria-controls={pane === 'model' ? `${menuId}-model-menu` : undefined}
          title={modelLabel}
          disabled={locked}
          onClick={() => {
            if (pane === 'model') close(true)
            else show('model')
          }}
        >
          <span className={styles.triggerLabel}>{modelLabel}</span>
          <ChevronGlyph open={pane === 'model'} />
        </button>
        {pane === 'model' && (
          <div id={`${menuId}-model-menu`} role="menu" aria-label={copy.modelMenu} aria-busy={busy} className={styles.menu}>
            {errorBlock}
            {warningBlocks}
            {loadingBlock}
            <div className={styles.groups}>
              {state.groups.map(group => (
                <section key={group.id} role="group" aria-labelledby={`${menuId}-${group.id}`} className={styles.group}>
                  <div id={`${menuId}-${group.id}`} className={styles.groupTitle}>{group.name}</div>
                  {group.models.map((model) => {
                    const selected = state.current !== null && state.current.provider === group.id && state.current.model === model.id
                    return (
                      <button
                        key={model.id}
                        ref={itemRef()}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        className={cx(styles.option, selected && styles.selected)}
                        title={model.name}
                        disabled={busy}
                        onClick={() => chooseModel(group, model)}
                      >
                        <span className={styles.optionCopy}>
                          <span className={styles.optionName}>{model.name}</span>
                          {model.description !== undefined && (
                            <span className={styles.optionDescription}>{model.description}</span>
                          )}
                        </span>
                        <span className={styles.check}>{selected ? <CheckGlyph /> : null}</span>
                      </button>
                    )
                  })}
                </section>
              ))}
            </div>
            {state.status === 'ready' && state.groups.flatMap(group => group.models).length === 0 && (
              <div className={styles.empty}>{copy.emptyModels}</div>
            )}
          </div>
        )}
      </div>
      {reasoning !== undefined && effortLabel !== undefined && (
        <div className={styles.part}>
          <button
            ref={effortTriggerRef}
            type="button"
            className={cx(styles.trigger, styles.effortTrigger)}
            aria-label={copy.selectEffortAria(effortLabel)}
            aria-haspopup="menu"
            aria-expanded={pane === 'effort'}
            aria-controls={pane === 'effort' ? `${menuId}-effort-menu` : undefined}
            title={effortLabel}
            disabled={locked}
            onClick={() => {
              if (pane === 'effort') close(true)
              else show('effort')
            }}
          >
            <span className={styles.triggerLabel}>{effortLabel}</span>
            <ChevronGlyph open={pane === 'effort'} />
          </button>
          {pane === 'effort' && (
            <div id={`${menuId}-effort-menu`} role="menu" aria-label={copy.effortMenu} aria-busy={busy} className={styles.menu}>
              {errorBlock}
              {warningBlocks}
              {loadingBlock}
              {efforts.length === 0
                ? <div className={styles.empty}>{copy.emptyEfforts}</div>
                : efforts.map(level => {
                  const selected = effectiveEffort === level.effort
                  return (
                    <button
                      key={level.key}
                      ref={itemRef()}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      className={cx(styles.option, selected && styles.selected)}
                      disabled={busy}
                      onClick={() => chooseEffort(level.effort)}
                    >
                      <span className={styles.optionCopy}>
                        <span className={styles.optionName}>{level.label}</span>
                        {level.description !== undefined && (
                          <span className={styles.optionDescription}>{level.description}</span>
                        )}
                      </span>
                      <span className={styles.check}>{selected ? <CheckGlyph /> : null}</span>
                    </button>
                  )
                })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── 注册 ───────────────────────────────────────────────────────────────────────

/**
 * Client effect:等待官方模型目录服务就绪后,以 -1 priority 贡献同一
 * `conversation.input.model` single slot(lowest renders,官方条目保留在
 * ledger 上;本插件卸载即恢复官方触发器)。配置项
 * `modelSplit.enabled: false` 时整体不注册。服务缺席时不注册,官方
 * ui-model-selection 的 seat 原样保留。
 */
export function applyModelSplit(ctx: ClientContext): void {
  // 可选依赖:modelDirectories 由官方 ui-model-selection 提供;sessions
  // 用于 subagent 地址判定。缺任一服务时该 child fiber 保持 pending,
  // 绝不抢跑官方 seat。
  ctx.inject(['modelDirectories', 'sessions'], (scope) => {
    const models = scope.modelDirectories
    const sessions = scope.sessions
    let stop: (() => void) | null = null
    let disposed = false

    const sync = () => {
      if (disposed) return
      const enabled = configNow().modelSplit.enabled
      if (enabled && stop === null) {
        stop = scope.slots.inject('conversation.input.model', () => {
          const dispose = scope.slots.register({
            name: 'conversation.input.model',
            priority: -1,
            registrant: 'dsh-session-ui-enhance/model-split',
            inject: (sessionId) => {
              const directory = models.directoryFor(sessionId)
              const available = sessions.subagentAddress(sessionId) === undefined
              return {
                available,
                directory: directory.store,
                load: () => {
                  if (available) void directory.load().catch(() => {})
                },
                select: selection => available
                  ? directory.select(selection).then(() => true, () => false)
                  : Promise.resolve(false),
              }
            },
          }, SplitModelEffortSeat)
          return () => dispose()
        })
      } else if (!enabled && stop !== null) {
        stop()
        stop = null
      }
    }

    sync()
    const unsubscribe = subscribeConfig(sync)
    scope.effect(() => () => {
      disposed = true
      unsubscribe()
      stop?.()
      stop = null
    }, 'dsh-session-ui-enhance: model-split seat')
  })
}
