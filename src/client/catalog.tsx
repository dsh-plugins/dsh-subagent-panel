import * as React from 'react';
import { createPortal } from 'react-dom';
import { Icon, type DshLoaderUi } from '@dsh-plugin/dsh-loader/client';
import type { ConversationSummary } from '../model.js';
import { endpoint, usePolling } from './api.js';
import { sessionModels, taskModelView, type ModelProjectionSource, type ModelSelectionView, type ModelView } from './models.js';

interface CatalogEntry {
  id: string;
  mode: string;
  name?: string;
  label?: string;
}

interface CatalogState {
  projectionsBySession: Record<string, (ModelProjectionSource & { values: { subagentCatalog?: CatalogEntry[] } }) | undefined>;
  byId: Record<string, { title?: string; origin?: string; parentId?: string; projectionValues?: { modelSelection?: ModelSelectionView } } | undefined>;
}

/** 原生槽位提供所属会话与目录快照，避免跨会话按同名任务匹配。 */
export interface CatalogProps {
  sessionId: string;
  useSessions<T>(select: (state: CatalogState) => T): T;
}

/** 原生面包屑同时展示当前子会话及其父会话的目录。 */
export interface LineageProps extends CatalogProps {
  lineageSessionId: string;
  useSession<T>(select: (state: { subagent: { address: { parentSessionId: string; childSessionId: string } } | null }) => T): T;
}

/** 一行子智能体在原生 DOM 中的位置：模型标识注入文字列，外部任务同时复用箭头座位。 */
interface CatalogTarget {
  anchor: string;
  parent: string;
  id: string;
  external: boolean;
  /** 该行的模型标识由本入口负责；另一个入口已挂载时只保留先到的实例。 */
  owned: boolean;
  row: HTMLElement;
  content: HTMLElement;
  seat?: HTMLElement;
}

/** 注入点未变化时不触发重渲染，避免每次 DOM 波动重建模型标识与箭头。 */
function sameTargets(current: CatalogTarget[], next: CatalogTarget[]): boolean {
  return current.length === next.length && current.every((target, i) => {
    const other = next[i];
    return target.anchor === other.anchor && target.parent === other.parent && target.id === other.id && target.external === other.external && target.owned === other.owned && target.row === other.row && target.content === other.content && target.seat === other.seat;
  });
}

/** 在原生目录的文字列挂载模型标识，并为外部任务补充箭头入口，保留宿主目录的内容与排序。 */
export function NativeCatalog({ sessionId, useSessions, parentSessionId, lineage, ui, open }: CatalogProps & {
  parentSessionId?: string;
  lineage?: boolean;
  ui: DshLoaderUi;
  open(parent: string, task: ConversationSummary): void;
}): React.ReactElement {
  const marker = React.useRef<HTMLSpanElement>(null);
  const warned = React.useRef(new Set<string>());
  const owner = React.useId();
  const projections = useSessions(state => state.projectionsBySession);
  const summaries = useSessions(state => state.byId);
  const [targets, setTargets] = React.useState<CatalogTarget[]>([]);
  React.useLayoutEffect(() => {
    const report = (anchor: string, kind: string, identity: string, message: string) => {
      const key = `${anchor}:${kind}:${identity}`;
      if (warned.current.has(key)) {
        return;
      }
      warned.current.add(key);
      console.warn(`[dsh-subagent-panel] ${message}`, anchor);
    };
    const sync = () => {
      const scope = marker.current?.closest(lineage ? '[data-dsp-lineage]' : '[data-slot="conversation.session.header.actions"]');
      const next: CatalogTarget[] = [];
      const visit = (parent: string, group: Element, anchor: string) => {
        const entries = projections[parent]?.values.subagentCatalog ?? [];
        const rows = Array.from(group.querySelectorAll<HTMLElement>(':scope > div > [role="treeitem"]'));
        if (rows.length !== entries.length) {
          report(anchor, 'rows', String(parent), `原生子智能体目录的行数（${rows.length}）与目录快照（${entries.length}）不一致，已跳过该目录的模型标识与外部任务入口`);
          return;
        }
        entries.forEach((entry, index) => {
          const row = rows[index];
          const area = row.lastElementChild;
          const content = area?.children[1];
          const identity = entry.mode === 'external' || entry.mode === 'continuable' ? entry.name ?? entry.id : entry.id;
          const description = entry.label || summaries[entry.id]?.title;
          const labels = description ? [description, identity] : [identity];
          const shown = content ? Array.from(content.children).filter(child => !child.hasAttribute('data-dsp-model')) : [];
          if (!content || shown.length !== labels.length || labels.some((label, i) => shown[i].textContent !== label)) {
            report(anchor, 'labels', identity, `原生子智能体条目 ${identity} 的文字列与目录快照不一致，已跳过该条目的模型标识与外部任务入口（如有）`);
            return;
          }
          const injected = content.querySelector(':scope > [data-dsp-model]');
          const owned = !injected || injected.getAttribute('data-dsp-model') === owner;
          if (!owned) {
            report(anchor, 'owner', identity, `原生子智能体条目 ${identity} 的模型标识已由另一个入口挂载，本入口不再重复注入`);
          }
          if (entry.mode === 'external') {
            const seat = area?.lastElementChild;
            const usable = seat?.tagName === 'SPAN' && !seat.hasAttribute('data-subagent-current') ? seat as HTMLElement : undefined;
            if (!usable) {
              report(anchor, 'seat', identity, `外部子智能体条目 ${identity} 缺少箭头座位，已跳过该条目的侧边栏入口`);
            }
            next.push({ anchor, parent, id: entry.id, external: true, owned, row, content: content as HTMLElement, ...(usable ? { seat: usable } : {}) });
            return;
          }
          next.push({ anchor, parent, id: entry.id, external: false, owned, row, content: content as HTMLElement });
          if (row.getAttribute('aria-expanded') === 'true') {
            const children = row.parentElement?.querySelector(':scope > [role="group"]');
            if (children) {
              visit(entry.id, children, anchor);
            }
          }
        });
      };
      for (const button of scope?.querySelectorAll<HTMLElement>('[data-subagent-action] button[aria-haspopup="dialog"]') ?? []) {
        const parent = button.querySelector('[data-subagent-count]') ? sessionId : parentSessionId;
        const anchor = button.style.getPropertyValue('anchor-name');
        const menu = Array.from(document.querySelectorAll<HTMLElement>('[data-subagent-panel]')).find(menu => menu.style.getPropertyValue('position-anchor') === anchor);
        const tree = menu?.querySelector('[role="tree"]');
        if (parent && anchor && tree) {
          visit(parent, tree, anchor);
        }
      }
      setTargets(current => sameTargets(current, next) ? current : next);
    };
    sync();
    return ui.onDomSettled(sync);
  }, [sessionId, parentSessionId, lineage, projections, summaries, ui]);
  const models = React.useMemo(() => sessionModels(summaries, projections), [summaries, projections]);
  const parents = [...new Set(targets.map(target => target.parent))];
  return <><span ref={marker} hidden />{parents.map(parent => <CatalogRows key={parent} parent={parent} owner={owner} targets={targets.filter(target => target.parent === parent)} models={models} open={open} />)}</>;
}

