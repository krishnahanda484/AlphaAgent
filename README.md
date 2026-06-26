# AlphaAgent — AI Investment Research Agent

> Built for the InsideIIM × Altuni AI Labs AI Product Development Engineer Take-Home Assignment.

---

## Overview

## Live Demo

- **Application:** https://alphaagent-0n6c.onrender.com/
- **GitHub Repository:** https://github.com/krishnahanda484/AlphaAgent

> Replace the deployment URL and repository link with your own before submission.

## Features

- AI-powered investment research
- Company validation and ticker resolution
- Live market data using Yahoo Finance
- Real-time news sentiment analysis
- LangGraph-based workflow orchestration
- GPT-4o powered investment reasoning
- Streaming progress updates using Server-Sent Events
- Investment score breakdown
- Company profile dashboard
- Historical price chart

## Overview

AlphaAgent is an autonomous AI investment research agent. Enter any public company name and the agent:

1. **Validates & resolves** the company — confirms it's real and finds its stock ticker via Yahoo Finance + GPT-4o
2. **Fetches live market data** — price, P/E, margins, FCF, debt, EPS, 52-week range, volume and more from Yahoo Finance
3. **Scans real news** — pulls recent headlines with GPT-4o sentiment classification (positive / negative / neutral)
4. **Runs a LangGraph pipeline** — 4 nodes with parallel data fetching, converging at a GPT-4o analysis node
5. **Delivers a structured verdict** — **INVEST** or **PASS** with a confidence score, investment sub-scores (Financials / Valuation / Growth / Risk / News / Sentiment), confidence breakdown, bull & bear case, a 5-paragraph analyst thesis, a 90-day price chart, and a company profile card

The full pipeline streams live to the UI via Server-Sent Events so you watch each step complete in real time.

---

## How to Run

### Prerequisites
- Node.js 18+
- pnpm (`npm install -g pnpm`)
- PostgreSQL database
- OpenAI API key (GPT-4o access)

### 1. Install dependencies
```bash
pnpm install
```

### 2. Set environment variables
Copy `.env.example` or create a `.env` file:
```env
DATABASE_URL=postgresql://user:password@localhost:5432/alphaagent
OPENAI_API_KEY=sk-...
SESSION_SECRET=any-random-string
PORT=8080
```

### 3. Push the database schema
```bash
pnpm --filter @workspace/db run push
```

### 4. Start development servers
```bash
# Terminal 1 — API server (port 8080)
pnpm --filter @workspace/api-server run dev

# Terminal 2 — React frontend (Vite)
pnpm --filter @workspace/investment-agent run dev
```

Open the URL printed by Vite (e.g. `http://localhost:5173`).

---

## Deploying Online

### Render (recommended — free tier)
1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → New → Web Service → connect your repo
3. Render auto-detects `render.yaml` — review and confirm
4. Add environment variables in the dashboard:
   - `DATABASE_URL` — use Render's free managed Postgres add-on
   - `OPENAI_API_KEY`
5. Click **Deploy** — build and start happen automatically

### Railway
1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project → from GitHub repo
3. Add a **PostgreSQL** plugin — Railway sets `DATABASE_URL` automatically
4. Add `OPENAI_API_KEY` in the Variables tab
5. Railway reads `railway.toml` for build and start commands
6. Click **Deploy**

### Manual build (any platform)
```bash
bash scripts/build-prod.sh
NODE_ENV=production PORT=8080 DATABASE_URL=... OPENAI_API_KEY=... node artifacts/api-server/dist/index.mjs
```

---

## How It Works

### Architecture

