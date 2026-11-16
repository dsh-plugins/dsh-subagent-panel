import * as React from 'react';
import ArrowUp from '@icon-park/react/es/icons/ArrowUp';
import Send from '@icon-park/react/es/icons/Send';
import { DshMenu, Icon, Scrollbar, Markdown, injectStyle, type DshLoaderUi } from '@dsh-plugin/dsh-loader/client';
import { PACKAGE, type Conversation, type ConversationSummary, type TranscriptItem } from '../model.js';
import { endpoint, parseResource, request, resource, usePolling } from './api.js';
import { styles } from './style.js';
import { timeline } from './timeline.js';
import { NativeCatalog, type CatalogProps, type LineageProps } from './catalog.js';

export const name = PACKAGE;
export const inject = ['dshLoaderUi', 'slots', 'sidebarRight', 'sidebarRightTabs'];

interface ClientContext {
  dshLoaderUi: DshLoaderUi;
  effect(effect: () => (() => void), label?: string): unknown;
}
interface Slots {
  inject(name: string, callback: () => (() => void)): () => void;
  register(options: { name: string; id?: string; key?: string; order?: number; priority?: number; inject?: (...args: any[]) => object; locale?: string }, component: React.ComponentType<any>): () => void;
  entries(name: string): SlotEntry[];
  subscribe(name: string, listener: () => void): () => void;
}
interface SlotEntry {
  component: React.ComponentType<LineageProps>;
  options: { id?: string; key?: string; order?: number; priority?: number };
  inject?: (...args: any[]) => object;
  locale?: string;
}
interface Sidebar {
  openResource(address: string, options: { kind: string; preferNewPane?: boolean }): void;
}
interface Tabs {
  register(options: { id: string; kind: string; keepMounted: boolean; patterns: string[]; title(address: string): string; canOpen(address: string): boolean }): () => void;
}

/** 通过官方槽位注册右侧标签页，并为原生目录中的外部任务补充打开入口。 */
export function apply(ctx: ClientContext): void {
  const service = <T,>(key: string): T => {
    const value = ctx.dshLoaderUi.services?.get(key);
    if (!value) {
      throw new Error(`子智能体面板缺少客户端服务：${key}`);
    }
    return value as T;
  };
  const slots = service<Slots>('slots');
  const sidebar = service<Sidebar>('sidebarRight');
  const tabs = service<Tabs>('sidebarRightTabs');
  const open = (parent: string, task: ConversationSummary) => sidebar.openResource(resource(parent, task.id, task.title), { kind: 'external-subagent', preferNewPane: false });
  function Catalog(props: CatalogProps): React.ReactElement {
    return <NativeCatalog {...props} ui={ctx.dshLoaderUi} open={open} />;
  }
  const decorateLineage = () => {
    const slot = 'conversation.session.header.lineage';
    let original: SlotEntry | undefined;
    let decorated: React.ComponentType<LineageProps> | undefined;
    let dispose: (() => void) | undefined;
    let changing = false;
    const sync = () => {
      if (changing) { return; }
      const entries = slots.entries(slot);
      if (original && entries.includes(original)) { return; }
      const entry = entries.find(entry => entry.locale === 'subagent' && entry.component !== decorated);
      if (entry === original) { return; }
      changing = true;
      try {
        dispose?.();
        dispose = undefined;
        original = entry;
        if (!entry) { return; }
        const Original = entry.component;
        decorated = function Lineage(props: LineageProps) {
          const address = props.useSession(state => state.subagent?.address);
          const parent = props.useSessions(state => {
            if (address?.childSessionId === props.lineageSessionId) { return address.parentSessionId; }
            const owner = Object.entries(state.projectionsBySession).find(([, snapshot]) => snapshot?.values.subagentCatalog?.some(child => child.id === props.lineageSessionId));
            if (owner) { return owner[0]; }
            const summary = state.byId[props.lineageSessionId];
            return summary?.origin === 'subagent' ? summary.parentId : undefined;
          });
          return <span data-dsp-lineage="" style={{ display: 'contents' }}><Original {...props} /><NativeCatalog {...props} sessionId={props.lineageSessionId} parentSessionId={parent} lineage ui={ctx.dshLoaderUi} open={open} /></span>;
        };
        dispose = slots.register({ name: slot, ...entry.options, priority: (entry.options.priority ?? 0) - 1, inject: entry.inject, locale: entry.locale }, decorated);
      } finally {
        changing = false;
      }
    };
    const off = slots.subscribe(slot, sync);
    try {
      sync();
    } catch (error) {
      off();
      dispose?.();
      throw error;
    }
    return () => { off(); dispose?.(); };
  };
  function Tab({ useTabInfo }: { useTabInfo(): { tab: { contentId: string; visible: boolean } } }): React.ReactElement {
    const { tab } = useTabInfo();
    const address = parseResource(tab.contentId);
    if (!address) {
      return <div className="dsp-empty">子智能体地址无效。</div>;
    }
    return address.id === 'list' ? <TaskList parent={address.parent} open={task => { open(address.parent, task); }} /> : <TaskPanel key={tab.contentId} parent={address.parent} id={address.id} visible={tab.visible} />;
  }
  ctx.effect(() => injectStyle(name, 'panel.css', styles), 'subagent-panel:styles');
  ctx.effect(() => tabs.register({ id: name, kind: 'external-subagent', keepMounted: true, patterns: ['dsh-resource://external-subagent/**'], title: address => parseResource(address)?.title || '外部子智能体', canOpen: address => !!parseResource(address) }), 'subagent-panel:tabs');
  ctx.effect(() => slots.inject('sidebar.right.pane.tab', () => slots.register({ name: 'sidebar.right.pane.tab', key: name }, Tab)), 'subagent-panel:body');
  ctx.effect(() => slots.inject('conversation.session.header.actions', () => slots.register({ name: 'conversation.session.header.actions', id: name, order: 11 }, Catalog)), 'subagent-panel:catalog');
  ctx.effect(() => slots.inject('conversation.session.header.lineage', decorateLineage), 'subagent-panel:lineage');
}

