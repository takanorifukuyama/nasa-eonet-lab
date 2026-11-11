import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import EventsMap from './components/EventsMap';
import EventInsights from './components/EventInsights';
import ExternalLink from './components/ExternalLink';
import Icon from './components/Icon';
import { categoryLabel, colorFor, dateLabel, normalize } from './lib/eonet';
import type { EventRow, Status } from './lib/eonet';
import { fetchEvents, FetchEventsError, MAX_EVENTS } from './lib/api';

type Conditions = { days: number; status: Status };
type Sort = 'newest' | 'oldest' | 'name';
const DEFAULT_CONDITIONS: Conditions = { days: 90, status: 'all' };
const PAGE_SIZE = 40;
const STATUS_LABELS = { all: 'すべて', open: '継続中', closed: '終了' };
const number = (value: number) => value.toLocaleString('ja-JP');
const searchKey = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ja-JP');

export default function App() {
  const [conditions, setConditions] = useState(DEFAULT_CONDITIONS);
  const [applied, setApplied] = useState(DEFAULT_CONDITIONS);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [atLimit, setAtLimit] = useState(false);
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fitToken, setFitToken] = useState(0);
  const [mobileView, setMobileView] = useState<'map' | 'list'>('map');
  const [aboutOpen, setAboutOpen] = useState(false);
  const requestId = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const detail = useRef<HTMLElement>(null);
  const lastTrigger = useRef<HTMLElement | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const load = useCallback(async (requested: Conditions) => {
    const id = ++requestId.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    setError(null);
    try {
      const response = await fetchEvents(requested, controller.signal);
      const rows = normalize(response);
      if (id !== requestId.current) return;
      setEvents(rows);
      setApplied(requested);
      setFetchedAt(new Date());
      setHasLoaded(true);
      setAtLimit((response.events?.length ?? 0) >= MAX_EVENTS);
      setCategory(previous => previous === 'all' || rows.some(row => row.category_id === previous) ? previous : 'all');
      setVisibleCount(PAGE_SIZE);
    } catch (cause) {
      if (id !== requestId.current || controller.signal.aborted) return;
      setError(cause instanceof FetchEventsError ? cause.message : 'データを読み込めませんでした。時間をおいて、もう一度お試しください。');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(DEFAULT_CONDITIONS);
    return () => { ++requestId.current; abort.current?.abort(); };
  }, [load]);

  const categories = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const event of events) {
      const previous = counts.get(event.category_id);
      counts.set(event.category_id, { label: categoryLabel(event.category_id, event.category), count: (previous?.count ?? 0) + 1 });
    }
    return [...counts].sort((a, b) => b[1].count - a[1].count).map(([id, value]) => ({ id, ...value }));
  }, [events]);

  const filtered = useMemo(() => {
    const needle = searchKey(query.trim());
    return events.filter(event => (category === 'all' || event.category_id === category) &&
      (!needle || [event.title, event.category, categoryLabel(event.category_id, event.category), event.description, event.id]
        .some(text => searchKey(text).includes(needle))));
  }, [events, category, query]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    if (sort === 'name') return a.title.localeCompare(b.title, 'ja');
    if (!a.event_date) return b.event_date ? 1 : 0;
    if (!b.event_date) return -1;
    return sort === 'newest' ? b.event_date.localeCompare(a.event_date) : a.event_date.localeCompare(b.event_date);
  }), [filtered, sort]);

  const selected = filtered.find(event => event.id === selectedId) ?? null;
  const mapped = filtered.filter(event => event.latitude !== null && event.longitude !== null).length;
  const visibleCategories = new Set(filtered.map(event => event.category_id)).size;
  const dirty = conditions.days !== applied.days || conditions.status !== applied.status;
  const filteredActive = category !== 'all' || query.trim() !== '';
  const appliedLabel = `過去${applied.days}日 · ${STATUS_LABELS[applied.status]}`;

  const resetFilters = () => {
    setCategory('all'); setQuery(''); setVisibleCount(PAGE_SIZE);
    searchInput.current?.focus();
  };
  const closeDetail = useCallback(() => {
    setSelectedId(null);
    const target = lastTrigger.current;
    if (target?.isConnected && window.matchMedia('(max-width: 760px)').matches) {
      setMobileView('list');
      requestAnimationFrame(() => { if (target.isConnected) target.focus({ preventScroll: true }); });
    } else if (target?.isConnected) target.focus({ preventScroll: true });
    else searchInput.current?.focus({ preventScroll: true });
  }, []);
  const chooseEvent = (event: EventRow, trigger?: HTMLElement) => {
    lastTrigger.current = trigger ?? null;
    setSelectedId(event.id);
    setMobileView('map');
  };

  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selectedId, selected]);
  useEffect(() => {
    if (!selectedId || !detail.current) return;
    detail.current.focus({ preventScroll: true });
    if (window.matchMedia('(max-width: 760px)').matches) detail.current.scrollIntoView({ block: 'center', behavior: 'instant' });
  }, [selectedId, mobileView]);
  useEffect(() => {
    if (!selected) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !dialog.current?.open) { event.preventDefault(); closeDetail(); }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [selected, closeDetail]);
  useEffect(() => {
    list.current?.scrollTo({ top: 0 });
  }, [query, category, sort, events]);
  useEffect(() => {
    if (aboutOpen) dialog.current?.showModal();
    else dialog.current?.close();
  }, [aboutOpen]);

  return <div className="app">
    <a className="skip-link" href="#event-search">イベントの検索へ</a>
    <header className="masthead">
      <div className="brand"><div className="brand-mark" aria-hidden="true"><Icon name="globe" /></div><span className="wordmark">EARTHWATCH<span className="brand-divider" /><span className="brand-tagline">地球の変化を見つける</span></span></div>
      <div className="header-right"><span className="source-credit">DATA BY <strong>NASA EONET</strong></span><button className="quiet-button" onClick={() => setAboutOpen(true)}><Icon name="info" /><span>データについて</span></button></div>
    </header>

    <main className="page">
      <div className="page-heading"><div><p className="eyebrow">OUR CHANGING PLANET</p><h1>世界の自然現象を探す<span className="heading-dot">.</span></h1><p className="page-description">山火事、嵐、火山活動。公開されている記録から、地球の変化をたどろう。</p></div>
        <div className={`update-status${error ? ' has-error' : ''}`} role="status"><span className={`status-dot${loading ? ' pending' : error ? ' warning' : ''}`} />{loading ? '記録を読み込んでいます' : error ? '更新できませんでした' : fetchedAt ? <><span>最終更新</span><time dateTime={fetchedAt.toISOString()}>{fetchedAt.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></> : '読み込み前'}</div>
      </div>

      <div className="explorer" data-view={mobileView}>
        <p className="sr-only" role="status" aria-atomic="true">{hasLoaded ? `${number(filtered.length)}件のイベントが見つかりました。` : ''}</p>
        <aside className="sidebar" aria-label="探索条件とイベント一覧">
          <section className="source-controls" aria-labelledby="conditions-title">
            <div className="section-heading"><h2 id="conditions-title">探索する範囲</h2><span className="small-label">世界全体</span></div>
            <fieldset disabled={loading} className="conditions"><legend className="sr-only">読み込むデータの条件</legend>
              <label>対象期間<select value={conditions.days} onChange={event => setConditions(previous => ({ ...previous, days: Number(event.target.value) }))}><option value={30}>過去30日</option><option value={90}>過去90日</option><option value={365}>過去365日</option></select></label>
              <label>記録の状態<select value={conditions.status} onChange={event => setConditions(previous => ({ ...previous, status: event.target.value as Status }))}><option value="all">すべて</option><option value="open">継続中</option><option value="closed">終了</option></select></label>
            </fieldset>
            <button className="primary" disabled={loading} onClick={() => void load(conditions)}><Icon name="refresh" className={loading ? 'spinning' : ''} />{loading ? '読み込み中…' : dirty ? '条件を適用' : error ? 'もう一度読み込む' : 'データを更新'}</button>
            <p className={`conditions-note${dirty ? ' changed' : ''}`}>{dirty ? '条件を適用すると、表示が更新されます。' : hasLoaded ? `${appliedLabel}の記録を表示しています` : 'NASAが公開する記録を読み込みます'}</p>
            {error && <div className="error-notice" role="alert"><Icon name="info" /><div><strong>{hasLoaded ? '前回のデータを表示しています' : '記録を取得できませんでした'}</strong><p>{error}</p>{hasLoaded && <p>表示中の条件：{appliedLabel}</p>}</div></div>}
          </section>

          <section className="event-section" id="event-search" aria-labelledby="events-title">
            <div className="search-field"><Icon name="search" /><input ref={searchInput} type="search" placeholder="地名・イベント名で検索" aria-label="イベントを検索" value={query} onChange={event => { setQuery(event.target.value); setVisibleCount(PAGE_SIZE); }} />{query && <button className="icon-button search-clear" aria-label="検索をクリア" onClick={() => { setQuery(''); setVisibleCount(PAGE_SIZE); searchInput.current?.focus(); }}><Icon name="close" /></button>}</div>
            <div className="filters" role="group" aria-label="現象の種類で絞り込み"><button className="chip" aria-pressed={category === 'all'} onClick={() => { setCategory('all'); setVisibleCount(PAGE_SIZE); }}>すべて <span>{hasLoaded ? number(events.length) : '—'}</span></button>{categories.map(item => <button key={item.id} className="chip" aria-pressed={category === item.id} onClick={() => { setCategory(item.id); setVisibleCount(PAGE_SIZE); }}><i className="category-dot" style={{ background: colorFor(item.id) }} aria-hidden="true" />{item.label}<span>{number(item.count)}</span></button>)}</div>
            <div className="mobile-view-switch" role="group" aria-label="表示を切り替え"><button aria-pressed={mobileView === 'map'} onClick={() => setMobileView('map')}><Icon name="map" />地図と傾向</button><button aria-pressed={mobileView === 'list'} onClick={() => setMobileView('list')}><Icon name="list" />一覧 <span>{hasLoaded ? number(filtered.length) : '—'}</span></button></div>
            <div className="list-area">
              <div className="list-heading"><h2 id="events-title">イベント <span>{hasLoaded ? number(filtered.length) : '—'}件</span></h2><label className="sort-label"><span className="sr-only">並び順</span><select value={sort} onChange={event => { setSort(event.target.value as Sort); setVisibleCount(PAGE_SIZE); }}><option value="newest">観測が新しい順</option><option value="oldest">観測が古い順</option><option value="name">名前順</option></select></label></div>
              <div className="event-list" ref={list} aria-busy={loading && !hasLoaded}>
                {loading && !hasLoaded ? <div className="list-skeleton" role="status"><span className="sr-only">記録を読み込んでいます</span>{[0, 1, 2, 3].map(item => <div className="skeleton-card" key={item}><span /><span /><span /></div>)}</div> : sorted.length ? <>
                  {sorted.slice(0, visibleCount).map(event => <button key={event.id} className="event-card" aria-pressed={selected?.id === event.id} onClick={click => chooseEvent(event, click.currentTarget)}><div className="event-card-top"><span className="event-category"><i className="category-dot" style={{ background: colorFor(event.category_id) }} aria-hidden="true" />{categoryLabel(event.category_id, event.category)}</span><span className={`event-status ${event.status}`}>{STATUS_LABELS[event.status]}</span></div><span className="event-card-title">{event.title}</span><div className="event-card-bottom"><time dateTime={event.event_date ?? undefined}>{dateLabel(event.event_date)}</time>{event.latitude === null || event.longitude === null ? <span className="no-location">位置未登録</span> : <Icon name="arrow" />}</div></button>)}
                  {visibleCount < sorted.length && <button className="load-more" onClick={() => setVisibleCount(value => value + PAGE_SIZE)}>さらに{Math.min(PAGE_SIZE, sorted.length - visibleCount)}件を表示 <span>({number(visibleCount)} / {number(sorted.length)})</span></button>}
                  <p className="list-end">{number(Math.min(visibleCount, sorted.length))} / {number(sorted.length)}件を表示</p>
                </> : <div className="empty-state"><Icon name="search" /><h3>{error && !hasLoaded ? 'データを読み込めませんでした' : filteredActive ? '一致するイベントがありません' : 'この条件の記録はありません'}</h3><p>{error && !hasLoaded ? '接続を確認し、上のボタンからもう一度お試しください。' : filteredActive ? '別のキーワードや種類で探してみてください。' : '対象期間や記録の状態を変えて、もう一度お試しください。'}</p>{filteredActive && <button className="text-button" onClick={resetFilters}>絞り込みを解除</button>}</div>}
              </div>
            </div>
          </section>
          <div className="sidebar-note"><Icon name="info" /><p>「継続中」は記録上の分類です。現在の危険度を示すものではありません。</p></div>
        </aside>

        <section className="workspace" aria-label="地図とデータの傾向">
          <div className="map-card">
            <div className="summary-strip" aria-label="表示中のデータ"><div className="summary-item"><span className="summary-value">{hasLoaded ? number(filtered.length) : '—'}</span><span>表示中の記録</span></div><div className="summary-item"><span className="summary-value">{hasLoaded ? number(mapped) : '—'}</span><span>地図上の地点</span></div><div className="summary-item"><span className="summary-value">{hasLoaded ? number(visibleCategories) : '—'}</span><span>現象の種類</span></div><div className="scope-label"><span>表示中の範囲</span><strong>{appliedLabel}</strong></div></div>
            <div className="map-panel" aria-busy={loading && !hasLoaded}>
              <EventsMap events={filtered} selected={selected} onSelect={event => chooseEvent(event)} fitToken={fitToken} />
              <div className="map-top"><span className="map-pill"><Icon name="globe" />世界の観測マップ</span><button className="map-fit" disabled={!mapped} onClick={() => { setSelectedId(null); setFitToken(value => value + 1); }}><Icon name="locate" /><span>全地点を表示</span></button></div>
              {loading && !hasLoaded && <div className="map-state" role="status"><span className="loading-orbit" /><strong>地球の記録を読み込み中</strong><p>まもなく、世界の自然現象が表示されます。</p></div>}
              {!loading && !mapped && !selected && <div className="map-state"><Icon name="globe" /><strong>{error && !hasLoaded ? '記録を読み込めませんでした' : filtered.length ? '位置情報が登録されていません' : '表示する地点がありません'}</strong><p>{error && !hasLoaded ? '接続を確認し、上のボタンからもう一度お試しください。' : filtered.length ? 'イベントの詳細は一覧から確認できます。' : filteredActive ? '検索や種類の絞り込みを変えてみてください。' : '対象期間や記録の状態を確認してください。'}</p>{filteredActive && <button className="text-button" onClick={resetFilters}>絞り込みを解除</button>}</div>}
              {selected && <section ref={detail} className="map-detail" tabIndex={-1} aria-label="イベントの詳細"><button className="icon-button detail-close" aria-label="詳細を閉じる" onClick={closeDetail}><Icon name="close" /></button><div className="detail-category"><i className="category-dot" style={{ background: colorFor(selected.category_id) }} aria-hidden="true" />{categoryLabel(selected.category_id, selected.category)}<span className={`event-status ${selected.status}`}>{STATUS_LABELS[selected.status]}</span></div><h2>{selected.title}</h2><dl className="detail-facts"><div><dt>最新の観測日</dt><dd>{dateLabel(selected.event_date)}</dd></div><div><dt>観測記録</dt><dd>{number(selected.observations)}件</dd></div><div className="detail-position"><dt>記録上の位置</dt><dd>{selected.latitude === null || selected.longitude === null ? '位置情報は登録されていません' : `${Math.abs(selected.latitude).toFixed(2)}°${selected.latitude >= 0 ? 'N' : 'S'} / ${Math.abs(selected.longitude).toFixed(2)}°${selected.longitude >= 0 ? 'E' : 'W'}`}</dd></div></dl>{selected.description && <p className="detail-description">{selected.description}</p>}<div className="detail-source"><span>出典：{selected.sourceName}</span>{selected.sourceUrl ? <ExternalLink href={selected.sourceUrl}>詳しい記録を見る<Icon name="external" /></ExternalLink> : <span>出典へのリンクは未登録です</span>}</div></section>}
              <div className="map-bottom"><span>地点を選ぶと、詳しい記録が見られます</span><span>位置は概略を表示</span></div>
            </div>
            {atLimit && <div className="limit-notice"><Icon name="info" /><span>取得件数が上限の{number(MAX_EVENTS)}件に達しました。全件を含まない可能性があるため、必要に応じて対象期間を短くしてください。</span></div>}
            {hasLoaded && mapped < filtered.length && <div className="location-note">位置未登録の{number(filtered.length - mapped)}件は、一覧と集計で確認できます。</div>}
          </div>
          <EventInsights events={filtered} loading={loading} hasLoaded={hasLoaded} />
        </section>
      </div>
      <footer className="page-footer"><span>公開データから、地球を知る。</span><span>出典：<ExternalLink href="https://eonet.gsfc.nasa.gov/">NASA EONET<Icon name="external" /></ExternalLink><span className="footer-divider">·</span>NASAの非公式アプリ</span></footer>
    </main>

    <dialog ref={dialog} className="about-dialog" aria-labelledby="about-title" onClose={() => setAboutOpen(false)} onCancel={() => setAboutOpen(false)}><div className="dialog-heading"><span className="eyebrow">EARTHWATCH</span><button className="icon-button" aria-label="データについて閉じる" onClick={() => setAboutOpen(false)}><Icon name="close" /></button></div><h2 id="about-title">データについて</h2><p>NASA EONETが公開する自然現象の記録を、地図とグラフで探索するアプリです。</p><dl className="about-facts"><div><dt>記録の状態</dt><dd>「継続中」「終了」はデータ提供元による管理上の分類です。現在の危険度や被害の大きさを表すものではありません。</dd></div><div><dt>観測日と位置</dt><dd>各イベントの最新の観測日を世界標準時（UTC）で表示します。地点は概略の代表位置で、現象の範囲や衛星画像ではありません。</dd></div><div><dt>データの範囲</dt><dd>1回に読み込める記録は最大{number(MAX_EVENTS)}件です。地図とグラフは読み込んだ記録に検索・種類の条件を反映しています。すべての自然災害を網羅するものではありません。</dd></div><div><dt>情報の利用</dt><dd>リアルタイムの災害警報を提供するものではありません。防災情報は地域の公的な情報源を確認してください。</dd></div></dl><ExternalLink className="about-source" href="https://eonet.gsfc.nasa.gov/">NASAのデータ提供元へ<Icon name="external" /></ExternalLink><p className="about-footnote">NASAの公式アプリではありません。</p></dialog>
  </div>;
}
