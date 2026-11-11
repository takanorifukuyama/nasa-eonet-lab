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

// Null-only columns must have the same types as populated columns.
const columns = [
  ['id', 'VARCHAR'], ['title', 'VARCHAR'], ['category', 'VARCHAR'],
  ['category_id', 'VARCHAR'], ['event_date', 'VARCHAR'],
  ['latitude', 'DOUBLE'], ['longitude', 'DOUBLE'], ['status', 'VARCHAR'],
  ['source_count', 'INTEGER'], ['observations', 'INTEGER']
] as const;
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
  private workerFailure: Promise<never> | null = null;
  private initializing: Promise<void> | null = null;
  private fileVersion = 0;

  async init(): Promise<void> {
    if (this.conn) return;
    if (this.initializing) return this.initializing;
    this.initializing = this.initialize();
    try {
      await this.initializing;
    } finally {
      this.initializing = null;
    }
  }

  private async initialize(): Promise<void> {
    try {
      const bundle = await duckdb.selectBundle(bundles);
      this.worker = new Worker(bundle.mainWorker!, { type: 'classic' });
      this.workerFailure = new Promise<never>((_, reject) => {
        const failed = () => reject(new Error('Analysis worker stopped'));
        this.worker!.addEventListener('error', failed, { once: true });
        this.worker!.addEventListener('messageerror', failed, { once: true });
      });
      // Also handle a failure between operations; the next operation will
      // observe this same rejected promise and recover through the retry UI.
      void this.workerFailure.catch(() => undefined);
      this.db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), this.worker);
      await this.run(this.db.instantiate(bundle.mainModule, bundle.pthreadWorker));
      this.conn = await this.run(this.db.connect());
    } catch (error) {
      await this.close().catch(() => undefined);
      throw error;
    }
  }

  private async run<T>(operation: Promise<T>, timeoutMs = 30_000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Analysis timed out')), timeoutMs);
    });
    try {
      return await Promise.race(this.workerFailure
        ? [operation, timeout, this.workerFailure]
        : [operation, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  // The caller serializes imports and queries on this single connection.
  async load(events: EventRow[]): Promise<void> {
    if (!this.conn || !this.db) throw new Error('Analysis is not initialized');
    if (!events.length) {
      await this.run(this.conn.query(`CREATE OR REPLACE TABLE events (
        ${columns.map(([name, type]) => `${name} ${type}`).join(', ')}
      )`));
      return;
    }
    const rows = events.map(({id,title,category,category_id,event_date,latitude,longitude,status,source_count,observations}) => ({
      id,title,category,category_id,event_date,latitude,longitude,status,source_count,observations
    }));
    const filename = `eonet-${++this.fileVersion}.json`;
    await this.run(this.db.registerFileText(filename, JSON.stringify(rows)));
    try {
      await this.run(this.conn.insertJSONFromPath(filename, {
        name: 'incoming_events', schema: 'main', create: true
      }));
      // The importer infers null-only fields as integers and may reorder
      // columns. Normalize by field name into a fixed schema before querying.
      // This uses the bundled importer and needs no downloaded extensions.
      await this.run(this.conn.query(`CREATE OR REPLACE TABLE events AS SELECT
        ${columns.map(([name, type]) => `CAST(${name} AS ${type}) AS ${name}`).join(', ')}
        FROM incoming_events`));
    } finally {
      // Filtering/reloading must not retain one virtual file per import.
      try {
        await this.run(this.conn.query('DROP TABLE IF EXISTS incoming_events'), 1_000);
      } finally {
        await this.run(this.db.dropFile(filename), 1_000);
      }
    }
  }
  async query(query: string): Promise<SqlResults> {
    if (!this.conn) throw new Error('Analysis is not initialized');
    if (!/^\s*(SELECT|WITH)\b/i.test(query)) throw new Error('Only read queries are supported');
    const started = performance.now();
    const result = await this.run(this.conn.query(query));
    const columns = result.schema.fields.map(field => field.name);
    const raw = result.toArray();
    // Preserve all groups so every displayed event is included in the charts.
    const rows = raw.map(row => {
      const value = row.toJSON() as Record<string, unknown>;
      return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, val == null ? '' : String(val)]));
    });
    return { columns, rows, count: raw.length, elapsedMs: Math.round(performance.now()-started) };
  }
  async close(): Promise<void> {
    const conn = this.conn;
    const db = this.db;
    const worker = this.worker;
    this.conn = null;
    this.db = null;
    this.worker = null;
    try {
      if (conn) await this.run(conn.close(), 1_000);
    } finally {
      try {
        await db?.terminate();
      } finally {
        worker?.terminate();
        this.workerFailure = null;
      }
    }
  }
}
