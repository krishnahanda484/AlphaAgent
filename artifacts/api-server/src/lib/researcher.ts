import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, END, START, Annotation } from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { logger } from "./logger";
import {
  findTicker,
  fetchStockQuote,
  fetchPriceHistory,
  fetchNews,
  formatMarketCap,
  formatRevenue,
  formatPct,
  formatNum,
  type StockQuote,
  type PricePoint,
  type NewsItem,
} from "./stock-data";

export interface ResearchProgress {
  type: "progress" | "complete" | "error";
  step?: string;
  message?: string;
  data?: ResearchResult;
}

export interface InvestmentScores {
  financials: number;
  valuation: number;
  growth: number;
  risk: number;
  news: number;
  sentiment: number;
}

export interface ConfidenceFactors {
  dataQuality: number;
  newsQuality: number;
  analystConsensus: number;
  sentiment: number;
}

export interface CompanyProfile {
  longName: string;
  exchange: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: string | null;
  ceo: string | null;
  hq: string | null;
  founded: string | null;
  website: string | null;
  employees: string | null;
}

export interface ResearchResult {
  ticker: string | null;
  verdict: "INVEST" | "PASS";
  summary: string;
  reasoning: string;
  bulletsFor: string[];
  bulletsAgainst: string[];
  financialData: Record<string, string | number | null>;
  newsHeadlines: Array<{ title: string; source?: string; date?: string; link?: string; sentiment?: "positive" | "negative" | "neutral" }>;
  priceHistory: PricePoint[];
  confidenceScore: number;
  investmentScores: InvestmentScores;
  confidenceFactors: ConfidenceFactors;
  companyProfile: CompanyProfile | null;
}

// ── LangGraph state ────────────────────────────────────────────────────────────

const ResearchState = Annotation.Root({
  company: Annotation<string>(),
  ticker: Annotation<string | null>({ reducer: (_, b) => b }),
  stockQuote: Annotation<StockQuote | null>({ reducer: (_, b) => b }),
  priceHistory: Annotation<PricePoint[]>({ reducer: (_, b) => b }),
  news: Annotation<NewsItem[]>({ reducer: (_, b) => b }),
  analysis: Annotation<{
    verdict: "INVEST" | "PASS";
    summary: string;
    reasoning: string;
    bulletsFor: string[];
    bulletsAgainst: string[];
    confidenceScore: number;
    investmentScores: InvestmentScores;
    confidenceFactors: ConfidenceFactors;
    newsSentiments: string[];
  } | null>({ reducer: (_, b) => b }),
  onProgress: Annotation<(p: ResearchProgress) => void>({ reducer: (_, b) => b }),
});

type State = typeof ResearchState.State;

// ── LLM ───────────────────────────────────────────────────────────────────────

function getLLM() {
  return new ChatOpenAI({
    model: "gpt-4o",
    temperature: 0.3,
    openAIApiKey: process.env.OPENAI_API_KEY,
  });
}

// ── Node 1: Resolve ticker + validate company ──────────────────────────────────

async function resolveTicker(state: State): Promise<Partial<State>> {
  state.onProgress({ type: "progress", step: "Identifying company & ticker", message: `Locating ${state.company} on markets...` });

  const yahooTicker = await findTicker(state.company);

  const llm = getLLM();
  const resp = await llm.invoke([
    new SystemMessage(`You are a financial data assistant. Given a company name, determine if it is a real, recognized company or organization.

Rules:
- Be INCLUSIVE and GENEROUS: if there is any reasonable chance it is a real company name, treat it as real.
- Real companies include: publicly traded companies (any country), well-known private companies, startups, conglomerates, subsidiaries, brands, holding companies (e.g. "Reliance" = Reliance Industries, "Tata" = Tata Group).
- If it is a REAL or PLAUSIBLY REAL company: return its primary stock ticker if publicly traded (e.g. AAPL, RELIANCE.NS), or return PRIVATE if it is private or unknown.
- Return NOT_A_COMPANY ONLY if the input is clearly not a company — e.g. a single common first name (John, Mary, Priya), random gibberish (asdf, xyz123), a common everyday word with no corporate meaning (apple the fruit if clearly not the tech company context), or a fictional character name.
- When in doubt, assume it IS a company and return PRIVATE or a ticker.

Respond with ONLY the ticker symbol (e.g. AAPL), PRIVATE, or NOT_A_COMPANY. Nothing else.`),
    new HumanMessage(`Company name: "${state.company}"`),
  ]);

  const llmResponse = (resp.content as string).trim().toUpperCase().replace(/[^A-Z._0-9]/g, "");
  logger.info({ company: state.company, yahooTicker, llmResponse }, "Ticker resolution");

  if (llmResponse === "NOT_A_COMPANY") {
    throw new Error(
      `"${state.company}" does not appear to be a recognized company. Please enter a valid company name (e.g. Apple, Nvidia, Tesla, Reliance Industries).`
    );
  }

  let ticker: string | null = yahooTicker;
  if (!ticker && llmResponse !== "PRIVATE" && llmResponse !== "") {
    ticker = llmResponse;
  }

  return { ticker };
}