function TaskList({ parent, open }: { parent: string; open(task: ConversationSummary): void }): React.ReactElement {
  const { value, error, refresh } = usePolling<{ tasks: ConversationSummary[] }>(endpoint(parent));
  return <section className="dsp-panel" aria-label="外部子智能体列表">
    <div className="dsp-toolbar"><div className="dsp-heading">外部子智能体<span className="dsp-meta">Codex · Claude Code</span></div><button className="dsp-button dsp-icon-button" onClick={refresh} type="button" aria-label="刷新任务列表" title="刷新任务列表"><Icon name="Refresh" size={16} /></button></div>
    {error && <div className="dsp-error" role="alert">{error}</div>}
    <Scrollbar className="dsp-scroll"><div className="dsp-task-list">{value?.tasks.map(task => <button type="button" className="dsp-task" key={task.id} onClick={() => { open(task); }}>
      <span className={`dsp-dot ${task.status}`} /><span className="dsp-task-copy"><span className="dsp-task-title">{task.title}</span><span className="dsp-meta">{backendLabel(task.backend)} · {statusLabel(task.status)} · {task.turns} 轮对话</span></span><time className="dsp-meta">{formatTime(task.createdAt)}</time><Icon name="ChevronRight" size={12} />
    </button>)}{!error && !value?.tasks.length && <div className="dsp-empty"><strong>{value ? '等待外部子智能体任务' : '正在加载任务…'}</strong>{value && <>在当前会话中调用 Codex 或 Claude Code 子智能体后，任务会自动出现在这里。</>}</div>}</div></Scrollbar>
  </section>;
}