```
User Input (company name)
        │
        ▼
  POST /api/research          ← creates DB row, returns session ID
        │
        ▼
  GET /api/research/:id/stream  ← SSE stream, browser subscribes
        │
        ▼
  ╔═══════════════════════════════════════════╗
  ║     LangGraph Pipeline (4 nodes)          ║
  ║                                           ║
  ║  Node 1: resolveTicker                    ║
  ║    → Yahoo Finance ticker search          ║
  ║    → GPT-4o validates company is real     ║
  ║    → resolves stock ticker symbol         ║
  ║         │                                 ║
  ║   parallel fan-out                        ║
  ║    ┌────┴──────────────┐                  ║
  ║    ▼                   ▼                  ║
  ║  Node 2:           Node 3:                ║
  ║  fetchMarketData   fetchNews              ║
  ║  (yahoo-finance2)  (yahoo-finance2)       ║
  ║  quote + summary   8 headlines            ║
  ║  90-day history                           ║
  ║    └────┬──────────────┘                  ║
  ║   converge                                ║
  ║         ▼                                 ║
  ║  Node 4: analyzeAndVerdict                ║
  ║    → GPT-4o reads ALL real data           ║
  ║    → returns structured JSON verdict      ║
  ╚═══════════════════════════════════════════╝
        │
        ▼
  DB update → SSE "complete" → UI renders full report
```

### Frontend Streaming Flow
```
EventSource → onmessage:
  type "progress"  → update step tracker (live animation)
  type "complete"  → invalidate TanStack Query cache → fetch final session
  type "error"     → show error banner
onerror            → ignored if "complete" already received (prevents false error on clean close)
```

### Tech Stack
| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS, TanStack Query v5, Recharts, wouter |
| Backend | Express 5, Node.js 24 |
| AI Orchestration | LangGraph.js (StateGraph, parallel edges) |
| LLM | OpenAI GPT-4o via LangChain.js |
| Market Data | yahoo-finance2 (live prices, financials, news, company profile) |
| Database | PostgreSQL + Drizzle ORM |
| Streaming | Server-Sent Events (SSE) |
| API Contract | OpenAPI 3.0 → Orval codegen → Zod schemas + TanStack Query hooks |
| Monorepo | pnpm workspaces |

---

## Key Decisions & Trade-offs

### Single LLM Analysis
**Chose**: One GPT-4o call per analysis, receiving a fully structured JSON response.  
**Why**: More reliable (no hallucinated tool calls), faster (~20–35s vs 60s+), and deterministic output format. The real data fetching is already handled by dedicated LangGraph nodes.  
**Trade-off**: Cannot dynamically decide to fetch additional sources mid-reasoning.

### Yahoo Finance for all financial data
**Chose**: `yahoo-finance2` for real market data; GPT-4o only does *reasoning*, not *data recall*.  
**Why**: LLM training data is months stale. Real P/E, margins, revenue, and FCF make the analysis credible and verifiable.   
**Trade-off**: yahoo-finance2 is an unofficial API; it can fail for small/private/international tickers.

### Server-Sent Events (SSE)

**Choice:** Server-Sent Events (SSE)

**Reason:** The application only requires one-way communication from the server to the client for streaming research progress. SSE is lightweight, easy to implement, and well suited for this use case.

### LangGraph parallel nodes
**Chose**: `fetchMarketData` and `fetchNews` run in parallel, not sequentially.  
**Why**: Both are network I/O-bound; parallelism cuts 3–5 seconds off total latency with zero code complexity tradeoff.

### JSON blobs in text columns
**Chose**: Store arrays/objects (newsHeadlines, bulletsFor, investmentScores, companyProfile) as JSON strings in `TEXT` columns.  
**Why**: Simple, schema-free, and avoids migrations as the LLM output structure evolves. Extra structured data (scores, profile) is embedded under `_`-prefixed keys in the `financialData` column.

### What was left out (and why)
- **SEC filing retrieval** — would need a vector database + embedding pipeline (RAG); out of scope for 7 days
- **Analyst consensus / price targets** — requires a paid data provider (Polygon.io, Alpha Vantage Premium)
- **Peer benchmarking** — auto-identifying 3–5 sector peers adds 2 more LangGraph nodes; would be the first v2 feature
- **Email / push alerts** — needs background job queue (Bull, BullMQ)

---

## Assumptions

