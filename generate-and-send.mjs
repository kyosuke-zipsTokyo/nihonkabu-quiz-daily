import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import nodemailer from "nodemailer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = path.join(__dirname, "history.json");
const TEMPLATE_PATH = path.join(__dirname, "template.html");
const DOCS_DIR = path.join(__dirname, "docs");
const ARCHIVE_DIR = path.join(DOCS_DIR, "archive");

const QUESTION_COUNT = 10;
const NEWS_COUNT = 10;
const AVOID_DAYS = 5; // 出題後、この日数は再出題しない

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5";
const EFFORT = process.env.CLAUDE_EFFORT || "medium";

const TOPICS = [
  "為替・CPI・雇用統計などマクロ指標が株価に与える短期的な影響",
  "直近24時間以内の重要ニュースが株価に与えた（与えうる）影響",
  "歴史上の暴落・急騰の背景と、その後の値動きパターン",
  "伝説的トレーダー（リバモア、ソロス、ダリオ等）の相場観・手法",
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function getJstParts() {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return {
    y: jst.getUTCFullYear(),
    m: jst.getUTCMonth() + 1,
    d: jst.getUTCDate(),
    dow: jst.getUTCDay(),
  };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function loadHistory() {
  try {
    const parsed = JSON.parse(readFileSync(HISTORY_PATH, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(history, fileDateStr) {
  const cutoff = new Date(`${fileDateStr}T00:00:00+09:00`);
  cutoff.setDate(cutoff.getDate() - AVOID_DAYS);
  const pruned = history.filter((h) => {
    const d = new Date(`${h.date}T00:00:00+09:00`);
    return d >= cutoff;
  });
  writeFileSync(HISTORY_PATH, JSON.stringify(pruned, null, 2) + "\n");
}

const quizSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          cat: { type: "string", description: "出題カテゴリの短いラベル（日本語）" },
          q: { type: "string", description: "問題文（日本語）" },
          opts: {
            type: "array",
            items: { type: "string" },
            description: "4択の選択肢（ちょうど4つ、日本語）",
          },
          correct: { type: "integer", description: "opts内の正解インデックス（0始まり）" },
          explain: { type: "string", description: "なぜその答えが正解なのかの解説（日本語）" },
          chart: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["bar", "line", "none"] },
              data: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    value: { type: "number" },
                  },
                  required: ["label", "value"],
                  additionalProperties: false,
                },
              },
            },
            required: ["type", "data"],
            additionalProperties: false,
            description:
              "関連する数値指標・チャート。示せる数値がない場合は type:\"none\", data:[] にする",
          },
        },
        required: ["cat", "q", "opts", "correct", "explain", "chart"],
        additionalProperties: false,
      },
    },
    news: {
      type: "array",
      items: {
        type: "object",
        properties: {
          src: { type: "string", description: "情報源名（例: Bloomberg, Reuters）" },
          title: { type: "string", description: "ニュースの見出し（日本語）" },
          sum: {
            type: "string",
            description: "一文の要約。記事本文の転載はせず、自分の言葉で書くこと",
          },
          url: { type: "string", description: "元記事のURL" },
        },
        required: ["src", "title", "sum", "url"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions", "news"],
  additionalProperties: false,
};

async function generateQuizAndNews(history, fileDateStr) {
  const client = new Anthropic();

  const cutoff = new Date(`${fileDateStr}T00:00:00+09:00`);
  cutoff.setDate(cutoff.getDate() - AVOID_DAYS);
  const recentQuestions = history.filter((h) => new Date(`${h.date}T00:00:00+09:00`) >= cutoff);

  const avoidBlock =
    recentQuestions.length > 0
      ? `直近${AVOID_DAYS}日以内に出題した以下の問題とは重複・類似しない、新しい問題を作成してください:\n` +
        recentQuestions.map((h, i) => `${i + 1}. ${h.q}`).join("\n")
      : "";

  const userPrompt = `短中期トレード向けの日本株クイズを${QUESTION_COUNT}問作成してください。

出題範囲（幅広くカバーすること）:
${TOPICS.map((t) => `- ${t}`).join("\n")}

各問題にはできる限り関連するチャートや数値指標（chartフィールド）を含めてください。示せる具体的な数値がない場合のみ type:"none" にしてください。

${avoidBlock}

---

続けて、Web検索を使って、日本時間の深夜（今日の未明）までに出た米国市場中心のトレード関連ニュースをBloomberg・Reuters等から${NEWS_COUNT}本集めてください。各ニュースはタイトル・一文要約（自分の言葉で書き、記事本文は転載しない）・元記事URLの形式でまとめてください。`;

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
    output_config: {
      effort: EFFORT,
      format: { type: "json_schema", schema: quizSchema },
    },
    system:
      "あなたは日本株の短中期トレード学習コンテンツを作る専門家です。正確で分かりやすい日本語のクイズと、信頼できる情報源に基づくニュース要約を作成します。",
    messages: [{ role: "user", content: userPrompt }],
  });

  const response = await stream.finalMessage();

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to generate the quiz (stop_reason: refusal).");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      "Response was cut off at the max_tokens limit before finishing. Increase max_tokens in generate-and-send.mjs."
    );
  }

  const textBlock = [...response.content].reverse().find((block) => block.type === "text");
  if (!textBlock) throw new Error("No text content returned from Claude.");

  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (err) {
    const preview = textBlock.text.length > 400 ? textBlock.text.slice(0, 400) + "..." : textBlock.text;
    throw new Error(
      `Failed to parse Claude's JSON output (stop_reason: ${response.stop_reason}, length: ${textBlock.text.length}). ` +
        `Preview: ${preview}\nOriginal error: ${err.message}`
    );
  }
  const questions = Array.isArray(parsed.questions) ? parsed.questions.slice(0, QUESTION_COUNT) : [];
  const news = Array.isArray(parsed.news) ? parsed.news.slice(0, NEWS_COUNT) : [];
  if (questions.length === 0) throw new Error("Claude returned no questions.");
  return { questions, news };
}