// ── Node 2: Fetch market data ──────────────────────────────────────────────────

async function fetchMarketData(state: State): Promise<Partial<State>> {
  state.onProgress({ type: "progress", step: "Fetching live market data", message: `Pulling real-time financials for ${state.ticker ?? state.company}...` });

  if (!state.ticker) {
    return { stockQuote: null, priceHistory: [] };
  }

  const [quote, history] = await Promise.all([
    fetchStockQuote(state.ticker),
    fetchPriceHistory(state.ticker, 90),
  ]);

  logger.info({ ticker: state.ticker, hasQuote: !!quote, historyLen: history.length }, "Market data fetched");
  return { stockQuote: quote, priceHistory: history };
}

// ── Node 3: Fetch news ────────────────────────────────────────────────────────

async function fetchNewsNode(state: State): Promise<Partial<State>> {
  state.onProgress({ type: "progress", step: "Scanning recent news", message: `Reading latest headlines for ${state.company}...` });

  const newsQuery = state.ticker ?? state.company;
  const news = await fetchNews(newsQuery);
  logger.info({ ticker: newsQuery, count: news.length }, "News fetched");
  return { news };
}

// ── Node 4: LLM analysis ──────────────────────────────────────────────────────

async function analyzeAndVerdict(state: State): Promise<Partial<State>> {
  state.onProgress({ type: "progress", step: "Evaluating competitive landscape", message: "Analyzing moat, growth, and valuation..." });

  const q = state.stockQuote;

  const dataContext = q ? `
REAL-TIME MARKET DATA (fetched from Yahoo Finance right now):
- Ticker: ${q.ticker} | Exchange: ${q.exchange ?? "N/A"}
- Company: ${q.longName}
- Sector: ${q.sector ?? "N/A"} | Industry: ${q.industry ?? "N/A"}
- CEO: ${q.ceo ?? "N/A"} | HQ: ${q.hq ?? "N/A"}
- Employees: ${q.fullTimeEmployees?.toLocaleString() ?? "N/A"}
- Current Price: $${q.currentPrice?.toFixed(2) ?? "N/A"}
- Day Change: ${q.regularMarketChangePercent != null ? (q.regularMarketChangePercent * 100 > 0 ? "+" : "") + (q.regularMarketChangePercent * 100).toFixed(2) + "%" : "N/A"}
- Market Cap: ${formatMarketCap(q.marketCap) ?? "N/A"}
- 52-Week High: $${q.fiftyTwoWeekHigh?.toFixed(2) ?? "N/A"} | Low: $${q.fiftyTwoWeekLow?.toFixed(2) ?? "N/A"}
- Volume: ${q.volume?.toLocaleString() ?? "N/A"} | Avg Volume: ${q.averageVolume?.toLocaleString() ?? "N/A"}
- Trailing P/E: ${q.trailingPE?.toFixed(1) ?? "N/A"} | Forward P/E: ${q.forwardPE?.toFixed(1) ?? "N/A"}
- EPS (TTM): $${q.trailingEps?.toFixed(2) ?? "N/A"} | Forward EPS: $${q.forwardEps?.toFixed(2) ?? "N/A"}
- Price/Book: ${q.priceToBook?.toFixed(2) ?? "N/A"} | EV/EBITDA: ${q.enterpriseToEbitda?.toFixed(1) ?? "N/A"}
- Total Revenue: ${formatRevenue(q.totalRevenue) ?? "N/A"}
- Revenue Growth YoY: ${formatPct(q.revenueGrowth) ?? "N/A"}
- Gross Margin: ${formatPct(q.grossMargins) ?? "N/A"} | EBITDA Margin: ${formatPct(q.ebitdaMargins) ?? "N/A"}
- Net Margin: ${formatPct(q.profitMargins) ?? "N/A"}
- ROE: ${formatPct(q.returnOnEquity) ?? "N/A"} | Earnings Growth: ${formatPct(q.earningsGrowth) ?? "N/A"}
- Debt/Equity: ${q.debtToEquity?.toFixed(1) ?? "N/A"}
- Free Cash Flow: ${formatRevenue(q.freeCashflow) ?? "N/A"}
- Dividend Yield: ${q.trailingAnnualDividendYield != null ? (q.trailingAnnualDividendYield * 100).toFixed(2) + "%" : "None"} | Dividend Rate: $${q.dividendRate?.toFixed(2) ?? "N/A"}
- Beta: ${q.beta?.toFixed(2) ?? "N/A"}
` : `No live market data available — company may be private or ticker lookup failed. Use your training knowledge.`;

  const newsContext = state.news.length > 0
    ? `\nRECENT NEWS (fetched live):\n${state.news.slice(0, 8).map((n, i) => `${i + 1}. "${n.title}" — ${n.source} (${n.date})`).join("\n")}`
    : "\nNo live news fetched.";

  const prompt = `You are an elite buy-side equity analyst at a top hedge fund. You have been given REAL, LIVE market data and news for "${state.company}" fetched right now from Yahoo Finance. Use this data as your primary source of truth.

${dataContext}
${newsContext}

Today is ${new Date().toDateString()}.

Based on all available data, provide your investment verdict. You MUST respond with ONLY valid JSON (no markdown, no extra text).

CRITICAL: The "reasoning" field MUST be a single plain string (not an object, not nested JSON). Use \\n\\n to separate paragraphs. Each paragraph must begin with a markdown bold header like **Business Model & Moat:** followed by the text inline.

{
  "verdict": "INVEST" or "PASS",
  "summary": "2-3 sentence executive summary citing specific real numbers",
  "reasoning": "**Business Model & Moat:** [paragraph 1 text]\\n\\n**Financial Health:** [paragraph 2 text]\\n\\n**Valuation Analysis:** [paragraph 3 text]\\n\\n**Growth Catalysts:** [paragraph 4 text]\\n\\n**Key Risks:** [paragraph 5 text]",
  "bulletsFor": ["6 specific data-backed bull case points — each must include at least one number/metric and explain WHY it matters"],
  "bulletsAgainst": ["6 specific data-backed bear case points — each must include at least one number/metric and explain the risk"],
  "confidenceScore": number 0-100,
  "investmentScores": {
    "financials": number 0-100 based on margins, FCF, ROE, debt,
    "valuation": number 0-100 where 100=very cheap, 0=very expensive,
    "growth": number 0-100 based on revenue growth, earnings growth,
    "risk": number 0-100 where 100=very low risk, 0=very high risk,
    "news": number 0-100 based on news sentiment and quality,
    "sentiment": number 0-100 overall market/analyst sentiment
  },
  "confidenceFactors": {
    "dataQuality": integer 1-5 stars (5 if we have full live Yahoo Finance data),
    "newsQuality": integer 1-5 stars (based on number and relevance of news articles),
    "analystConsensus": integer 1-5 stars (based on how clear the investment case is),
    "sentiment": integer 1-5 stars (overall sentiment confidence)
  },
  "newsSentiments": ["positive"/"negative"/"neutral" for each news headline IN ORDER, same count as news provided]
}

Be rigorous, honest, and specific. Cite actual numbers. If valuation is stretched, say so with numbers. If growth is strong, quantify it.`;

  state.onProgress({ type: "progress", step: "Computing investment verdict", message: "Synthesizing all research into final verdict..." });

  const llm = getLLM();
  const resp = await llm.invoke([
    new SystemMessage("You are an elite equity research analyst. Respond with ONLY valid JSON, no markdown, no explanation outside the JSON."),
    new HumanMessage(prompt),
  ]);

  let raw = (resp.content as string).trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
  }

  let parsed: State["analysis"];
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.error({ err, raw }, "Failed to parse LLM analysis JSON");
    throw new Error("AI returned malformed response. Please try again.");
  }

  if (!parsed?.verdict || !["INVEST", "PASS"].includes(parsed.verdict)) {
    throw new Error("AI returned invalid verdict");
  }

  // Normalize reasoning: LLM occasionally returns it as an object instead of a string
  if (parsed.reasoning && typeof parsed.reasoning === "object") {
    const obj = parsed.reasoning as Record<string, string>;
    parsed.reasoning = Object.entries(obj)
      .map(([key, val]) => `**${key}:** ${val}`)
      .join("\n\n");
  }

  // Ensure investmentScores and confidenceFactors have defaults
  if (!parsed.investmentScores) {
    parsed.investmentScores = { financials: 50, valuation: 50, growth: 50, risk: 50, news: 50, sentiment: 50 };
  }
  if (!parsed.confidenceFactors) {
    parsed.confidenceFactors = { dataQuality: 3, newsQuality: 3, analystConsensus: 3, sentiment: 3 };
  }

  return { analysis: parsed };
}

