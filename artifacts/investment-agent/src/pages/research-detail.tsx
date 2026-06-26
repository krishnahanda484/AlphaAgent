import { useEffect, useState, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useGetResearch, getGetResearchQueryKey, getListResearchQueryKey, getGetResearchStatsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  TrendingUp, TrendingDown, ArrowLeft, CheckCircle2, Circle,
  Loader2, AlertCircle, Newspaper, BarChart2, ShieldCheck, ShieldX,
  Share2, ExternalLink, Zap, Activity, Info, Star,
  Globe, Award, ArrowRight, ChevronDown, ChevronUp
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ResearchSession {
  id: number;
  company: string;
  ticker: string | null;
  status: string;
  verdict: string | null;
  summary: string | null;
  reasoning: string | null;
  bulletsFor: string | null;
  bulletsAgainst: string | null;
  financialData: string | null;
  newsHeadlines: string | null;
  priceHistory: string | null;
  confidenceScore: number | null;
  createdAt: string;
  completedAt: string | null;
}

interface ProgressStep { step: string; message: string; done: boolean; }
interface PricePoint { date: string; close: number; }
interface NewsItem { title: string; source?: string; date?: string; link?: string; sentiment?: "positive" | "negative" | "neutral"; }

interface InvestmentScores { financials: number; valuation: number; growth: number; risk: number; news: number; sentiment: number; }
interface ConfidenceFactors { dataQuality: number; newsQuality: number; analystConsensus: number; sentiment: number; }
interface CompanyProfile {
  longName: string; exchange: string | null; sector: string | null; industry: string | null;
  marketCap: string | null; ceo: string | null; hq: string | null; founded: string | null;
  website: string | null; employees: string | null;
}

const RESEARCH_STEPS = [
  "Identifying company & ticker",
  "Fetching live market data",
  "Scanning recent news",
  "Evaluating competitive landscape",
  "Computing investment verdict",
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function StarRating({ value }: { value: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`w-3.5 h-3.5 ${i <= value ? "text-amber-400 fill-amber-400" : "text-muted-foreground/30"}`} />
      ))}
    </div>
  );
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-xs font-bold text-foreground">{Math.round(value)}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-1000"
          style={{ width: `${value}%`, background: color }}
        />
      </div>
    </div>
  );
}

