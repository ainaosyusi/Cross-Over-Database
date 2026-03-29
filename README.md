# CrossOverデータベース

![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6%2B-F7DF1E?logo=javascript&logoColor=black)
![PHP](https://img.shields.io/badge/PHP-8.x-777BB4?logo=php&logoColor=white)
![Chart.js](https://img.shields.io/badge/Chart.js-4.x-FF6384?logo=chartdotjs&logoColor=white)
![yt-dlp](https://img.shields.io/badge/yt--dlp-latest-FF0000?logo=youtube&logoColor=white)
![License](https://img.shields.io/badge/License-Private-gray)

大学軽音サークル「Cross Over」のYouTubeプレイリストから演奏データを自動収集・解析し、メンバーの演奏統計をWebダッシュボードとして提供するツールです。

## 概要

YouTubeに公開されている全58プレイリスト（ライブイベント）の動画概要欄を解析し、以下の情報を自動抽出・集計しています：

- **メンバー情報** — 学年、パート、名前、学部学科
- **セットリスト** — 曲名、アーティスト名
- **バンド構成** — 各動画のメンバー編成
- **視聴回数** — YouTube API経由の再生回数

抽出したデータをもとに、各種ランキングや個人統計を閲覧できるWebダッシュボードを生成します。

## 機能

### ランキング
| ランキング | 内容 |
|---|---|
| バンド数 | 出演バンド数の多い人 |
| 曲数 | 演奏した曲数の多い人 |
| 多様性 | 演奏アーティストの種類が多い人 |
| 人気曲 / 人気アーティスト | 演奏回数の多い曲・アーティスト |
| ベストコンビ | 同じバンドで共演した回数が多いペア |
| 視聴回数 | 再生回数の多い動画と、その出演者の累計視聴回数 |
| トリ率 | イベント最終バンド（トリ）を務めた割合 |
| 交流度 | 共演したユニークな人数 |
| イベント一覧 | 各プレイリスト（ライブイベント）の統計 |
| パート別 | パートごとの出演回数と担当メンバー一覧 |
| 学年別 | 各学年のメンバー数・人気アーティスト・アクティブメンバー |
| 初出演 | 最新メンバー順 |

### インタラクティブ機能
- **メンバー検索** — 名前・曲名・アーティスト名で検索（2文字以上でサジェスト）
- **アーティスト詳細** — 演奏回数メンバーランキング・関連アーティスト表示
- **曲詳細** — その曲の全演奏動画一覧
- **イベントリンク** — イベント名タップでYouTubeプレイリストへ遷移
- **パート展開** — パート名タップでそのパートの全メンバーを最高学年順に表示
- **音楽傾向チャート** — メンバー別のジャンルレーダーチャート
- **掲示板** — サーバー共有型の投稿機能
- **戻るボタン** — 画面遷移の履歴を保持し、前の画面に戻れる

### データ品質管理
- **名前の表記揺れ統合** — 旧字体（髙→高、﨑→崎等）、ニックネーム、不完全な名前を正規名に統一
- **アーティスト名の正規化** — 100件以上の表記揺れ・誤記・括弧の断片を統一
- **ゴミデータ除去** — 末尾の数字漏れ、先頭のドット、二重学年、非公開接頭辞等を自動修正
- **学部学科情報** — 学籍番号・自己紹介・予約データから266名分の学部学科を抽出

## 技術構成

```
keion-stats/
├── src/keion_stats/       # Pythonバックエンド
│   ├── fetcher.py         #   yt-dlpでYouTubeメタデータ取得
│   ├── youtube_api.py     #   YouTube Data API v3 クライアント
│   ├── parser.py          #   概要欄の正規表現パース
│   ├── stats.py           #   統計計算ロジック
│   ├── models.py          #   データモデル定義
│   ├── json_export.py     #   Web用JSONエクスポート
│   ├── excel_export.py    #   Excel形式エクスポート
│   └── config.py          #   設定・パス定義
├── scripts/               # 実行スクリプト
│   ├── fetch_all.py       #   全プレイリストのデータ取得（yt-dlp版）
│   ├── fetch_api.py       #   全プレイリストのデータ取得（YouTube API版）
│   └── generate_stats.py  #   統計計算・JSON/Excel生成
├── data/                  # データファイル（※個人情報含むため非公開）
│   ├── artist_aliases.json    # アーティスト表記揺れマッピング
│   ├── name_aliases.json      # メンバー名表記揺れマッピング（非公開）
│   ├── department_map.json    # 学部学科マッピング（非公開）
│   ├── video_overrides.json   # 手動上書きデータ
│   ├── genre_map.json         # アーティスト→ジャンルマッピング
│   └── raw/                   # YouTube生データキャッシュ（非公開）
├── web/                   # 静的Webフロントエンド
│   ├── index.html
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js         #   メインアプリケーション
│   │   └── auth.js        #   パスワード認証（非公開）
│   ├── api/
│   │   └── board.php      #   掲示板API（PHP）
│   └── data/              #   生成されたJSONデータ（非公開）
└── pyproject.toml         # プロジェクト設定
```

### 使用技術
- **バックエンド**: Python 3.10+
- **データ取得**: yt-dlp / YouTube Data API v3
- **テキスト解析**: 正規表現 + NFKC正規化
- **フロントエンド**: Vanilla JavaScript（フレームワーク不使用）, Chart.js
- **掲示板**: PHP（JSONファイルベース）
- **ホスティング**: 独自サーバー（Apache）
- **認証**: SHA-256クライアントサイドハッシュ比較（簡易保護）

## セットアップ

### 前提条件
- Python 3.10以上

### インストール

```bash
git clone https://github.com/ainaosyusi/Cross-Over-statistics.git
cd Cross-Over-statistics
pip install -e .
```

### データ取得・統計生成

```bash
# 1. YouTubeプレイリストからデータ取得（yt-dlp版）
python scripts/fetch_all.py --from-file playlist_URL.md

# 1'. YouTube Data API版（要: .envにYOUTUBE_API_KEY設定）
python scripts/fetch_api.py --from-file playlist_URL.md

# 2. 統計計算・JSON/Excel生成
python scripts/generate_stats.py

# 3. ローカルプレビュー
python -m http.server 8080 --directory web
```

## プライバシーについて

このリポジトリではサークルメンバーのプライバシーに配慮しています：

- **メンバーの実名データ**（`data/name_aliases.json`, `data/raw/`, `web/data/`, `tests/`）は`.gitignore`で除外され、リポジトリには含まれません
- **認証ファイル**（`web/js/auth.js`）も非公開です
- **学籍番号は一切サイトに表示しません**（学部学科名のみ使用）
- **Webサイト**はパスワード保護されており、検索エンジンにインデックスされないよう `noindex, nofollow` を設定しています
- 公開されているのはソースコード（パース・統計ロジック）とアーティスト名の表記揺れマッピングのみです

## ライセンス

Private - サークル内利用
