# EARTHWATCH / NASA EONET Lab

![MIT](https://img.shields.io/badge/license-MIT-blue.svg)

NASA の [EONET v3](https://eonet.gsfc.nasa.gov/docs/v3) オープンデータを使った、**Rust + React + Tauri 2 + DuckDB-Wasm** の学習用デスクトップアプリです。NASA Space Apps Challenge 2026への応募作品とは独立した、技術練習用OSSです。

## 技術構成

```text
NASA EONET v3 (JSON / HTTPS)
  │
  ▼
Tauri 2 / Rust (reqwest, TLS, timeout, parameter validation)
  │  invoke('fetch_eonet')
  ▼
React + TypeScript
  ├─ Leaflet: 自然現象を地図表示
  └─ DuckDB-Wasm: WebView内にJSONを取り込み、ローカルSQL集計
```

- **Rust バックエンド**：固定された NASA EONET エンドポイントにアクセス。任意URLへのアクセスは不可。
- **React フロントエンド**：イベント検索・カテゴリフィルター・地図・詳細パネル。
- **DuckDB-Wasm**：収集データのSQL集計。BigQuery・外部DBは不要。
- **Tauri 2**：Mac / Windows / Linux 向けデスクトップ実行基盤。
- **MIT License**：アプリの自作コードをMITで公開。NASA・地図タイル・依存ライブラリはそれぞれの条件に従います。

## ローカル起動

**前提**：Node.js 20.19+ または 22.12+、npm、Rust stable + Cargo、Tauri 2 開発環境。macOSではXcode Command Line Toolsが必要です。LinuxではTauri依存のWebKitGTK等も必要です。

```bash
npm install
npm run tauri dev
```

静的なReactアプリだけの `npm run dev` では、Rustコマンドが存在しないためNASAデータを取得できません。Tauri経由で起動してください。

```bash
npm run build      # TypeScript + Vite の検証・バンドル
npm run tauri build  # プラットフォームごとのデスクトップパッケージ生成
```

## 操作

1. 対象期間（30 / 90 / 365日）と EONETイベント状態を指定。
2. `NASA APIから取得` を押すと Rust がNASAのJSONを取得。
3. Reactの地図・リストからイベントを調べる。
4. DuckDB-Wasmでカテゴリ別・日別・南北半球別のSQL集計を実行。SQL編集も可能。

```sql
SELECT category, COUNT(*) AS events
FROM events
GROUP BY category
ORDER BY events DESC;
```

## データの注意点

- [EONET](https://eonet.gsfc.nasa.gov/) は自然現象の**イベント索引**です。すべての災害や現時点での被害を網羅するものではありません。
- `open` はEONETの管理状態であり、リアルタイム危険情報と同義ではありません。
- Polygon等のGeometryは地図表示用の**概略代表点**に変換します。面積や正確な地理解析に使用しないでください。
- 1回のAPI取得は最大700件。700件に達した場合は結果が途中で切れている可能性があります。
- DuckDBはWebView内のみで処理し、アプリはデータを永続保存しません。
- 地図タイルはオンラインのCARTO / OpenStreetMapを使用します。

## 今後の練習

- EONET GeoJSON の面・線をマップへ描画
- NASA GIBS 衛星画像とイベント情報を重ねる
- Parquet と地理空間SQLを試す
- NASAのDEM/GeoTIFFに進む（GDALなどの地理空間処理ツールを検討）

## 検証状況

構成ファイル（JSON）とコードの静的検査は実施可能ですが、制作環境ではnpmの依存パッケージ取得とRustツールチェーンが利用できず、TauriアプリのネイティブビルドとAPIの動作確認は未実施です。ローカル環境で上記コマンドを実行して確認してください。

## License

Source code: [MIT](LICENSE). This is an independent educational project and is not affiliated with or endorsed by NASA.

## 個人GitHubに公開する

GitHub CLIで本人アカウントにログイン済みなら、リポジトリ未作成の状態から以下で公開できます。

```bash
cd nasa-eonet-tauri
./publish-personal.sh
```

`git config user.name` / `git config user.email` は事前に設定してください。公開先は `takanorifukuyama/nasa-eonet-lab` に固定してあり、組織には作成しません。リポジトリ作成済みの場合にはこのスクリプトを再実行しないでください。