function TaskPanel({ parent, id, visible }: { parent: string; id: string; visible: boolean }): React.ReactElement {
  const { value: task, error, refresh } = usePolling<Conversation>(endpoint(parent, id));
  const [draft, setDraft] = React.useState('');
  const [working, setWorking] = React.useState(false);
  const [actionError, setActionError] = React.useState('');
  const [follow, setFollow] = React.useState(true);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const sendId = React.useRef(crypto.randomUUID());
  const root = React.useRef<HTMLDivElement>(null);
  const abort = React.useRef(new AbortController());
  React.useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    return () => { controller.abort(); };
  }, []);
  React.useLayoutEffect(() => {
    const viewport = root.current?.querySelector('.dshl-scrollbar-viewport');
    if (visible && follow && viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [task?.revision, follow, draft, visible]);
  React.useEffect(() => {
    if (!visible) {
      setMenuOpen(false);
    }
  }, [visible]);
  const operate = async (operation: string) => {
    setWorking(true);
    setActionError('');
    try {
      await request(endpoint(parent, id, operation), abort.current.signal, operation === 'send' ? { message: draft, requestId: sendId.current } : {});
      if (!abort.current.signal.aborted) {
        if (operation === 'send') {
          setDraft('');
          sendId.current = crypto.randomUUID();
          setFollow(true);
        }
        refresh();
      }
    } catch (failure) {
      if (!abort.current.signal.aborted) {
        setActionError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      if (!abort.current.signal.aborted) {
        setWorking(false);
      }
    }
  };
  return <section className="dsp-panel" aria-label="外部子智能体对话">
    {(error || actionError || task?.error) && <div className="dsp-error" role="alert">{actionError || error || task?.error}<button type="button" className="dsp-button" onClick={refresh}>刷新</button></div>}
    <div ref={root} className="dsp-transcript" onScrollCapture={event => {
      const element = event.target as HTMLElement;
      if (element === root.current?.querySelector('.dshl-scrollbar-viewport')) {
        setFollow(element.scrollHeight - element.scrollTop - element.clientHeight < 60);
      }
    }}><Scrollbar className="dsp-scroll"><div className="dsp-content">{task && <Timeline task={task} />}
      {(!task || task.status === 'starting') && <div className="dsp-meta" role="status">{task ? '正在连接原生会话…' : '正在加载…'}</div>}
    </div></Scrollbar>
      {!follow && <button type="button" className="dsp-button dsp-follow" aria-label="查看最新输出" title="查看最新输出" onClick={() => { setFollow(true); }}><Icon name="ChevronDown" size={18} /></button>}
    </div>
    <div className="dsp-composer-seat">
      <form className="dsp-composer" onSubmit={event => { event.preventDefault(); if (draft.trim() && !working) { void operate('send'); } }}>
        <Scrollbar className="dsp-editor-scroll" aria-label="消息输入区"><div className="dsp-input-grow" data-draft={draft}><textarea className="dsp-input" rows={1} aria-label="发送给子智能体的消息" placeholder="发送消息，继续当前任务" value={draft} onChange={event => { setDraft(event.target.value); sendId.current = crypto.randomUUID(); }} disabled={working || !task} maxLength={100000}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (draft.trim() && !working) { void operate('send'); } } }} /></div></Scrollbar>
        <div className="dsp-compose-actions">
          <DshMenu open={menuOpen && visible} onClose={() => { setMenuOpen(false); }} side="top" portal
            anchor={<button type="button" className="dsp-button dsp-icon-button dsp-menu-trigger" aria-label="会话操作" title="会话操作" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => { setMenuOpen(!menuOpen); }}><Icon name="More" size={18} /></button>}
            items={[{ id: 'refresh', label: '刷新记录', icon: <Icon name="Refresh" size={16} /> }, { id: 'release', label: '释放进程，保留会话', icon: <Icon name="Close" size={16} />, disabled: working || !task || task.status === 'closed' }]}
            onSelect={operation => { setMenuOpen(false); if (operation === 'refresh') { refresh(); } else { void operate('release'); } }} />
          <span className="dsp-provider" title={task ? `${backendLabel(task.backend)} · ${statusLabel(task.status)}` : ''}><span className={`dsp-dot ${task?.status}`} />{task ? backendLabel(task.backend) : ''}</span>
          <span className="dsp-model" title={task?.model}>{task?.model}</span>
          {task?.status === 'running' && <button type="button" className="dsp-button dsp-stop" aria-label="停止当前轮次" title="停止当前轮次" disabled={working} onClick={() => { void operate('interrupt'); }}><span aria-hidden="true" /></button>}
          <button type="submit" className="dsp-button dsp-send" aria-label={working ? '正在提交消息' : '发送消息'} title="发送消息" disabled={working || !task || !draft.trim()}>{working ? <Icon name="Loading" size={18} className="dsp-spinning" /> : <ArrowUp size={18} fill="currentColor" />}</button>
        </div>
      </form>
      <div className="dsp-composer-hint">{task?.status === 'closed' ? '发送消息后恢复会话' : task?.backend === 'claude-code' && task.status === 'running' ? '运行中可追加消息，Claude 将按队列接续处理' : 'Enter 发送 · Shift+Enter 换行'}</div>
    </div>
  </section>;
}

