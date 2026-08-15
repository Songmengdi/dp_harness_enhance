/**
 * dsh-session-ui-enhance — 模型/推理等级拆分 seat 的纯派生逻辑。
 *
 * 从 model-split.tsx(React + CSS Modules)拆出,让 node:test 可以直接
 * import 编译产物而不经过浏览器 CSS import。只做无 DOM 派生:当前模型
 * 回显、effective effort、菜单标签/选项。
 *
 * @module dsh-session-ui-enhance/client/model-split-logic
 */

import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'

// ModelCatalogModel / ModelReasoning 未从 api-remotes 门面再导出,这里从
// ModelDirectoryState 的结构位推导(与官方 ModelSelect 消费的是同一形状)。
export type ModelCatalogModel = NonNullable<ModelDirectoryState['groups'][number]['models'][number]>
export type ModelReasoning = NonNullable<ModelCatalogModel['reasoning']>
export type ModelProviderGroup = ModelDirectoryState['groups'][number]

export type SplitLocale = 'zh' | 'en'

/** 按 <html lang> 判定 UI locale,未知值以 zh 兜底。 */
export function splitLocale(htmlLang: string | null | undefined): SplitLocale {
  return htmlLang !== null && htmlLang !== undefined && htmlLang.toLowerCase().startsWith('en') ? 'en' : 'zh'
}

/** 推理等级选项:与官方 ModelSelect 同构,provider 默认值只在无 defaultEffort 时出现。 */
export interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
  description?: string
}

/** 一组直接级联按钮所需的全部文案。 */
export interface SplitCopy {
  selectModel: string
  selectModelAria: (model: string) => string
  selectEffortAria: (effort: string) => string
  modelMenu: string
  effortMenu: string
  defaultEffort: string
  loading: string
  error: (message: string) => string
  warning: (name: string, message: string) => string
  retry: string
  emptyModels: string
  emptyEfforts: string
}

export const COPY: Record<SplitLocale, SplitCopy> = {
  zh: {
    selectModel: '选择模型',
    selectModelAria: model => `选择模型,当前 ${model}`,
    selectEffortAria: effort => `选择推理等级,当前 ${effort}`,
    modelMenu: '模型',
    effortMenu: '推理等级',
    defaultEffort: '默认',
    loading: '正在刷新模型列表…',
    error: message => `模型操作失败:${message}`,
    warning: (name, message) => `${name} 加载失败:${message}`,
    retry: '重新加载',
    emptyModels: '没有可用的模型。',
    emptyEfforts: '当前模型未提供推理等级。',
  },
  en: {
    selectModel: 'Select model',
    selectModelAria: model => `Select model, current ${model}`,
    selectEffortAria: effort => `Select reasoning effort, current ${effort}`,
    modelMenu: 'Model',
    effortMenu: 'Reasoning effort',
    defaultEffort: 'Default',
    loading: 'Refreshing model list…',
    error: message => `Model operation failed: ${message}`,
    warning: (name, message) => `${name} failed to load: ${message}`,
    retry: 'Reload',
    emptyModels: 'No models available.',
    emptyEfforts: 'This model provides no reasoning effort levels.',
  },
}

/** 目录中找到 host 当前选择的发布模型(缺席即 undefined,不回显陈旧行)。 */
export function currentModelOf(state: ModelDirectoryState): ModelCatalogModel | undefined {
  const current = state.current
  if (current === null) return undefined
  for (const group of state.groups) {
    for (const model of group.models) {
      if (model.id === current.model && group.id === current.provider) return model
    }
  }
  return undefined
}

/** host 报告的选择生效 effort:显式选择优先,否则用模型发布的 defaultEffort。 */
export function effectiveEffortOf(state: ModelDirectoryState, reasoning: ModelReasoning | undefined): string | undefined {
  return state.current?.reasoningEffort ?? reasoning?.defaultEffort
}

/** 当前 effort 的展示名;无 reasoning 元数据时返回 undefined(不显示按钮)。 */
export function effortLabelOf(effort: string | undefined, reasoning: ModelReasoning | undefined, locale: SplitLocale): string | undefined {
  if (reasoning === undefined) return undefined
  const copy = COPY[locale]
  if (effort === undefined) return copy.defaultEffort
  return reasoning.efforts.find(level => level.id === effort)?.name ?? effort
}

/** 推理等级菜单选项:provider 默认项按官方规则只在无 defaultEffort 时出现。 */
export function effortChoicesOf(reasoning: ModelReasoning | undefined, locale: SplitLocale): EffortChoice[] {
  if (reasoning === undefined) return []
  const copy = COPY[locale]
  const choices: EffortChoice[] = []
  if (reasoning.defaultEffort === undefined) {
    choices.push({ key: 'provider-default', effort: undefined, label: copy.defaultEffort })
  }
  for (const level of reasoning.efforts) {
    choices.push({
      key: `effort:${level.id}`,
      effort: level.id,
      label: level.name,
      ...level.description === undefined ? {} : { description: level.description },
    })
  }
  return choices
}
