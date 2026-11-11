import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { EventRow } from '../lib/eonet';
import type { LocalSql } from '../lib/duckdb';
import { INSIGHT_QUERIES, insightData } from '../lib/insights';
import type { InsightDatum, InsightView } from '../lib/insights';

type Props = { events: EventRow[]; loading: boolean; hasLoaded: boolean };
type Session = { client: LocalSql | null; queue: Promise<void>; disposed: boolean };
type AnalysisState = {
  source: EventRow[] | null;
  status: 'idle' | 'busy' | 'ready' | 'error';
  data: Record<InsightView, InsightDatum[]>;
};

const views: { id: InsightView; label: string; note: string }[] = [
  { id: 'category', label: '種類別', note: '表示中のイベントを、自然現象の種類ごとに集計しています。' },
  { id: 'daily', label: '観測日別', note: '各イベントの最新の観測日で集計。新しい7つの観測日と、それ以前を表示します。' },
  { id: 'hemisphere', label: '南北半球別', note: '各イベントの代表位置で集計。位置情報のないイベントも件数に含みます。' }
];
const emptyData = (): Record<InsightView, InsightDatum[]> => ({ category: [], daily: [], hemisphere: [] });

export default function EventInsights({ events, loading, hasLoaded }: Props) {
  const [view, setView] = useState<InsightView>('category');
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<AnalysisState>({ source: null, status: 'idle', data: emptyData() });
  const session = useRef<Session | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();

  useEffect(() => { if (panel.current) panel.current.scrollTop = 0; }, [view, events]);

  useEffect(() => {
    const current: Session = { client: null, queue: Promise.resolve(), disposed: false };
    session.current = current;
    return () => {
      current.disposed = true;
      if (session.current === current) session.current = null;
      // Finish an in-flight operation before closing its connection.
      void current.queue.then(() => current.client?.close()).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const current = session.current;
    if (!current || !hasLoaded || !events.length) return;
    let cancelled = false;
    const isActive = () => !cancelled && !current.disposed;
    setState({ source: events, status: 'busy', data: emptyData() });

    // Debounce typing and use one connection in order. Skip obsolete filter
    // requests before each operation; the map/list never wait for analysis.
    const timer = window.setTimeout(() => {
      current.queue = current.queue.then(async () => {
        if (!isActive()) return;
        try {
          if (!current.client) {
            const { LocalSql: Client } = await import('../lib/duckdb');
            if (!isActive()) return;
            current.client = new Client();
            await current.client.init();
          }
          if (!isActive()) return;
          await current.client.load(events);
          const data = emptyData();
          for (const item of views) {
            if (!isActive()) return;
            const result = await current.client.query(INSIGHT_QUERIES[item.id]);
            data[item.id] = insightData(item.id, result.rows);
          }
          if (isActive()) setState({ source: events, status: 'ready', data });
        } catch (error) {
          console.error('Could not summarize events', error);
          const client = current.client;
          current.client = null;
          await client?.close().catch(() => undefined);
          if (isActive()) setState({ source: events, status: 'error', data: emptyData() });
        }
      });
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [events, hasLoaded, retry]);

  const selectedView = views.find(item => item.id === view)!;
  const isCurrent = state.source === events;
  const isReady = isCurrent && state.status === 'ready';
  const failed = isCurrent && state.status === 'error';
  const pending = hasLoaded && events.length > 0 && !isReady && !failed;
  const data = isReady ? state.data[view] : [];
  const max = Math.max(1, ...data.map(item => item.count));

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % views.length;
    else if (event.key === 'ArrowLeft') next = (index + views.length - 1) % views.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = views.length - 1;
    else return;
    event.preventDefault();
    setView(views[next].id);
    tabButtons.current[next]?.focus();
  }

  return <section className="insights" aria-labelledby={`${id}-title`}>
    <div className="insights-heading">
      <div className="insights-title"><h2 id={`${id}-title`}>イベントの傾向</h2><p>いま表示しているイベントを比較</p></div>
      <span className="insights-count">{hasLoaded ? `${events.length.toLocaleString('ja-JP')}件を集計` : 'データ待ち'}</span>
    </div>
    <div className="insights-tabs" role="tablist" aria-label="集計の切り口">
      {views.map((item, index) => <button
        type="button"
        key={item.id}
        id={`${id}-tab-${item.id}`}
        role="tab"
        aria-selected={view === item.id}
        aria-controls={`${id}-panel`}
        tabIndex={view === item.id ? 0 : -1}
        ref={button => { tabButtons.current[index] = button; }}
        className="insights-tab"
        onClick={() => setView(item.id)}
        onKeyDown={event => navigateTabs(event, index)}
      >{item.label}</button>)}
    </div>
    <div className="insights-body" ref={panel} id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${view}`} tabIndex={0} aria-busy={pending}>
      {!hasLoaded ? <div className="insights-state" role="status">{loading ? 'イベントを読み込んでいます…' : 'イベントを読み込むと、傾向を確認できます。'}</div>
        : !events.length ? <div className="insights-state">表示するイベントがありません。条件を変更してみてください。</div>
        : failed ? <div className="insights-state" role="alert"><p>傾向を表示できませんでした。地図と一覧は引き続き使えます。</p><button className="insights-retry" type="button" onClick={() => setRetry(value => value + 1)}>もう一度試す</button></div>
        : pending ? <div className="insights-state" role="status"><span className="insights-spinner" aria-hidden="true" />傾向を集計しています…</div>
        : <ul className="insights-bars" aria-label={`${selectedView.label}のイベント件数`}>
          {data.map(item => <li className="insight-row" key={item.key}>
            <span className="insight-label">{item.label}</span>
            <span className="insight-track" aria-hidden="true"><span className="insight-fill" style={{ width: `${item.count / max * 100}%`, backgroundColor: item.color }} /></span>
            <span className="insight-count">{item.count.toLocaleString('ja-JP')}<span>件</span></span>
          </li>)}
        </ul>}
    </div>
    <p className="insights-note">{selectedView.note}</p>
  </section>;
}