function buildPageHtml({ questions, news, titleDate, h1Date }) {
  const template = readFileSync(TEMPLATE_PATH, "utf-8");
  return template
    .replace("__TITLE_DATE__", titleDate)
    .replace("__H1_DATE__", h1Date)
    .replace("__QUESTIONS_JSON__", JSON.stringify(questions))
    .replace("__NEWS_JSON__", JSON.stringify(news));
}

function getPageUrl() {
  if (process.env.QUIZ_PAGE_URL) return process.env.QUIZ_PAGE_URL;
  const repoFull = process.env.GITHUB_REPOSITORY;
  if (!repoFull) {
    throw new Error(
      "Cannot determine the GitHub Pages URL. Set QUIZ_PAGE_URL or run inside GitHub Actions (GITHUB_REPOSITORY)."
    );
  }
  const [owner, repo] = repoFull.split("/");
  return `https://${owner.toLowerCase()}.github.io/${repo}/`;
}

async function sendEmail({ pageUrl, titleDate, questions, news }) {
  const gmailUser = requireEnv("GMAIL_USER");
  const gmailAppPassword = requireEnv("GMAIL_APP_PASSWORD");
  const recipient = process.env.RECIPIENT_EMAIL || gmailUser;

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: gmailUser, pass: gmailAppPassword },
  });

  const categories = [...new Set(questions.map((q) => q.cat))].join(" / ");

  const html = `
    <div style="font-family:-apple-system,'Hiragino Kaku Gothic ProN',Meiryo,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;">
      <h2 style="margin-bottom:4px;">📈 今日のトレードクイズ</h2>
      <div style="color:#666;font-size:13px;margin-bottom:20px;">${titleDate}</div>
      <p style="font-size:14px;line-height:1.7;">出題範囲: ${escapeHtml(categories)}<br>
      クイズ${questions.length}問 ＋ 本日のマーケットニュース${news.length}本</p>
      <a href="${pageUrl}" style="display:inline-block;margin-top:12px;padding:14px 22px;background:#12213a;color:#f7f3ea;text-decoration:none;border-radius:6px;font-weight:bold;">クイズを始める →</a>
      <div style="font-size:12px;color:#999;margin-top:24px;">このメールはClaudeが自動生成した学習用コンテンツです。投資助言ではありません。</div>
    </div>`;

  await transporter.sendMail({
    from: `"日本株トレードクイズ" <${gmailUser}>`,
    to: recipient,
    subject: `今日のトレードクイズ＋マーケットニュース｜${titleDate}`,
    html,
  });
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function main() {
  requireEnv("ANTHROPIC_API_KEY");

  const { y, m, d, dow } = getJstParts();
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const fileDateStr = `${y}-${pad2(m)}-${pad2(d)}`;
  const titleDate = `${y}年${m}月${d}日`;
  const h1Date = `${y}年${m}月${d}日（${weekdays[dow]}）`;

  const history = loadHistory();
  const { questions, news } = await generateQuizAndNews(history, fileDateStr);

  const html = buildPageHtml({ questions, news, titleDate, h1Date });

  mkdirSync(ARCHIVE_DIR, { recursive: true });
  writeFileSync(path.join(DOCS_DIR, "index.html"), html);
  writeFileSync(path.join(ARCHIVE_DIR, `${fileDateStr}.html`), html);

  const pageUrl = getPageUrl();
  await sendEmail({ pageUrl, titleDate, questions, news });

  const updatedHistory = [
    ...history,
    ...questions.map((q) => ({ date: fileDateStr, q: q.q })),
  ];
  saveHistory(updatedHistory, fileDateStr);

  console.log(`Published ${questions.length} questions + ${news.length} news items to ${pageUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