// ── Build the LangGraph ────────────────────────────────────────────────────────

function buildGraph() {
  const graph = new StateGraph(ResearchState)
    .addNode("resolveTicker", resolveTicker)
    .addNode("fetchMarketData", fetchMarketData)
    .addNode("fetchNews", fetchNewsNode)
    .addNode("analyze", analyzeAndVerdict)
    .addEdge(START, "resolveTicker")
    .addEdge("resolveTicker", "fetchMarketData")
    .addEdge("resolveTicker", "fetchNews")
    .addEdge("fetchMarketData", "analyze")
    .addEdge("fetchNews", "analyze")
    .addEdge("analyze", END);

  return graph.compile();
}

// ── Public entry point ─────────────────────────────────────────────────────────

export async function runResearchAgent(
  company: string,
  onProgress: (progress: ResearchProgress) => void
): Promise<ResearchResult> {
  const graph = buildGraph();

  const finalState = await graph.invoke({
    company,
    ticker: null,
    stockQuote: null,
    priceHistory: [],
    news: [],
    analysis: null,
    onProgress,
  });

  const q = finalState.stockQuote;
  const analysis = finalState.analysis!;

  // Build company profile from Yahoo Finance data
  const companyProfile: CompanyProfile | null = q ? {
    longName: q.longName,
    exchange: q.exchange,
    sector: q.sector,
    industry: q.industry,
    marketCap: formatMarketCap(q.marketCap),
    ceo: q.ceo,
    hq: q.hq,
    founded: q.founded,
    website: q.website,
    employees: q.fullTimeEmployees ? q.fullTimeEmployees.toLocaleString() : null,
  } : null;

  // Build structured financial data from real Yahoo Finance numbers
  const financialData: Record<string, string | null> = {
    currentPrice: q?.currentPrice != null ? `$${q.currentPrice.toFixed(2)}` : null,
    dayChange: q?.regularMarketChangePercent != null
      ? `${q.regularMarketChangePercent > 0 ? "+" : ""}${(q.regularMarketChangePercent * 100).toFixed(2)}%`
      : null,
    marketCap: formatMarketCap(q?.marketCap ?? null),
    volume: q?.volume != null ? q.volume.toLocaleString() : null,
    avgVolume: q?.averageVolume != null ? q.averageVolume.toLocaleString() : null,
    "52wkHigh": q?.fiftyTwoWeekHigh != null ? `$${q.fiftyTwoWeekHigh.toFixed(2)}` : null,
    "52wkLow": q?.fiftyTwoWeekLow != null ? `$${q.fiftyTwoWeekLow.toFixed(2)}` : null,
    trailingPE: q?.trailingPE != null ? `${q.trailingPE.toFixed(1)}x` : null,
    forwardPE: q?.forwardPE != null ? `${q.forwardPE.toFixed(1)}x` : null,
    eps: q?.trailingEps != null ? `$${q.trailingEps.toFixed(2)}` : null,
    forwardEps: q?.forwardEps != null ? `$${q.forwardEps.toFixed(2)}` : null,
    priceToBook: formatNum(q?.priceToBook ?? null, 2),
    evToEbitda: formatNum(q?.enterpriseToEbitda ?? null, 1),
    enterpriseValue: formatMarketCap(q?.enterpriseValue ?? null),
    revenue: formatRevenue(q?.totalRevenue ?? null),
    revenueGrowth: formatPct(q?.revenueGrowth ?? null),
    grossMargin: formatPct(q?.grossMargins ?? null),
    ebitdaMargin: formatPct(q?.ebitdaMargins ?? null),
    netMargin: formatPct(q?.profitMargins ?? null),
    roe: formatPct(q?.returnOnEquity ?? null),
    earningsGrowth: formatPct(q?.earningsGrowth ?? null),
    debtToEquity: q?.debtToEquity != null ? `${q.debtToEquity.toFixed(1)}` : null,
    freeCashFlow: formatRevenue(q?.freeCashflow ?? null),
    dividendYield: q?.trailingAnnualDividendYield != null
      ? `${(q.trailingAnnualDividendYield * 100).toFixed(2)}%`
      : "None",
    dividendRate: q?.dividendRate != null ? `$${q.dividendRate.toFixed(2)}` : null,
    beta: q?.beta != null ? q.beta.toFixed(2) : null,
    sector: q?.sector ?? null,
    industry: q?.industry ?? null,
  };

  const cleanFinancialData = Object.fromEntries(
    Object.entries(financialData).filter(([, v]) => v !== null)
  );

  // Attach news sentiments to headlines
  const sentiments: string[] = analysis.newsSentiments ?? [];
  const enrichedNews = finalState.news.slice(0, 8).map((n, i) => ({
    ...n,
    sentiment: (sentiments[i] as "positive" | "negative" | "neutral") ?? "neutral",
  }));

  return {
    ticker: finalState.ticker,
    verdict: analysis.verdict,
    summary: analysis.summary,
    reasoning: analysis.reasoning,
    bulletsFor: analysis.bulletsFor,
    bulletsAgainst: analysis.bulletsAgainst,
    financialData: cleanFinancialData,
    newsHeadlines: enrichedNews,
    priceHistory: finalState.priceHistory,
    confidenceScore: analysis.confidenceScore,
    investmentScores: analysis.investmentScores,
    confidenceFactors: analysis.confidenceFactors,
    companyProfile,
  };
}
