import * as duckdb from '@duckdb/duckdb-wasm';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import type { EventRow } from './eonet';

const bundles: duckdb.DuckDBBundles = {
  mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
  eh: { mainModule: ehWasm, mainWorker: ehWorker }
};
export const PRESETS = {
  category: 'SELECT category, COUNT(*) AS events FROM events GROUP BY category ORDER BY events DESC',
  daily: 'SELECT SUBSTR(event_date, 1, 10) AS day, COUNT(*) AS events FROM events WHERE event_date IS NOT NULL GROUP BY day ORDER BY day DESC LIMIT 20',
  hemisphere: "SELECT CASE WHEN latitude >= 0 THEN 'Northern' ELSE 'Southern' END AS hemisphere, COUNT(*) AS events FROM events WHERE latitude IS NOT NULL GROUP BY hemisphere",
  recent: 'SELECT title, category, event_date, latitude, longitude FROM events ORDER BY event_date DESC LIMIT 15'
};
export type SqlResults = { columns: string[]; rows: Record<string, string>[]; count: number; elapsedMs: number };
export class LocalSql {
  private db: duckdb.AsyncDuckDB | null = null;
  private conn: duckdb.AsyncDuckDBConnection | null = null;
  private worker: Worker | null = null;
  private fileVersion = 0;

  async init(): Promise<void> {
    if (this.conn) return;
    const bundle = await duckdb.selectBundle(bundles);
    this.worker = new Worker(bundle.mainWorker!, { type: 'classic' });
    this.db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), this.worker);
    await this.db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    this.conn = await this.db.connect();
  }
  async load(events: EventRow[]): Promise<void> {
    if (!this.conn || !this.db) throw new Error('DuckDB is not initialized');
    await this.conn.query('DROP TABLE IF EXISTS events');
    if (!events.length) {
      await this.conn.query('CREATE TABLE events (id VARCHAR, title VARCHAR, category VARCHAR, category_id VARCHAR, event_date VARCHAR, latitude DOUBLE, longitude DOUBLE, status VARCHAR, source_count INTEGER, observations INTEGER)');
      return;
    }
    const rows = events.map(({id,title,category,category_id,event_date,latitude,longitude,status,source_count,observations}) => ({
      id,title,category,category_id,event_date,latitude,longitude,status,source_count,observations
    }));
    const filename = `eonet-${++this.fileVersion}.json`;
    await this.db.registerFileText(filename, JSON.stringify(rows));
    await this.conn.insertJSONFromPath(filename, { name:'events', schema:'main' });
  }
  async query(query: string): Promise<SqlResults> {
    if (!this.conn) throw new Error('DuckDB is not initialized');
    if (!/^\s*(SELECT|WITH)\b/i.test(query)) throw new Error('SELECT / WITH のみ実行できます');
    const started = performance.now();
    const result = await this.conn.query(query);
    const columns = result.schema.fields.map(field => field.name);
    const raw = result.toArray();
    const rows = raw.slice(0,100).map(row => {
      const value = row.toJSON() as Record<string, unknown>;
      return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, val == null ? '—' : String(val)]));
    });
    return { columns, rows, count: raw.length, elapsedMs: Math.round(performance.now()-started) };
  }
  async close() {
    await this.conn?.close();
    await this.db?.terminate();
    this.worker?.terminate();
    this.conn = null; this.db = null; this.worker = null;
  }
}
