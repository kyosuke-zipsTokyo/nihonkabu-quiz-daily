# 毎朝のトレードクイズ

GitHub Actionsの定期実行（cron）で、毎朝Claude APIに短中期トレード向けの日本株クイズ10問＋米国市場中心のニュース10本を生成させ、GitHub Pagesの1ページとして公開し、そのURLをGmailでメール送信します。

- 生成・公開・送信スクリプト: `generate-and-send.mjs`
- ページのデザイン/挙動: `template.html`（クリック回答式、チャート表示、結果画面、ニュース一覧）
- 定期実行: `.github/workflows/daily-quiz.yml`（毎日 21:00 UTC = 06:00 JST）
- 出題後5日間は同じ問題を出題しない（`history.json` で管理、5日より古い記録は自動削除）

## セットアップ手順

### 1. GitHub Pagesを有効化（一度だけ）

**Settings → Pages** で、Source を「Deploy from a branch」、Branch を `main` / `/docs` に設定して Save。

公開URLは `https://kyosuke-zipstokyo.github.io/nihonkabu-quiz-daily/` になります。

### 2. Secretsを登録

**Settings → Secrets and variables → Actions → New repository secret**

| Secret名 | 内容 |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude APIキー（console.anthropic.com） |
| `GMAIL_USER` | 送信元Gmailアドレス |
| `GMAIL_APP_PASSWORD` | Gmailのアプリパスワード（16桁、2段階認証必須） |
| `RECIPIENT_EMAIL` | （任意）宛先。未設定なら `GMAIL_USER` 宛 |

### 3. 手動実行してテスト

**Actions タブ → Daily Trade Quiz → Run workflow**

数十秒〜1分程度でメールが届き、GitHub PagesのURLからクイズを開けるはずです。

## モデル・生成の強さを変更したい場合

- `CLAUDE_MODEL`（例: `claude-sonnet-5`）
- `CLAUDE_EFFORT`（`low` / `medium` / `high` / `xhigh` / `max`、デフォルト `medium`）

をリポジトリSecretsに追加し、ワークフローのenvに渡せば変更できます。

## ローカルでのテスト

```bash
npm install
export ANTHROPIC_API_KEY=...
export GMAIL_USER=...
export GMAIL_APP_PASSWORD=...
export RECIPIENT_EMAIL=...
export QUIZ_PAGE_URL=https://kyosuke-zipstokyo.github.io/nihonkabu-quiz-daily/
npm run build
```
