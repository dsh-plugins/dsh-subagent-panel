import * as React from 'react';
import { createPortal } from 'react-dom';
import { Icon, type DshLoaderUi } from '@dsh-plugin/dsh-loader/client';
import type { ConversationSummary } from '../model.js';
import { endpoint, usePolling } from './api.js';

interface CatalogEntry {
  id: string;
  mode: string;
  name?: string;
  label?: string;
}

interface CatalogState {
  projectionsBySession: Record<string, { values: { subagentCatalog?: CatalogEntry[] } } | undefined>;
  byId: Record<string, { title?: string; origin?: string; parentId?: string } | undefined>;
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

interface CatalogTarget {
  anchor: string;
  parent: string;
  id: string;
  row: HTMLElement;
  seat: Element;
}

/** 在原生外部条目的箭头预留位置挂载入口，保留宿主目录的内容与排序。 */
export function NativeCatalog({ sessionId, useSessions, parentSessionId, lineage, ui, open }: CatalogProps & {
  parentSessionId?: string;
  lineage?: boolean;
  ui: DshLoaderUi;
  open(parent: string, task: ConversationSummary): void;
}): React.ReactElement {
  const marker = React.useRef<HTMLSpanElement>(null);
  const projections = useSessions(state => state.projectionsBySession);
  const summaries = useSessions(state => state.byId);
  const [targets, setTargets] = React.useState<CatalogTarget[]>([]);
  React.useLayoutEffect(() => {
    const sync = () => {
      const scope = marker.current?.closest(lineage ? '[data-dsp-lineage]' : '[data-slot="conversation.session.header.actions"]');
      const next: CatalogTarget[] = [];
      const visit = (parent: string, group: Element, anchor: string) => {
        const entries = projections[parent]?.values.subagentCatalog ?? [];
        const rows = Array.from(group.querySelectorAll<HTMLElement>(':scope > div > [role="treeitem"]'));
        if (rows.length !== entries.length) {
          return;
        }
        entries.forEach((entry, index) => {
          const row = rows[index];
          const area = row.lastElementChild;
          const content = area?.children[1];
          const identity = entry.mode === 'external' || entry.mode === 'continuable' ? entry.name ?? entry.id : entry.id;
          const description = entry.label || summaries[entry.id]?.title;
          const labels = description ? [description, identity] : [identity];
          if (!content || content.children.length !== labels.length || labels.some((label, i) => content.children[i].textContent !== label)) {
            return;
          }
          if (entry.mode === 'external') {
            const seat = area?.lastElementChild;
            if (seat?.tagName === 'SPAN' && !seat.hasAttribute('data-subagent-current')) {
              next.push({ anchor, parent, id: entry.id, row, seat });
            }
          } else if (row.getAttribute('aria-expanded') === 'true') {
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
      setTargets(current => current.length === next.length && current.every((target, i) => target.anchor === next[i].anchor && target.parent === next[i].parent && target.id === next[i].id && target.row === next[i].row && target.seat === next[i].seat) ? current : next);
    };
    sync();
    return ui.onDomSettled(sync);
  }, [sessionId, parentSessionId, lineage, projections, summaries, ui]);
  const parents = [...new Set(targets.map(target => target.parent))];
  return <><span ref={marker} hidden />{parents.map(parent => <CatalogArrows key={parent} parent={parent} targets={targets.filter(target => target.parent === parent)} open={open} />)}</>;
}

function CatalogArrows({ parent, targets, open }: {
  parent: string;
  targets: CatalogTarget[];
  open(parent: string, task: ConversationSummary): void;
}): React.ReactElement {
  const { value } = usePolling<{ tasks: ConversationSummary[] }>(endpoint(parent));
  return <>{targets.map(target => {
    const task = value?.tasks.find(task => task.id === target.id);
    return task ? <CatalogArrow key={`${target.anchor}:${target.id}`} target={target} task={task} open={open} /> : null;
  })}</>;
}

function CatalogArrow({ target, task, open }: {
  target: CatalogTarget;
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
    onClick={event => { event.preventDefault(); event.stopPropagation(); activate(); }} onKeyDown={event => { event.stopPropagation(); }}><Icon name="ChevronRight" size={16} /></button>, target.seat);
}