function Item({ item }: { item: TranscriptItem }): React.ReactElement | null {
  const [expanded, setExpanded] = React.useState<boolean>();
  const open = expanded ?? item.status === 'running';
  if (item.kind === 'reasoning' && !item.text && item.status !== 'running') {
    return null;
  }
  if (item.kind === 'user') {
    return <details className="dsp-item dsp-item-user" open={expanded ?? false}>
      <summary onClick={event => { event.preventDefault(); setExpanded(!expanded); }}><Send size={14} fill="currentColor" /><span className="dsp-trigger-title">{item.status === 'error' ? '发送失败' : '收到任务消息'}</span><time dateTime={new Date(item.time).toISOString()}>{formatTime(item.time)}</time><Icon name="ChevronDown" size={12} className="dsp-chevron" /></summary>
      <Scrollbar className="dsp-user-scroll"><div className="dsp-user-text">{item.text}</div></Scrollbar>
    </details>;
  }
  if (item.kind === 'tool' || item.kind === 'reasoning') {
    return <details className="dsp-item dsp-detail" open={open}><summary onClick={event => { event.preventDefault(); setExpanded(!open); }}><Icon name={item.kind === 'reasoning' ? 'Diamond' : 'Terminal'} size={14} /><span className="dsp-detail-title">{item.kind === 'reasoning' ? '思考过程' : item.title || '工具调用'}</span>{item.status === 'running' && <span className="dsp-dot running" />}{item.status === 'error' && <span className="dsp-failed">失败</span>}<Icon name="ChevronDown" size={12} className="dsp-chevron" /></summary><div className="dsp-detail-body">{item.input && <pre className="dsp-code">{item.input}</pre>}{item.kind === 'reasoning' ? <Markdown>{item.text}</Markdown> : item.text && <pre className="dsp-code">{item.text}</pre>}</div></details>;
  }
  return <div className={`dsp-item dsp-item-${item.kind}`}>
    {item.kind === 'assistant' ? <Markdown>{item.text}</Markdown> : item.text}
  </div>;
}

function Timeline({ task }: { task: Conversation }): React.ReactElement {
  return <>{timeline(task).map(entry => {
    if (entry.item) {
      return <Item key={entry.key} item={entry.item} />;
    }
    const turn = entry.turn!;
    if (entry.tail) {
      return <div className="dsp-turn-meta" key={entry.key}>{(turn.inputTokens !== undefined || turn.outputTokens !== undefined) && <span title={`输入 ${turn.inputTokens ?? 0} token · 输出 ${turn.outputTokens ?? 0} token`}><Icon name="Code" size={14} />用量 {((turn.inputTokens ?? 0) + (turn.outputTokens ?? 0)).toLocaleString()} tok</span>}<time>{formatTime(turn.endedAt!)}</time></div>;
    }
    return <div className={`dsp-turn ${turn.status}`} key={entry.key}>{turn.status === 'running' && <span className="dsp-dot running" />}{turn.status === 'running' ? '正在处理' : turn.status === 'completed' ? '已完成' : turn.status === 'interrupted' ? '已停止' : '执行失败'}{turn.endedAt && `，用时 ${Math.max(1, Math.round((turn.endedAt - turn.startedAt) / 1000))} 秒`}</div>;
  })}</>;
}

function formatTime(time: number): string {
  return new Date(time).toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function backendLabel(backend: string): string {
  return backend === 'codex' ? 'Codex' : 'Claude Code';
}

function statusLabel(status: string): string {
  return ({ starting: '正在连接', running: '执行中', idle: '已完成', interrupted: '已停止', error: '执行失败', closed: '可恢复' } as Record<string, string>)[status] || status;
}