function CompanyLogo({ company, website, size = 48 }: { company: string; website?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const domain = website
    ? website.replace(/https?:\/\//, "").replace(/\/.*/, "")
    : `${company.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`;
  const logoUrl = `https://logo.clearbit.com/${domain}`;

  if (failed) {
    return (
      <div
        className="rounded-xl bg-primary/10 flex items-center justify-center font-extrabold text-primary flex-shrink-0"
        style={{ width: size, height: size, fontSize: size * 0.35 }}
      >
        {company.slice(0, 2).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={logoUrl}
      alt={`${company} logo`}
      className="rounded-xl object-contain bg-white border border-border flex-shrink-0"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}

// ── Confidence Ring ────────────────────────────────────────────────────────────

function ConfidenceRing({ score }: { score: number }) {
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 70 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444";
  const label = score >= 70 ? "High" : score >= 50 ? "Medium" : "Low";

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="96" height="96" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={radius} fill="none" stroke="currentColor" strokeWidth="7" opacity="0.15" />
        <circle
          cx="48" cy="48" r={radius} fill="none"
          stroke={color} strokeWidth="7"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 48 48)"
          style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)" }}
        />
        <text x="48" y="44" textAnchor="middle" fontSize="18" fontWeight="800" fill="currentColor">{Math.round(score)}</text>
        <text x="48" y="59" textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.6" fontWeight="600">{label}</text>
      </svg>
      <span className="text-xs text-muted-foreground font-medium">Confidence</span>
    </div>
  );
}

// ── Price Chart ────────────────────────────────────────────────────────────────

function PriceChart({ history, ticker, currentPrice, changePercent }: {
  history: PricePoint[]; ticker: string; currentPrice?: string | null; changePercent?: string | null;
}) {
  if (history.length < 2) return null;
  const first = history[0].close;
  const last = history[history.length - 1].close;
  const isUp = last >= first;
  const color = isUp ? "#10b981" : "#ef4444";
  const pctChange = ((last - first) / first) * 100;
  const minClose = Math.min(...history.map((h) => h.close));
  const maxClose = Math.max(...history.map((h) => h.close));

  return (
    <div className="bg-card border border-border rounded-xl p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-mono text-sm font-bold text-muted-foreground">{ticker}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">90-day chart</span>
          </div>
          <div className="flex items-baseline gap-2">
            {currentPrice && <span className="text-2xl font-extrabold text-foreground">{currentPrice}</span>}
            {changePercent && (
              <span className={`text-sm font-bold ${changePercent.startsWith("+") ? "text-emerald-500" : "text-rose-500"}`}>
                {changePercent} today
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className={`text-sm font-bold ${isUp ? "text-emerald-500" : "text-rose-500"}`}>
            {isUp ? "▲" : "▼"} {Math.abs(pctChange).toFixed(2)}% (90d)
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">${minClose.toFixed(2)} – ${maxClose.toFixed(2)}</p>
        </div>
      </div>
      <div className="h-36 sm:h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={history} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.25} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date"
              tickFormatter={(d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false}
              interval="preserveStartEnd" tickCount={4}
            />
            <YAxis domain={["auto", "auto"]}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false}
              tickFormatter={(v) => `$${v.toFixed(0)}`} width={50}
            />
            <Tooltip
              contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
              formatter={(v: number) => [`$${v.toFixed(2)}`, "Close"]}
              labelFormatter={(l) => new Date(l).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            />
            <Area type="monotone" dataKey="close" stroke={color} strokeWidth={2} fill="url(#priceGrad)" dot={false} activeDot={{ r: 4, fill: color }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
        <Zap className="w-3 h-3 text-emerald-500" /> Live 90-day data sourced from Yahoo Finance
      </p>
    </div>
  );
}

// ── Progress view ──────────────────────────────────────────────────────────────

function ProgressView({ steps, company }: { steps: ProgressStep[]; company: string }) {
  const pipelineSteps = [
    { label: "User Input", icon: "👤" },
    { label: "LangGraph", icon: "🔗" },
    { label: "Yahoo Finance", icon: "📊" },
    { label: "News Search", icon: "📰" },
    { label: "LLM Reasoning", icon: "🧠" },
    { label: "Verdict", icon: "⚖️" },
  ];

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="bg-card border border-border rounded-2xl p-6 sm:p-8">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Activity className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="font-bold text-foreground text-base sm:text-lg">Generating Investment Thesis for {company}…</h2>
            <p className="text-sm text-muted-foreground">Fetching live data · 30–60 seconds</p>
          </div>
        </div>

        <div className="space-y-3 mb-8">
          {RESEARCH_STEPS.map((label, i) => {
            const matched = steps.find((s) => s.step === label);
            const prevDone = i === 0 || steps.some((s) => s.step === RESEARCH_STEPS[i - 1] && s.done);
            const isActive = !matched && prevDone && steps.length > 0;
            const isDone = matched?.done ?? false;
            return (
              <div key={label} className="flex items-center gap-3">
                <div className="flex-shrink-0">
                  {isDone    ? <CheckCircle2 className="w-5 h-5 text-primary" /> :
                   isActive  ? <Loader2 className="w-5 h-5 text-amber-500 animate-spin" /> :
                               <Circle className="w-5 h-5 text-muted-foreground/30" />}
                </div>
                <div className="flex-1">
                  <span className={`text-sm ${isDone ? "text-foreground" : isActive ? "text-foreground font-semibold" : "text-muted-foreground/50"}`}>
                    {label}
                  </span>
                  {isActive && matched?.message && (
                    <p className="text-xs text-muted-foreground mt-0.5">{matched.message}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* AI Pipeline diagram */}
        <div className="border-t border-border pt-5">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">AI Research Pipeline</p>
          <div className="flex items-center gap-1 flex-wrap">
            {pipelineSteps.map((step, i) => (
              <div key={step.label} className="flex items-center gap-1">
                <div className="flex flex-col items-center">
                  <div className="text-base">{step.icon}</div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{step.label}</span>
                </div>
                {i < pipelineSteps.length - 1 && (
                  <ArrowRight className="w-3 h-3 text-muted-foreground/40 flex-shrink-0 mb-4" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Metric table ───────────────────────────────────────────────────────────────

const METRIC_DISPLAY: Record<string, { label: string; group: string }> = {
  currentPrice: { label: "Current Price", group: "Price" },
  dayChange: { label: "Today's Change", group: "Price" },
  "52wkHigh": { label: "52-Wk High", group: "Price" },
  "52wkLow": { label: "52-Wk Low", group: "Price" },
  volume: { label: "Volume", group: "Price" },
  avgVolume: { label: "Avg Volume", group: "Price" },
  marketCap: { label: "Market Cap", group: "Valuation" },
  enterpriseValue: { label: "Enterprise Value", group: "Valuation" },
  trailingPE: { label: "P/E (TTM)", group: "Valuation" },
  forwardPE: { label: "P/E (Forward)", group: "Valuation" },
  priceToBook: { label: "Price/Book", group: "Valuation" },
  evToEbitda: { label: "EV/EBITDA", group: "Valuation" },
  eps: { label: "EPS (TTM)", group: "Earnings" },
  forwardEps: { label: "EPS (Forward)", group: "Earnings" },
  earningsGrowth: { label: "Earnings Growth", group: "Earnings" },
  revenue: { label: "Revenue", group: "Financials" },
  revenueGrowth: { label: "Revenue Growth", group: "Financials" },
  grossMargin: { label: "Gross Margin", group: "Financials" },
  ebitdaMargin: { label: "EBITDA Margin", group: "Financials" },
  netMargin: { label: "Net Margin", group: "Financials" },
  freeCashFlow: { label: "Free Cash Flow", group: "Financials" },
  roe: { label: "ROE", group: "Financials" },
  debtToEquity: { label: "Debt/Equity", group: "Risk" },
  beta: { label: "Beta", group: "Risk" },
  dividendYield: { label: "Dividend Yield", group: "Income" },
  dividendRate: { label: "Dividend Rate", group: "Income" },
};

function MetricsTable({ data }: { data: Record<string, string> }) {
  const [expanded, setExpanded] = useState(false);
  const groups: Record<string, { key: string; label: string; value: string }[]> = {};

  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith("_") || ["sector", "industry"].includes(key)) continue;
    const meta = METRIC_DISPLAY[key];
    const group = meta?.group ?? "Other";
    const label = meta?.label ?? key.replace(/([A-Z])/g, " $1").trim();
    if (!groups[group]) groups[group] = [];
    groups[group].push({ key, label, value });
  }

  const groupOrder = ["Price", "Valuation", "Earnings", "Financials", "Risk", "Income", "Other"];
  const orderedGroups = groupOrder.filter((g) => groups[g]?.length > 0);
  const priorityGroups = orderedGroups.slice(0, 3);
  const extraGroups = orderedGroups.slice(3);

  const renderGroup = (groupName: string) => (
    <div key={groupName}>
      <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">{groupName}</p>
      <div className="space-y-1 mb-4">
        {groups[groupName].map(({ key, label, value }) => {
          const isGreen = value.startsWith("+") || (label.includes("Growth") && !value.startsWith("-") && value.includes("%") && value !== "None");
          const isRed = value.startsWith("-");
          return (
            <div key={key} className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
              <span className="text-sm text-muted-foreground">{label}</span>
              <span className={`text-sm font-semibold ${isGreen ? "text-emerald-600" : isRed ? "text-rose-600" : "text-foreground"}`}>
                {value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="bg-card border border-border rounded-xl p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <BarChart2 className="w-5 h-5 text-primary" />
        <h3 className="font-bold text-foreground">Key Metrics</h3>
        <span className="flex items-center gap-1 ml-auto text-xs text-emerald-600 font-medium">
          <Zap className="w-3 h-3" /> Live from Yahoo Finance
        </span>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6">
        {priorityGroups.map(renderGroup)}
        {expanded && extraGroups.map(renderGroup)}
      </div>
      {extraGroups.length > 0 && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        >
          {expanded ? <><ChevronUp className="w-3.5 h-3.5" /> Show less</> : <><ChevronDown className="w-3.5 h-3.5" /> Show {extraGroups.reduce((a, g) => a + groups[g].length, 0)} more metrics</>}
        </button>
      )}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function ResearchDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id, 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [steps, setSteps] = useState<ProgressStep[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const hasStreamed = useRef(false);
  const sseCompleted = useRef(false);
  const [copied, setCopied] = useState(false);

  const { data: session, isLoading } = useGetResearch(id, {
    query: {
      enabled: !!id,
      queryKey: getGetResearchQueryKey(id),
      refetchOnWindowFocus: false,
      refetchInterval: (query: unknown) => {
        const status = (query as { state?: { data?: ResearchSession } })?.state?.data?.status;
        if (!status) return 5000;
        return status === "pending" || status === "running" ? 5000 : false;
      },
    },
  });

  const s = session as ResearchSession | undefined;

  useEffect(() => {
    if (!s || hasStreamed.current) return;
    if (s.status !== "pending" && s.status !== "running") return;

    hasStreamed.current = true;
    const es = new EventSource(`/api/research/${id}/stream`);

    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "progress" && data.step) {
        setSteps((prev) => {
          if (prev.find((p) => p.step === data.step)) return prev;
          const updated = prev.map((p) => ({ ...p, done: true }));
          return [...updated, { step: data.step, message: data.message ?? "", done: false }];
        });
      } else if (data.type === "complete") {
        sseCompleted.current = true;
        setSteps((prev) => prev.map((p) => ({ ...p, done: true })));
        queryClient.invalidateQueries({ queryKey: getGetResearchQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListResearchQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetResearchStatsQueryKey() });
        es.close();
      } else if (data.type === "error") {
        sseCompleted.current = true;
        setStreamError(data.message ?? "Research failed.");
        queryClient.invalidateQueries({ queryKey: getGetResearchQueryKey(id) });
        es.close();
      }
    };

    es.onerror = () => {
      if (!sseCompleted.current) {
        setStreamError("Connection lost. Please refresh the page.");
      }
      es.close();
    };
    return () => es.close();
  }, [s?.status, id, queryClient]);

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!s) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
        Research session not found.
      </div>
    );
  }

  const bulletsFor: string[] = s.bulletsFor ? JSON.parse(s.bulletsFor) : [];
  const bulletsAgainst: string[] = s.bulletsAgainst ? JSON.parse(s.bulletsAgainst) : [];
  const rawFinancial: Record<string, unknown> = s.financialData ? JSON.parse(s.financialData) : {};
  const newsHeadlines: NewsItem[] = s.newsHeadlines ? JSON.parse(s.newsHeadlines) : [];
  const priceHistory: PricePoint[] = s.priceHistory ? JSON.parse(s.priceHistory) : [];

  // Extract embedded structured data
  const investmentScores = rawFinancial._scores as InvestmentScores | undefined;
  const confidenceFactors = rawFinancial._confidenceFactors as ConfidenceFactors | undefined;
  const companyProfile = rawFinancial._profile as CompanyProfile | undefined;

  // Strip _ keys from financial display
  const financialData: Record<string, string> = Object.fromEntries(
    Object.entries(rawFinancial).filter(([k, v]) => !k.startsWith("_") && typeof v === "string")
  ) as Record<string, string>;

  const isInvest    = s.verdict === "INVEST";
  const isCompleted = s.status === "completed";
  const isFailed    = s.status === "failed";
  const isPending   = s.status === "pending" || s.status === "running";

  const overallScore = investmentScores
    ? Math.round((investmentScores.financials + investmentScores.valuation + investmentScores.growth + investmentScores.risk + investmentScores.news + investmentScores.sentiment) / 6)
    : null;

  const scoreEntries = investmentScores ? [
    { label: "Financials",  value: investmentScores.financials,  color: "#10b981" },
    { label: "Valuation",   value: investmentScores.valuation,   color: "#3b82f6" },
    { label: "Growth",      value: investmentScores.growth,      color: "#8b5cf6" },
    { label: "Risk",        value: investmentScores.risk,        color: "#f59e0b" },
    { label: "News",        value: investmentScores.news,        color: "#06b6d4" },
    { label: "Sentiment",   value: investmentScores.sentiment,   color: "#f43f5e" },
  ] : [];

  const confidenceItems = confidenceFactors ? [
    { label: "Financial Data",      value: confidenceFactors.dataQuality },
    { label: "News Quality",        value: confidenceFactors.newsQuality },
    { label: "Analyst Consensus",   value: confidenceFactors.analystConsensus },
    { label: "Sentiment",           value: confidenceFactors.sentiment },
  ] : [];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3">
          <button
            data-testid="button-back"
            onClick={() => setLocation("/")}
            className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground flex-shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0 shadow-sm">
            <BarChart2 className="w-4 h-4 text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-foreground leading-none truncate">{s.company}</h1>
              {s.ticker && (
                <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground flex-shrink-0">{s.ticker}</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground hidden sm:block">AlphaAgent · AI Investment Research</p>
          </div>
          {isCompleted && (
            <button
              onClick={handleShare}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground flex-shrink-0"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{copied ? "Copied!" : "Share"}</span>
            </button>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* Error */}
        {(isFailed || streamError) && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-5 flex items-start gap-3 mb-6">
            <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-destructive">Research Failed</p>
              <p className="text-sm text-destructive/80 mt-1">{streamError ?? "An error occurred. Please try again."}</p>
            </div>
          </div>
        )}

        {/* Progress */}
        {isPending && !isFailed && <ProgressView steps={steps} company={s.company} />}

        {/* Results */}
        {isCompleted && s.verdict && (
          <div className="space-y-4 sm:space-y-5">

            {/* 1. Company Info Card */}
            {(companyProfile || s.ticker) && (
              <div className="bg-card border border-border rounded-xl p-4 sm:p-5">
                <div className="flex items-start gap-4">
                  <CompanyLogo
                    company={s.company}
                    website={companyProfile?.website}
                    size={52}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h2 className="font-extrabold text-foreground text-lg leading-none">{companyProfile?.longName ?? s.company}</h2>
                      {s.ticker && <span className="font-mono text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-bold">{s.ticker}</span>}
                      {companyProfile?.exchange && <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">{companyProfile.exchange}</span>}
                    </div>
                    {(companyProfile?.sector || companyProfile?.industry) && (
                      <p className="text-sm text-muted-foreground mb-3">
                        {[companyProfile.sector, companyProfile.industry].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
                      {companyProfile?.marketCap && (
                        <div><p className="text-xs text-muted-foreground">Market Cap</p><p className="text-sm font-semibold text-foreground">{companyProfile.marketCap}</p></div>
                      )}
                      {companyProfile?.founded && (
                        <div><p className="text-xs text-muted-foreground">Founded</p><p className="text-sm font-semibold text-foreground">{companyProfile.founded}</p></div>
                      )}
                      {companyProfile?.ceo && (
                        <div><p className="text-xs text-muted-foreground">CEO</p><p className="text-sm font-semibold text-foreground truncate">{companyProfile.ceo}</p></div>
                      )}
                      {companyProfile?.hq && (
                        <div><p className="text-xs text-muted-foreground">Headquarters</p><p className="text-sm font-semibold text-foreground truncate">{companyProfile.hq}</p></div>
                      )}
                      {companyProfile?.employees && (
                        <div><p className="text-xs text-muted-foreground">Employees</p><p className="text-sm font-semibold text-foreground">{companyProfile.employees}</p></div>
                      )}
                      {companyProfile?.website && (
                        <div>
                          <p className="text-xs text-muted-foreground">Website</p>
                          <a href={companyProfile.website} target="_blank" rel="noopener noreferrer"
                            className="text-sm font-semibold text-primary hover:underline truncate flex items-center gap-1">
                            <Globe className="w-3 h-3" /> Visit
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 2. Verdict Banner */}
            <div className={`rounded-2xl p-5 sm:p-7 border ${
              isInvest
                ? "bg-gradient-to-br from-emerald-50 to-emerald-100/40 border-emerald-200"
                : "bg-gradient-to-br from-rose-50 to-rose-100/40 border-rose-200"
            }`}>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-6">
                <div className="flex items-center gap-4">
                  <div className={`w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center flex-shrink-0 ${isInvest ? "bg-emerald-100" : "bg-rose-100"}`}>
                    {isInvest
                      ? <TrendingUp className="w-7 h-7 sm:w-8 sm:h-8 text-emerald-700" />
                      : <TrendingDown className="w-7 h-7 sm:w-8 sm:h-8 text-rose-700" />}
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-0.5">AI Verdict</p>
                    <h2 className={`text-4xl sm:text-5xl font-extrabold tracking-tight leading-none ${isInvest ? "text-emerald-700" : "text-rose-700"}`}>
                      {s.verdict}
                    </h2>
                    {s.summary && (
                      <p className="text-sm text-muted-foreground mt-2 max-w-lg leading-relaxed">{s.summary}</p>
                    )}
                  </div>
                </div>
                {s.confidenceScore != null && (
                  <div className="flex-shrink-0 self-center">
                    <ConfidenceRing score={s.confidenceScore} />
                  </div>
                )}
              </div>
            </div>

            {/* 3. Investment Score Breakdown */}
            {overallScore != null && scoreEntries.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-4 sm:p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Award className="w-5 h-5 text-primary" />
                  <h3 className="font-bold text-foreground">Investment Score Breakdown</h3>
                </div>
                <div className="flex flex-col sm:flex-row gap-5 sm:gap-8">
                  {/* Overall score circle */}
                  <div className="flex flex-col items-center justify-center gap-1 flex-shrink-0">
                    <div className="relative w-20 h-20">
                      <svg className="w-20 h-20" viewBox="0 0 80 80">
                        <circle cx="40" cy="40" r="32" fill="none" stroke="currentColor" strokeWidth="6" opacity="0.12" />
                        <circle cx="40" cy="40" r="32" fill="none"
                          stroke={overallScore >= 70 ? "#10b981" : overallScore >= 50 ? "#f59e0b" : "#ef4444"}
                          strokeWidth="6"
                          strokeDasharray={2 * Math.PI * 32}
                          strokeDashoffset={2 * Math.PI * 32 * (1 - overallScore / 100)}
                          strokeLinecap="round"
                          transform="rotate(-90 40 40)"
                          style={{ transition: "stroke-dashoffset 1.2s ease" }}
                        />
                        <text x="40" y="36" textAnchor="middle" fontSize="16" fontWeight="800" fill="currentColor">{overallScore}</text>
                        <text x="40" y="50" textAnchor="middle" fontSize="8" fill="currentColor" opacity="0.5" fontWeight="600">OVERALL</text>
                      </svg>
                    </div>
                    <span className="text-xs text-muted-foreground font-medium">Score</span>
                  </div>
                  {/* Sub-scores */}
                  <div className="flex-1 grid sm:grid-cols-2 gap-x-6 gap-y-3">
                    {scoreEntries.map(({ label, value, color }) => (
                      <ScoreBar key={label} label={label} value={value} color={color} />
                    ))}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-4">
                  Scores are generated by GPT-4o based on real market data. Higher = stronger. Risk score: 100 = very low risk.
                </p>
              </div>
            )}

            {/* 4. Confidence Breakdown */}
            {confidenceItems.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-4 sm:p-5">
                <div className="flex items-center gap-2 mb-4">
                  <ShieldCheck className="w-5 h-5 text-primary" />
                  <h3 className="font-bold text-foreground">Confidence Breakdown</h3>
                  {s.confidenceScore != null && (
                    <span className="ml-auto text-lg font-extrabold text-foreground">{Math.round(s.confidenceScore)}%</span>
                  )}
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  {confidenceItems.map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0 sm:last:border-0">
                      <span className="text-sm text-muted-foreground">{label}</span>
                      <StarRating value={value} />
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  ★★★★★ = excellent data/signal quality for this dimension.
                </p>
              </div>
            )}

            {/* 5. Price chart */}
            {priceHistory.length >= 2 && s.ticker && (
              <PriceChart
                history={priceHistory}
                ticker={s.ticker}
                currentPrice={financialData["currentPrice"]}
                changePercent={financialData["dayChange"]}
              />
            )}

            {/* 6. Bull vs Bear */}
            {(bulletsFor.length > 0 || bulletsAgainst.length > 0) && (
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="bg-card border border-border rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center">
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    </div>
                    <h3 className="font-bold text-foreground">Bull Case</h3>
                    <span className="text-xs text-muted-foreground ml-auto">{bulletsFor.length} points</span>
                  </div>
                  <ul className="space-y-3">
                    {bulletsFor.map((b, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm text-foreground leading-relaxed">
                        <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">{i + 1}</span>
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="bg-card border border-border rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-7 h-7 rounded-lg bg-rose-100 flex items-center justify-center">
                      <ShieldX className="w-4 h-4 text-rose-600" />
                    </div>
                    <h3 className="font-bold text-foreground">Bear Case</h3>
                    <span className="text-xs text-muted-foreground ml-auto">{bulletsAgainst.length} points</span>
                  </div>
                  <ul className="space-y-3">
                    {bulletsAgainst.map((b, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm text-foreground leading-relaxed">
                        <span className="w-5 h-5 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">{i + 1}</span>
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* 7. Financial metrics */}
            {Object.keys(financialData).length > 0 && <MetricsTable data={financialData} />}

            {/* 8. Analyst Reasoning */}
            {s.reasoning && (
              <div className="bg-card border border-border rounded-xl p-4 sm:p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Info className="w-5 h-5 text-primary" />
                  <h3 className="font-bold text-foreground">Analyst Reasoning</h3>
                </div>
                <div className="space-y-3">
                  {s.reasoning.split(/\n\n|\n(?=\*\*)/).filter(Boolean).map((para, i) => {
                    const boldMatch = para.match(/^\*\*(.+?)\*\*:?\s*(.*)/s);
                    if (boldMatch) {
                      return (
                        <div key={i} className="bg-muted/30 rounded-lg p-3 sm:p-4">
                          <p className="text-sm font-bold text-foreground mb-1">{boldMatch[1]}</p>
                          <p className="text-sm text-muted-foreground leading-relaxed">{boldMatch[2]}</p>
                        </div>
                      );
                    }
                    return <p key={i} className="text-sm text-muted-foreground leading-relaxed">{para}</p>;
                  })}
                </div>
              </div>
            )}

            {/* 9. News with sentiment */}
            {newsHeadlines.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <Newspaper className="w-5 h-5 text-primary" />
                  <h3 className="font-bold text-foreground">Recent News</h3>
                  <div className="flex items-center gap-3 ml-auto text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />Positive</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />Negative</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-muted-foreground/40 inline-block" />Neutral</span>
                  </div>
                </div>
                <div className="space-y-2">
                  {newsHeadlines.map((n, i) => {
                    const sentDot = n.sentiment === "positive"
                      ? "bg-emerald-500"
                      : n.sentiment === "negative"
                      ? "bg-rose-500"
                      : "bg-muted-foreground/40";
                    return (
                      <div key={i} className={`rounded-lg p-3 border transition-colors ${
                        n.sentiment === "positive" ? "border-emerald-100 bg-emerald-50/40 hover:bg-emerald-50" :
                        n.sentiment === "negative" ? "border-rose-100 bg-rose-50/40 hover:bg-rose-50" :
                        "border-border bg-muted/20 hover:bg-muted/40"
                      }`}>
                        <div className="flex items-start gap-2.5">
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${sentDot}`} />
                          <div className="flex-1 min-w-0">
                            {n.link ? (
                              <a href={n.link} target="_blank" rel="noopener noreferrer"
                                className="group flex items-start gap-1.5 hover:underline" onClick={(e) => e.stopPropagation()}>
                                <p className="text-sm font-medium text-foreground leading-snug">{n.title}</p>
                                <ExternalLink className="w-3 h-3 flex-shrink-0 mt-0.5 text-muted-foreground" />
                              </a>
                            ) : (
                              <p className="text-sm font-medium text-foreground leading-snug">{n.title}</p>
                            )}
                            {(n.source || n.date) && (
                              <p className="text-xs text-muted-foreground mt-0.5">{[n.source, n.date].filter(Boolean).join(" · ")}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 10. AI Pipeline */}
            <div className="bg-card border border-border rounded-xl p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-4">
                <Activity className="w-5 h-5 text-primary" />
                <h3 className="font-bold text-foreground">How This Analysis Was Generated</h3>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {[
                  { icon: "👤", label: "User Input", sub: s.company },
                  { icon: "🔗", label: "LangGraph", sub: "4-node pipeline" },
                  { icon: "📊", label: "Yahoo Finance", sub: "Live market data" },
                  { icon: "📰", label: "News Search", sub: `${newsHeadlines.length} articles` },
                  { icon: "🧠", label: "GPT-4o", sub: "LLM reasoning" },
                  { icon: "⚖️", label: "Verdict", sub: s.verdict ?? "" },
                ].map((step, i, arr) => (
                  <div key={step.label} className="flex items-center gap-2">
                    <div className="flex flex-col items-center text-center px-3 py-2 rounded-lg bg-muted/40 border border-border/50">
                      <span className="text-lg">{step.icon}</span>
                      <span className="text-xs font-semibold text-foreground mt-0.5">{step.label}</span>
                      <span className="text-xs text-muted-foreground">{step.sub}</span>
                    </div>
                    {i < arr.length - 1 && <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0" />}
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            {s.completedAt && (
              <p className="text-xs text-muted-foreground text-center pt-2">
                Analysis completed {new Date(s.completedAt).toLocaleString()} · AlphaAgent powered by LangGraph + GPT-4o + Yahoo Finance
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