/** 一个目录的模型标识与外部任务箭头共用同一次任务列表轮询。 */
function CatalogRows({ parent, owner, targets, models, open }: {
  parent: string;
  owner: string;
  targets: CatalogTarget[];
  models: Record<string, ModelView>;
  open(parent: string, task: ConversationSummary): void;
}): React.ReactElement {
  const external = targets.some(target => target.external);
  const { value } = usePolling<{ tasks: ConversationSummary[] }>(endpoint(parent), external);
  const tasks = React.useMemo(() => new Map((value?.tasks ?? []).map(task => [task.id, task])), [value]);
  return <>{targets.map(target => {
    const task = target.external ? tasks.get(target.id) : undefined;
    const view = target.external ? taskModelView(task?.model) : models[target.id];
    return <React.Fragment key={`${target.anchor}:${target.id}`}>
      {target.owned && view && <CatalogModel target={target} owner={owner} view={view} />}
      {task && target.seat && <CatalogArrow seat={target.seat} task={task} open={open} target={target} />}
    </React.Fragment>;
  })}</>;
}

/**
 * 文字列末尾（标签下方）显示当前模型，完整路由放在悬停提示中。
 * 追加进宿主文字列后靠 `order` 保持在新生成的行下方，依赖宿主 `.content` 为纵向 flex 容器。
 */
function CatalogModel({ target, owner, view }: { target: CatalogTarget; owner: string; view: ModelView }): React.ReactPortal {
  return createPortal(<span className="dsp-row-model" data-dsp-model={owner} title={view.title}>{view.label}</span>, target.content);
}

function CatalogArrow({ target, seat, task, open }: {
  target: CatalogTarget;
  seat: HTMLElement;
  task: ConversationSummary;
  open(parent: string, task: ConversationSummary): void;
}): React.ReactPortal {
  const activate = React.useCallback(() => {
    open(target.parent, task);
    target.row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }, [open, target, task]);
  React.useEffect(() => {
    const { row } = target;
    const disabled = row.getAttribute('aria-disabled');
    const tabIndex = row.getAttribute('tabindex');
    const keydown = (event: KeyboardEvent) => {
      if (event.target === row && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        event.stopPropagation();
        activate();
      }
    };
    row.setAttribute('aria-disabled', 'false');
    row.tabIndex = 0;
    row.addEventListener('keydown', keydown, true);
    return () => {
      row.removeEventListener('keydown', keydown, true);
      if (disabled === null) { row.removeAttribute('aria-disabled'); } else { row.setAttribute('aria-disabled', disabled); }
      if (tabIndex === null) { row.removeAttribute('tabindex'); } else { row.setAttribute('tabindex', tabIndex); }
    };
  }, [target, activate]);
  return createPortal(<button type="button" className="dsp-catalog-arrow" aria-label={`在侧边栏打开 ${task.title}`} title="在侧边栏打开"
    onClick={event => { event.preventDefault(); event.stopPropagation(); activate(); }} onKeyDown={event => { event.stopPropagation(); }}><Icon name="ChevronRight" size={16} /></button>, seat);
}