- The application analyzes publicly traded companies.
- Yahoo Finance is the primary source for market and financial data.
- GPT-4o is used for reasoning and recommendation generation.
- The recommendation is for educational purposes and should not be considered financial advice.

## Limitations

- Private companies cannot be analyzed.
- Data availability depends on Yahoo Finance.
- News coverage varies across companies.
- The generated recommendation should not replace professional financial advice.

## Testing

The application was manually tested using companies such as Apple, Microsoft, NVIDIA, Reliance Industries, and Tata Motors. The generated results were verified against publicly available market information.

---

## Example Runs

### Apple (AAPL)

```
Verdict: INVEST

Reason:
Apple demonstrates strong profitability, consistent cash flow generation, healthy margins, and positive long-term growth potential. Recent news sentiment is also positive, resulting in a high-confidence investment recommendation.

Generated using live market data at the time of execution.
```

### Reliance Industries (RELIANCE.NS)

```
Verdict: INVEST

Reason:
Reliance benefits from diversified business segments, stable financial performance, and long-term growth opportunities across telecom, retail, and energy businesses.

Generated using live market data at the time of execution.
```

### Tata Motors (TTM)

```
Verdict: INVEST

Reason:
The analysis highlights improving profitability, recovery in the JLR business, and continued growth in the automotive sector. The final recommendation is based on the latest available market data.

Generated using live market data at the time of execution.
```

---

## What I Would Improve With More Time

1. **SEC / SEBI filing retrieval** — embed 10-K/annual reports in a vector store and ground the thesis in audited data (RAG)
2. **Analyst consensus scores** — integrate a paid provider (Alpha Vantage, Polygon.io) for price targets and consensus ratings
3. **Peer benchmarking** — auto-identify 3–5 sector peers and benchmark every metric against them with the LLM explaining relative positioning
4. **Portfolio watchlist** — save INVEST verdicts; track price change since analysis; alert when verdict would flip
5. **Multi-LLM validation** — run Claude 3.5 Sonnet as a second opinion in parallel; surface disagreements as a "disagreement score"
6. **PDF export** — one-click investment memo as a formatted, shareable PDF
7. **Re-research scheduling** — weekly cron job to re-run analyses and email/push-notify on verdict changes
8. **Streaming token output** — stream the LLM reasoning token-by-token for a more engaging "thinking" animation

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `OPENAI_API_KEY` | ✅ | OpenAI API key (GPT-4o access required) |
| `PORT` | ✅ | Port for the Express server (8080 in dev) |
| `SESSION_SECRET` | Optional | Secret for session signing |
| `NODE_ENV` | Optional | Set to `production` to serve the React frontend as static files |

---

## Project Structure

```
artifacts/
  api-server/           ← Express 5 backend
    src/
      app.ts            ← Express app, CORS, static serving in production
      index.ts          ← Server entry point
      lib/
        researcher.ts   ← LangGraph pipeline (company validation, data fetch, LLM analysis)
        stock-data.ts   ← Yahoo Finance wrapper (quote, history, news, company profile)
      routes/
        research/       ← REST endpoints + SSE streaming
  investment-agent/     ← React + Vite frontend
    src/
      pages/
        home.tsx        ← Homepage with search, company chips, history
        research-detail.tsx ← Live progress view + full report (company card, scores, chart, etc.)
lib/
  api-spec/             ← OpenAPI 3.0 spec (source of truth for all endpoints)
  db/                   ← Drizzle ORM schema + migration scripts
  api-zod/              ← Orval-generated Zod validation schemas
  api-client-react/     ← Orval-generated TanStack Query hooks
render.yaml             ← Render.com one-click deployment config
railway.toml            ← Railway.app deployment config
scripts/build-prod.sh   ← Manual production build script
```

---

## BONUS: AI / LLM Chat Session Transcript

As mandated by the assignment to build this project using an AI/LLM, the complete chat session transcript is included in this repository. 

Please see the **`LLM_TRANSCRIPT.md`** file located in the root of the project to view the full log of my thought process, architectural discussions, and iterative development with the LLM.
