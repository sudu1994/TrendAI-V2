# SSI-AI Corporate Edition — アーキテクチャガイド

> **BYOK → 会社負担 Internal Validation Platform** へのリファクタリング

---

## 変更サマリー

| 項目 | Before (BYOK) | After (Corporate) |
|---|---|---|
| APIキー管理 | 各自のブラウザに暗号化保存 | サーバー側 `ANTHROPIC_CORP_KEY` (Vercel env) |
| Claude呼び出し | 常時 (線形フロー) | スコア≥70 かつ 予算残あり の場合のみ |
| コスト負担 | 個人負担 | 会社負担 (¥3,000/月上限) |
| 使用者追跡 | なし | `UsageTracker` — userId別ログ |
| 品質ゲート | なし | ValidationScore 0–100 (Phase 2) |

---

## ハイブリッドフロー

```
ユーザー入力 → キーワード
        │
        ▼
┌─────────────────────────────┐
│  PHASE 1 — FREE LAYER (¥0) │
│  SerpAPI / Rakuten / YouTube│
│  Yahoo! / Groq Llama-3.3   │
│  Groq HTML fallback生成     │
└────────────┬────────────────┘
             │
             ▼
┌─────────────────────────────┐
│  PHASE 2 — GATEKEEPER       │
│  ValidationScore (0-100)    │
│  ┌─────────────────────┐    │
│  │ score < 70          │    │
│  │  → Groq HTML表示    │    │  (¥0)
│  │  → Claude ボタン🔒  │    │
│  └─────────────────────┘    │
│  ┌─────────────────────┐    │
│  │ score ≥ 70          │    │
│  │  → BudgetCheck      │    │
│  └──────────┬──────────┘    │
└─────────────┼───────────────┘
              │
     ┌────────┴────────┐
     │                 │
   budget            budget
   allowed           capped
     │                 │
     ▼                 ▼
┌─────────┐     ┌──────────────┐
│ PHASE 3 │     │ Groq HTML表示│ (¥0)
│ PAID    │     │ Claude🚫表示 │
│ Claude  │     └──────────────┘
│ Haiku   │
│ ~¥45/回 │
│ trackUsage(userId)
└─────────┘
```

---

## 新規ファイル

### `api/lib/budget.js` — BudgetMonitor
```javascript
// 月次支出を /tmp/ssi_budget.json に記録
checkBudget()        // → { allowed: bool, remainingJpy, totalSpendJpy }
trackUsage(userId, feature)  // → 支出ログ追記
getBudgetSummary()   // → 管理者向けサマリー
```

**本番では `/tmp` を Redis / Supabase / DynamoDB に置き換えてください。**

### `api/lib/validator.js` — Gatekeeper
```javascript
computeValidationScore(trend, rakuten, youtube, yahoo)
// → { score: 0-100, unlocksPaidLayer: bool, breakdown: {...}, verdict: string }
```

スコア配点:
| ソース | 配点 |
|---|---|
| Google Trends recentAvg | 35pt |
| 楽天需要レベル | 30pt |
| YouTube 動画ボリューム | 20pt |
| Yahoo! Shopping 出品数 | 15pt |

### `api/budget-status.js` — 管理者エンドポイント
```
GET /api/budget-status
Header: x-admin-key: <ADMIN_SECRET>

Response:
{
  month: "2026-04",
  totalSpendJpy: 450,
  capJpy: 3000,
  remainingJpy: 2550,
  usagePct: 15,
  callCount: 10,
  byUser: { "alice@co.jp": 135, "bob@co.jp": 315 }
}
```

---

## Vercel 環境変数 (必須)

| 変数名 | 説明 |
|---|---|
| `ANTHROPIC_CORP_KEY` | **会社共通** Anthropic APIキー (`sk-ant-api03-...`) |
| `GROQ_API_KEY` | Groq APIキー (Phase 1 · 無料枠大) |
| `SERPAPI_KEY` | Google Trends |
| `RAKUTEN_APP_ID` | 楽天市場 |
| `YOUTUBE_API_KEY` | YouTube Data API v3 |
| `YAHOO_CLIENT_ID` | Yahoo! Shopping |
| `ADMIN_SECRET` | `/api/budget-status` 保護キー |

**ユーザー側のBYOK設定は不要になりました。**  
旧 `CLAUDE_API_KEY` は `ANTHROPIC_CORP_KEY` に名称変更してください。

---

## Claude プロンプト最適化 (トークン削減)

**Before:** ~2,500 input tokens (Sonnet)  
**After:** ~1,200 input tokens (Haiku) → **コスト約10分の1**

主な削減手法:
1. **Groqが生成したcopyを再利用** — Claude はレンダリングのみ担当
2. **systemプロンプトを最小化** — 1行に凝縮
3. **モデルを Haiku に変更** — 品質は許容範囲内で大幅コスト削減
4. **不要なフィールドを排除** — コンテキストを必要最低限に

推定コスト: **¥10〜¥50 / 成功実行** (目標範囲内)

---

## UIロック仕様 (index.html)

Claude ボタンは以下の3状態を持ちます:

```
状態A — LOCKED (スコア不足)
  class="btn-claude locked" + disabled
  ::before { content: '🔒 ' }
  background: rgba(255,255,255,.04) — 視覚的に無効

状態B — UNLOCKED (スコア≥70 かつ予算あり)
  class="btn-claude unlocked" + enabled
  ::before { content: '✨ ' }
  animation: unlockGlow 2s infinite — 視覚的に際立つ

状態C — BUDGET CAPPED (予算上限)
  class="btn-claude budget-capped" + disabled
  ::before { content: '🚫 ' }
  background: rgba(239,68,68,.1)
```

ボタンはサーバーレスポンスの `validation.unlocksPaidLayer` と
`budgetStatus.allowed` に基づいてクライアントサイドで動的に切り替わります。
サーバー側でも `if (!validation.unlocksPaidLayer)` で二重にガードしています。

---

## UsageTracker — ユーザー識別

`x-user-id` リクエストヘッダーでユーザーを識別します。
実装オプション:

```javascript
// Option A: Vercel + Clerk/NextAuth middleware
// middleware.js (Vercel Edge)
export function middleware(req) {
  const token = getToken(req); // JWT検証
  req.headers.set('x-user-id', token.email);
}

// Option B: 社内SSO (Azure AD / Google Workspace)
// APIゲートウェイでヘッダーを付与

// Option C: 簡易 (開発環境)
// フロントエンドでlocalStorage.getItem('userId')をヘッダーに付与
```

---

## Anthropic Console ハードキャップ設定 (必須)

ソフトキャップ(アプリ内)だけでは不十分です。必ず設定してください:

1. https://console.anthropic.com → Settings → Billing → Limits  
2. Monthly Budget = **$18.00** (≈ ¥2,800)  
3. Email alert at **$12.00** (¥1,800 = 60%)

---

*SSI-AI Corporate Edition v4.0 · 2026*
