/** 宿主模型选择投影的客户端视图，`next` 即下一步模型将使用的路由。 */
export interface ModelSelectionView {
  /** 与宿主视图保持一致；`next` 已回落到它，展示只读 `next`。 */
  lastUsed?: ModelRoute | null;
  next?: ModelRoute | null;
}

/** 一条已记录的模型路由，reasoningEffort 由适配器声明。 */
export interface ModelRoute {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

/** 行内显示的模型文字，以及悬停时展示的完整路由。 */
export interface ModelView {
  label: string;
  title: string;
}

/** 会话列表快照中与模型相关的字段。 */
export interface ModelSummarySource {
  projectionValues?: { modelSelection?: ModelSelectionView };
}

/** 含完整投影值的会话快照，用于会话列表快照未携带模型时兜底。 */
export interface ModelProjectionSource {
  values: { modelSelection?: ModelSelectionView };
}

/** 由一条模型选择折叠出展示值；未发起过模型请求的会话没有可显示路由。 */
export function modelView(selection: ModelSelectionView | undefined): ModelView | undefined {
  const route = selection?.next;
  const model = route?.model.trim();
  if (!route || !model) {
    return undefined;
  }
  return { label: model, title: [route.provider, model, route.reasoningEffort].filter(Boolean).join(' · ') };
}

/** 外部任务直接使用原生协议报告或提供方配置的模型，名称即全部信息。 */
export function taskModelView(model: string | undefined): ModelView | undefined {
  const label = model?.trim();
  return label ? { label, title: label } : undefined;
}

/** 汇总各子智能体会话当前使用的模型，供原生目录逐行显示。 */
export function sessionModels(
  summaries: Readonly<Record<string, ModelSummarySource | undefined>>,
  projections: Readonly<Record<string, ModelProjectionSource | undefined>>,
): Record<string, ModelView> {
  const models: Record<string, ModelView> = {};
  for (const id of new Set([...Object.keys(summaries), ...Object.keys(projections)])) {
    const view = modelView(summaries[id]?.projectionValues?.modelSelection) ?? modelView(projections[id]?.values.modelSelection);
    if (view) {
      models[id] = view;
    }
  }
  return models;
}
