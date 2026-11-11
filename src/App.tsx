import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import EventsMap from './components/EventsMap';
import { normalize, colorFor, dateLabel, API_URL } from './lib/eonet';
import type { EonetResponse, EventRow, Status } from './lib/eonet';
import { LocalSql, PRESETS } from './lib/duckdb';
import type { SqlResults } from './lib/duckdb';

type Preset = keyof typeof PRESETS;
const MAX_EVENTS = 700;
const textError = (error: unknown) => error instanceof Error ? error.message : String(error);

export default function App() {
  const [days, setDays] = useState(90);
  const [status, setStatus] = useState<Status>('all');
  const [events, setEvents] = useState<EventRow[]>([]);
  const [filter, setFilter] = useState('all');
  const [queryText, setQueryText] = useState('');
  const [selected, setSelected] = useState<EventRow | null>(null);
  const [fitToken, setFitToken] = useState(0);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('未取得');
  const [error, setError] = useState<string | null>(null);
  const [duckStatus, setDuckStatus] = useState('初期化前');
  const [duckReady, setDuckReady] = useState(false);
  const [preset, setPreset] = useState<Preset>('category');
  const [sql, setSql] = useState<string>(PRESETS.category);
  const [sqlResult, setSqlResult] = useState<SqlResults | null>(null);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [sqlBusy, setSqlBusy] = useState(false);
  const sqlClient = useRef<LocalSql | null>(null);
  const querySerial = useRef(Promise.resolve());

  const apiUrl = useMemo(() => {
    const url = new URL(API_URL);
    url.searchParams.set('days', String(days));
    url.searchParams.set('status', status);
    url.searchParams.set('limit', String(MAX_EVENTS));
    return url.href;
  },[days,status]);

  const categories = useMemo(() => {
    const counts = new Map<string,{ name:string;count:number }>();
    events.forEach(e => { const old = counts.get(e.category_id); counts.set(e.category_id,{name:e.category,count:(old?.count ?? 0)+1}); });
    return [{id:'all',name:'すべて',count:events.length}, ...[...counts].sort((a,b)=>b[1].count-a[1].count).map(([id,v])=>({id,...v}))];
  },[events]);
  const filtered = useMemo(() => {
    const query = queryText.trim().toLocaleLowerCase();
    return events.filter(e => (filter === 'all' || e.category_id === filter) &&
      (!query || [e.title,e.category,e.description].some(value => value.toLocaleLowerCase().includes(query))));
  },[events,filter,queryText]);
  const mapped = events.filter(e=>e.latitude !== null && e.longitude !== null).length;
  const mostCommon = categories.slice(1)[0];

  const executeSql = useCallback(async (statement: string) => {
    const client = sqlClient.current;
    if (!client) return;
    setSqlBusy(true);setSqlError(null);
    // Serialize queries with table imports: DuckDB connections are not safely concurrent.
    const job = querySerial.current.then(async () => {
      try { setSqlResult(await client.query(statement)); }
      catch (e) { setSqlError(textError(e)); setSqlResult(null); }
      finally { setSqlBusy(false); }
    });
    querySerial.current = job;
    await job;
  },[]);

  const loadEvents = useCallback(async () => {
    setLoading(true);setError(null);setStatusText('RustからNASA EONET APIへ接続中…');
    try {
      const response = await invoke<EonetResponse>('fetch_eonet',{days,status,limit:MAX_EVENTS});
      const normalized = normalize(response);
      setEvents(normalized);setFilter('all');setSelected(null);setQueryText('');
      setStatusText(`${new Date().toLocaleTimeString('ja-JP')} · ${normalized.length}件取得${normalized.length >= MAX_EVENTS ? '（上限到達）' : ''}`);
      setDuckStatus('DuckDB-Wasmを初期化中…');
      if (!sqlClient.current) {
        const client = new LocalSql();
        await client.init();
        sqlClient.current = client;
      }
      const client = sqlClient.current;
      // Subsequent reloads cannot overlap SQL execution or prior imports.
      const job = querySerial.current.then(async()=> {
        await client.load(normalized);
        setDuckReady(true);setDuckStatus('DuckDB-Wasm 準備完了');
        setSqlResult(await client.query(sql));
        setSqlError(null);
      });
      querySerial.current = job.catch(()=>{});
      await job;
    } catch (e) {
      const message=textError(e);
      setStatusText('データ取得または分析に失敗');
      // NASA fetch failure and DuckDB failure do not erase previously loaded map data.
      setError(message);
      setDuckStatus(sqlClient.current ? 'DuckDBエラー · 地図は利用可' : 'DuckDB未起動');
    } finally { setLoading(false); }
  },[days,status,sql]);

  // Initial load only; the button controls later refetches.
  const initialLoad = useRef(false);
  useEffect(() => {
    if (initialLoad.current) return;
    initialLoad.current = true;
    void loadEvents();
  },[loadEvents]);
  useEffect(() => () => { const client = sqlClient.current; if (client) void client.close(); },[]);

  const choosePreset = (value: Preset) => {
    setPreset(value);
    const statement = PRESETS[value];
    setSql(statement);
    if (duckReady) void executeSql(statement);
  };

  return <div className="app">
    <header className="masthead">
      <div className="brand"><div className="brand-mark"><span /></div><div>
        <div className="eyebrow">NASA OPEN DATA · RUST + TAURI LAB</div>
        <h1>EARTHWATCH <span>/ EONET</span></h1>
      </div></div>
      <div className="header-right"><div className="live-indicator"><span className="status-dot" /> NASA EONET v3</div>
        <a href="https://eonet.gsfc.nasa.gov/docs/v3" target="_blank" rel="noreferrer">API Docs ↗</a></div>
    </header>
    <main className="layout">
      <aside className="sidebar">
        <section className="sidebar-intro">
          <div className="section-label">01 / DATA SOURCE</div><h2>Earth, observed.</h2>
          <p>NASAの山火事・暴風雨・火山活動などをRust経由で取得して探索する。分析はDuckDB-Wasmがローカルで処理。</p>
          <div className="controls">
            <label>対象期間<select value={days} onChange={e=>setDays(Number(e.target.value))}>
              <option value={30}>過去30日</option><option value={90}>過去90日</option><option value={365}>過去365日</option>
            </select></label>
            <label>ステータス<select value={status} onChange={e=>setStatus(e.target.value as Status)}>
              <option value="all">すべて</option><option value="open">継続中（EONET分類）</option><option value="closed">終了</option>
            </select></label>
          </div>
          <button className="primary" disabled={loading} onClick={()=>void loadEvents()}>
            <span>{loading ? '取得中…' : events.length ? 'NASA APIから再取得' : 'NASA APIから取得'}</span><span aria-hidden>↗</span>
          </button>
          <div className="subline"><span role="status">{statusText}</span><a target="_blank" rel="noreferrer" href={apiUrl}>生データ ↗</a></div>
          {error && <div className="error" role="alert">{error}</div>}
        </section>
        <section className="metrics" aria-label="データの概要">
          <div className="metric"><div className="metric-label">EVENTS</div><strong>{events.length.toLocaleString('ja-JP')}</strong></div>
          <div className="metric"><div className="metric-label">ON MAP</div><strong>{mapped.toLocaleString('ja-JP')}</strong></div>
          <div className="metric wide"><div className="metric-label">MOST COMMON CATEGORY</div><strong>{mostCommon ? `${mostCommon.name} (${mostCommon.count})`:'—'}</strong></div>
        </section>
        <section className="event-section"><div className="section-line"><div className="section-label">02 / EXPLORE EVENTS</div><span>{filtered.length}件</span></div>
          <input id="search" type="search" placeholder="地名・イベント名で検索" aria-label="イベントを検索" value={queryText} onChange={e=>setQueryText(e.target.value)} />
          <div className="filters">
            {events.length ? categories.map(category => <button key={category.id} className={`chip${filter === category.id ? ' active':''}`} onClick={()=>setFilter(category.id)}>{category.name} {category.count}</button>) : <span className="empty-hint">取得後にカテゴリが表示されます</span>}
          </div>
          <div className="event-list">
            {filtered.length ? filtered.slice(0,200).map(event=><button key={event.id} className={`event-card${selected?.id === event.id ? ' active':''}`} onClick={()=>setSelected(event)}>
              <div className="event-card-head"><span className="event-card-title">{event.title}</span><span className="event-card-date">{dateLabel(event.event_date)}</span></div>
              <div className="event-card-bottom"><i className="category-dot" style={{background:colorFor(event.category_id)}} /><span>{event.category} · {event.status === 'open' ? '継続中':'終了'}</span></div>
            </button>) : <p className="empty">{loading?'NASA APIから取得しています…':'表示できるイベントはありません。'}</p>}
            {filtered.length > 200 && <p className="empty">リストは先頭200件のみ表示（地図は全件を対象）。</p>}
          </div>
        </section>
      </aside>
      <section className="workspace">
        <div className="map-panel"><EventsMap events={filtered} selected={selected} onSelect={setSelected} fitToken={fitToken}/>
          <div className="map-top"><div className="map-pill"><span className="map-sparkle">◎</span> LOCAL DATA EXPLORER</div><button className="ghost" onClick={()=>setFitToken(value=>value+1)}>全地点を表示 ⤢</button></div>
          <div className="map-bottom"><span>Natural events tracked by NASA EONET</span><span>代表位置のみ表示 · 衛星画像ではありません</span></div>
          {selected && <div className="map-detail"><button className="detail-close" aria-label="詳細を閉じる" onClick={()=>setSelected(null)}>×</button>
            <div className="detail-label">{selected.category.toUpperCase()}</div>
            <h3>{selected.title}</h3>
            <div className="detail-meta" style={{whiteSpace:'pre-line'}}>{`観測日: ${dateLabel(selected.event_date)}\n位置: ${selected.latitude === null || selected.longitude === null ? '位置情報なし' : `${selected.latitude.toFixed(3)}°, ${selected.longitude.toFixed(3)}°`}\n観測記録: ${selected.observations}件\nEONET状態: ${selected.status}`}</div>
            {selected.description && <p className="detail-meta">{selected.description}</p>}
            {selected.sourceUrl && <a className="source-link" href={selected.sourceUrl} target="_blank" rel="noreferrer">出典を開く ↗</a>}
          </div>}
        </div>
        <section className="analytics"><div className="analytics-heading"><div><div className="section-label">03 / ANALYZE LOCALLY</div><h2>DuckDB <span>in your WebView</span></h2></div>
          <div className="runtime"><span className={`status-dot ${duckReady ? '' : 'pending'}`}/>{duckStatus}</div></div>
          <div className="analytics-grid">
            <div className="query-panel"><div className="query-head"><label htmlFor="sql">SQL QUERY</label><select aria-label="SQLサンプル" value={preset} onChange={e=>choosePreset(e.target.value as Preset)}>
              <option value="category">カテゴリ別件数</option><option value="daily">日付別件数</option><option value="hemisphere">南北半球別件数</option><option value="recent">最新イベント</option>
            </select></div>
              <textarea id="sql" spellCheck={false} aria-label="SQLクエリ" value={sql} onChange={e=>setSql(e.target.value)}/>
              <div className="query-footer"><div className="query-note">Rust → NASA JSON → DuckDB-Wasm</div><button className="secondary" disabled={!duckReady||sqlBusy} onClick={()=>void executeSql(sql)}>SQLを実行 →</button></div>
            </div>
            <div className="result-panel"><div className="result-head"><span>QUERY RESULT</span><span>{sqlBusy ? '実行中…' : sqlResult ? `${sqlResult.count}行 · ${sqlResult.elapsedMs} ms` :'データ待ち'}</span></div>
              <div className="sql-result">{sqlError ? <p className="empty">SQLエラー: {sqlError}</p> : sqlResult ? <table><thead><tr>{sqlResult.columns.map(col=><th key={col}>{col}</th>)}</tr></thead><tbody>{sqlResult.rows.map((row,i)=><tr key={i}>{sqlResult.columns.map(col=><td key={col} title={row[col]}>{row[col]}</td>)}</tr>)}</tbody></table> : <p className="empty">取得後にSQLを実行できます。</p>}</div>
            </div>
          </div>
        </section>
      </section>
    </main>
    <footer><span>INDEPENDENT LEARNING PROJECT · MIT LICENSE · NOT AFFILIATED WITH NASA</span><span>NASA EONET · © OpenStreetMap contributors · © CARTO</span></footer>
  </div>;
}
