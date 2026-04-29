# SSI-AI — アイデアバリデーター（日本市場向け）

> **開発者向けドキュメント** — コラボレーター参照用  
> Google Trends × 楽天市場 × YouTube × Claude AI × Gemini AI

---

## 目次

1. [プロジェクト概要](#1-プロジェクト概要)
2. [ディレクトリ構成](#2-ディレクトリ構成)
3. [セットアップ手順（ローカル）](#3-セットアップ手順ローカル)
4. [Vercel デプロイ手順](#4-vercel-デプロイ手順)
5. [APIキーの取得方法](#5-apiキーの取得方法)
6. [環境変数一覧](#6-環境変数一覧)
7. [BYOK 設定方法（ブラウザ画面）](#7-byok-設定方法ブラウザ画面)
8. [月額予算 ¥3,000 上限の管理](#8-月額予算3000-上限の管理)
9. [セキュリティ設計](#9-セキュリティ設計)
10. [よくある質問 / トラブルシューティング](#10-よくある質問--トラブルシューティング)

---

## 1. プロジェクト概要

SSI-AI は、日本市場に特化したビジネスアイデア検証ツールです。  
キーワードを入力するだけで、以下を自動生成します：

| 機能 | 使用API |
|---|---|
| Google トレンド分析（過去12ヶ月・日本） | SerpAPI |
| 楽天市場 需要・競合価格データ | 楽天 Web サービス |
| YouTube Japan トレンド動画 | YouTube Data API v3 |
| AIビジネスプラン生成 | Groq (llama-3.3-70b) |
| AIウェブサイト生成 | **Claude Haiku (BYOK)** |
| 補助AI分析 | **Gemini 1.5 Flash (BYOK)** |

**BYOK（Bring Your Own Key）** モデルを採用しています。  
各メンバーが自分のAPIキーを使うため、料金は個人負担となります。

---

## 2. ディレクトリ構成

```
ssi-ai/
├── public/
│   └── index.html          # フロントエンド（単一HTMLファイル）
├── api/
│   ├── analyze.js          # メイン分析エンドポイント
│   ├── proxy.js            # Claude/RESAS 用 CORSプロキシ（ゼロログ）
│   ├── rakuten.js          # 楽天市場 API
│   ├── youtube.js          # YouTube Data API
│   ├── google-trends.js    # Google Trends（SerpAPI経由）
│   ├── health.js           # ヘルスチェック
│   └── lib/
│       └── helpers.js      # 共通ヘルパー関数
├── vercel.json             # Vercel ルーティング設定
├── package.json            # 依存関係
└── README.md               # このファイル
```

---

## 3. セットアップ手順（ローカル）

### 前提条件

- **Node.js 20.x** 以上
- **Vercel CLI** (`npm install -g vercel`)
- Git

### 手順

```bash
# 1. リポジトリをクローン
git clone https://github.com/your-org/ssi-ai.git
cd ssi-ai

# 2. 依存関係をインストール
npm install

# 3. 環境変数を設定（.env.local を作成）
cp .env.example .env.local
# .env.local を編集してAPIキーを設定（下記「環境変数一覧」参照）

# 4. ローカルで起動
vercel dev
# → http://localhost:3000 でアクセス可能

# 5. ブラウザで ⚙ ボタンをクリックしてBYOKキーを設定
```

---

## 4. Vercel デプロイ手順

```bash
# 初回デプロイ（プロジェクト作成）
vercel

# 本番デプロイ
vercel --prod

# 環境変数の設定（Vercel ダッシュボード or CLI）
vercel env add SERPAPI_KEY
vercel env add RAKUTEN_APP_ID
vercel env add YOUTUBE_API_KEY
vercel env add GROQ_API_KEY
```

**重要：** デプロイ後、`api/proxy.js` の `ALLOWED_ORIGINS` に本番URLを追加してください：

```javascript
// api/proxy.js
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'https://your-project.vercel.app',  // ← ここを変更
  'https://your-custom-domain.com',   // カスタムドメインがある場合
]);
```

---

## 5. APIキーの取得方法

### 🟢 Gemini API（無料）
1. [Google AI Studio](https://aistudio.google.com/app/apikey) にアクセス
2. 「Create API Key」をクリック
3. 生成されたキーを ⚙ 設定画面に入力

### 🟡 Claude API（BYOK・有料）
1. [Anthropic Console](https://console.anthropic.com/settings/keys) にアクセス
2. 「Create Key」でAPIキーを生成
3. **必ず月額上限を設定してください**（下記参照）
4. 生成されたキー (`sk-ant-api03-...`) を ⚙ 設定画面に入力

### 🔴 楽天市場 App ID（無料）
1. [楽天ウェブサービス](https://webservice.rakuten.co.jp/) に登録（無料）
2. アプリケーション登録 → App ID を取得
3. ⚙ 設定画面の「Rakuten Ichiba」欄に入力

### 🔵 RESAS API（無料）
1. [RESAS API 申請ページ](https://opendata.resas-portal.go.jp/form.html) から申請
2. メールで届いたAPIキー（UUID形式）を ⚙ 設定画面に入力
3. **注意：** RESAS はブラウザからの直接アクセス不可のため、`/api/proxy` 経由で使用

---

## 6. 環境変数一覧

Vercel ダッシュボード → Settings → Environment Variables に設定します。  
これらはサーバーサイドのAPI（analyze.js等）で使用されます。

| 変数名 | 必須 | 説明 |
|---|---|---|
| `SERPAPI_KEY` | 推奨 | Google Trends データ取得（未設定時はモックデータ） |
| `RAKUTEN_APP_ID` | 推奨 | 楽天市場データ（未設定時はモックデータ） |
| `YOUTUBE_API_KEY` | 推奨 | YouTube キーワード検索（未設定時はモック） |
| `GROQ_API_KEY` | 推奨 | AIビジネスプラン生成 llama-3.3-70b（未設定時はモック） |
| `CLAUDE_API_KEY` | 推奨 | Claude 3.5 Sonnet サイト生成（未設定時はGroqフォールバック） |
| `YAHOO_CLIENT_ID` | 任意 | Yahoo! ショッピングJP 価格・需要データ |
| `HOT_PEPPER_KEY` | 任意 | Hot Pepper グルメ集客データ |

> **⚠ e-Stat 統計ダッシュボードは API キー不要です**  
> `https://dashboard.e-stat.go.jp/api` は登録なしで誰でも使えます。  
> 環境変数の設定は不要 — `analyze.js` が直接呼び出します。  
> 約6,000系列（就業・住宅・産業・物価・人口など）を提供。

**BYOKキー（ユーザーがブラウザ⚙で設定）:**  
`GEMINI_API_KEY` のみ — ユーザーが設定画面から入力します。  
`CLAUDE_API_KEY` はサーバー側（Vercel環境変数）で管理します。

---

## 7. BYOK 設定方法（ブラウザ画面）

1. **⚙ ボタン**（ヘッダー右上）をクリック
2. **「API Keys」タブ**を選択
3. **マスターパスワードを設定**
   - 任意のパスワードを入力 → 「Unlock」ボタンをクリック
   - このパスワードはキーの暗号化（AES-256-GCM）に使用されます
   - **ブラウザを閉じるたびに再入力が必要です**（パスワード自体は保存されません）
4. 各APIキーを入力 → **「Save」ボタン**で暗号化保存
5. 「**▷ Test**」ボタンで接続確認
6. 緑色の ✓ が表示されれば設定完了

### マスターパスワードを忘れた場合

⚙ 設定 → 「Clear All Keys」で全キーを削除し、再設定してください。  
（暗号化キーはパスワードなしでは復元不可能です）

---

## 8. 月額予算 ¥3,000 上限の管理

**この機能は二段構えになっています。**

### ① ハードキャップ（Anthropic Console）— 必須設定

> これが唯一の「絶対に止まる」保証です。

1. [console.anthropic.com](https://console.anthropic.com/) にログイン
2. **Settings → Billing → Limits**
3. **「Monthly Budget」を $18.00** に設定（≈ ¥2,800〜¥3,000）
4. 上限到達時、APIキーが自動的に無効化されます

### ② ソフトキャップ（アプリ内 Budget Tracker）— 警告システム

⚙ 設定 → **「Budget (¥3,000)」タブ**で確認できます。

| 項目 | 内容 |
|---|---|
| コスト単価 | 約 ¥9.10 / 検索（5,000トークン換算） |
| 月間上限 | ¥3,000 |
| 保存場所 | `localStorage`（ブラウザ内） |
| リセット | 毎月自動リセット（年月で管理） |
| 警告 | 上限到達時、Claudeを無効化してGemini（無料）を推奨 |

**注意：** `localStorage` のデータはブラウザをクリアすると消えます。  
あくまで「参考数値」として使用し、Anthropic Console の設定を必ず行ってください。

---

## 9. セキュリティ設計

### キーの保存方式（AES-256-GCM）

```
ユーザーパスワード
    ↓ PBKDF2 (SHA-256, 200,000回反復)
AES-256-GCM CryptoKey（メモリのみ、localStorage非保存）
    ↓ 暗号化 (ランダムIV 12byte)
localStorage: "iv_hex:ciphertext_hex"
```

- DevTools で localStorage を見ても、暗号化済みの16進数文字列のみ表示されます
- マスターパスワードがなければ復号不可能

### CORSプロキシ（/api/proxy.js）

| 項目 | 仕様 |
|---|---|
| ログ | APIキー・リクエストボディは**一切ログしない** |
| 認証 | `ALLOWED_ORIGINS` に含まれないOriginは403返却 |
| タイムアウト | 25秒 |
| パス検証 | `../` などのパストラバーサルを拒否 |

### Content Security Policy（CSP）

`<meta http-equiv="Content-Security-Policy">` により、  
許可されていないドメインへのfetchを**ブラウザレベルでブロック**します。

---

## 10. よくある質問 / トラブルシューティング

### Q. ⚙ を押してもキーが保存されない
**A.** マスターパスワードを入力して「Unlock」してからキーを入力してください。  
Unlock前はキーを保存できません。

### Q. Claude の「▷ Test」でエラーが出る
**A.** 以下を確認してください：
1. `/api/proxy.js` の `ALLOWED_ORIGINS` にアクセス元URLが含まれているか
2. Vercel にデプロイ済みか（`vercel dev` でローカル動作確認）
3. Claude APIキーが `sk-ant-api03-` で始まっているか

### Q. RESAS APIで「Upstream connection failed」が出る
**A.** RESAS APIはCORSに対応していないため、`/api/proxy` 経由での使用が必須です。  
プロキシが正常にデプロイされているか確認してください。

### Q. 「月額¥3,000上限に達しました」と表示される
**A.** ⚙ → Budget タブ → 「↺ Reset Month」をクリックしてください。  
ただし、新しい請求期間（月）が始まった場合のみリセットしてください。  
Anthropic Consoleの実際の使用量も必ず確認してください。

### Q. サイト生成でGeminiフォールバックになる
**A.** Claude APIキーが未設定、または月額上限に達した場合、  
自動的にフォールバックHTML（Geminiなし）が表示されます。  
⚙ 設定でClaudeキーを確認してください。

### Q. ローカルでは動くがVercelで動かない
**A.** Vercelの環境変数（`SERPAPI_KEY`等）が設定されているか確認してください：
```bash
vercel env ls
```

---

## コントリビューション

```bash
# ブランチを作成
git checkout -b feature/your-feature

# 変更をコミット
git add .
git commit -m "feat: 機能の説明"

# プッシュ
git push origin feature/your-feature

# Pull Requestを作成
```

---

## ライセンス

MIT License — © 2026 SSI-AI / sudu

---

*最終更新: 2026年4月 · 問い合わせ: GitHubのIssueを使用してください*
