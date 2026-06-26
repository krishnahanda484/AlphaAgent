import yahooFinance from "yahoo-finance2";
import { logger } from "./logger";

export interface StockQuote {
  ticker: string;
  shortName: string;
  longName: string;
  currentPrice: number | null;
  previousClose: number | null;
  regularMarketChangePercent: number | null;
  marketCap: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  priceToBook: number | null;
  trailingAnnualDividendYield: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  volume: number | null;
  averageVolume: number | null;
  sector: string | null;
  industry: string | null;
  totalRevenue: number | null;
  revenueGrowth: number | null;
  grossMargins: number | null;
  ebitdaMargins: number | null;
  profitMargins: number | null;
  debtToEquity: number | null;
  freeCashflow: number | null;
  returnOnEquity: number | null;
  earningsGrowth: number | null;
  beta: number | null;
  enterpriseValue: number | null;
  enterpriseToEbitda: number | null;
  // Extended company profile fields
  exchange: string | null;
  ceo: string | null;
  hq: string | null;
  founded: string | null;
  website: string | null;
  fullTimeEmployees: number | null;
  trailingEps: number | null;
  forwardEps: number | null;
  dividendRate: number | null;
}

export interface PricePoint {
  date: string;
  close: number;
}

export interface NewsItem {
  title: string;
  source: string;
  date: string;
  link?: string;
}

export async function findTicker(company: string): Promise<string | null> {
  try {
    const results = await yahooFinance.search(company, { quotesCount: 5, newsCount: 0 });
    const equities = results.quotes?.filter((q) => q.quoteType === "EQUITY");
    if (equities && equities.length > 0) {
      const first = equities[0];
      return "symbol" in first ? (first.symbol as string) : null;
    }
    return null;
  } catch (err) {
    logger.warn({ err, company }, "Yahoo Finance ticker search failed");
    return null;
  }
}

export async function fetchStockQuote(ticker: string): Promise<StockQuote | null> {
  try {
    const [quote, summary] = await Promise.allSettled([
      yahooFinance.quote(ticker),
      yahooFinance.quoteSummary(ticker, {
        modules: ["financialData", "defaultKeyStatistics", "assetProfile", "incomeStatementHistory"],
      }),
    ]);

    const q = quote.status === "fulfilled" ? quote.value : null;
    const s = summary.status === "fulfilled" ? summary.value : null;

    if (!q) return null;

    const financial = s?.financialData;
    const keyStats = s?.defaultKeyStatistics;
    const profile = s?.assetProfile;

    // Extract CEO from officers list
    let ceo: string | null = null;
    if (profile && "companyOfficers" in profile && Array.isArray((profile as Record<string, unknown>).companyOfficers)) {
      const officers = (profile as Record<string, { title?: string; name?: string }[]>).companyOfficers;
      const ceoOfficer = officers.find((o) =>
        o.title?.toLowerCase().includes("chief executive") || o.title?.toLowerCase().includes("ceo")
      );
      if (ceoOfficer?.name) ceo = ceoOfficer.name;
    }

    // Build HQ string
    let hq: string | null = null;
    if (profile) {
      const p = profile as Record<string, string | undefined>;
      const parts = [p.city, p.state, p.country].filter(Boolean);
      if (parts.length > 0) hq = parts.join(", ");
    }

    return {
      ticker,
      shortName: q.shortName ?? ticker,
      longName: q.longName ?? q.shortName ?? ticker,
      currentPrice: q.regularMarketPrice ?? null,
      previousClose: q.regularMarketPreviousClose ?? null,
      regularMarketChangePercent: q.regularMarketChangePercent ?? null,
      marketCap: q.marketCap ?? null,
      trailingPE: q.trailingPE ?? null,
      forwardPE: q.forwardPE ?? null,
      priceToBook: keyStats?.priceToBook ?? null,
      trailingAnnualDividendYield: q.trailingAnnualDividendYield ?? null,
      fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? null,
      volume: q.regularMarketVolume ?? null,
      averageVolume: q.averageDailyVolume3Month ?? null,
      sector: profile?.sector ?? (q as Record<string, unknown>).sector as string ?? null,
      industry: profile?.industry ?? null,
      totalRevenue: financial?.totalRevenue ?? null,
      revenueGrowth: financial?.revenueGrowth ?? null,
      grossMargins: financial?.grossMargins ?? null,
      ebitdaMargins: financial?.ebitdaMargins ?? null,
      profitMargins: financial?.profitMargins ?? null,
      debtToEquity: financial?.debtToEquity ?? null,
      freeCashflow: financial?.freeCashflow ?? null,
      returnOnEquity: financial?.returnOnEquity ?? null,
      earningsGrowth: financial?.earningsGrowth ?? null,
      beta: keyStats?.beta ?? null,
      enterpriseValue: keyStats?.enterpriseValue ?? null,
      enterpriseToEbitda: keyStats?.enterpriseToEbitda ?? null,
      exchange: (q as Record<string, unknown>).fullExchangeName as string ?? (q as Record<string, unknown>).exchange as string ?? null,
      ceo,
      hq,
      founded: profile && "foundedYear" in profile ? String((profile as Record<string, unknown>).foundedYear) : null,
      website: profile && "website" in profile ? (profile as Record<string, unknown>).website as string : null,
      fullTimeEmployees: profile && "fullTimeEmployees" in profile ? (profile as Record<string, unknown>).fullTimeEmployees as number : null,
      trailingEps: q.epsTrailingTwelveMonths ?? null,
      forwardEps: q.epsForward ?? null,
      dividendRate: q.trailingAnnualDividendRate ?? null,
    };
  } catch (err) {
    logger.warn({ err, ticker }, "Yahoo Finance quote fetch failed");
    return null;
  }
}

export async function fetchPriceHistory(ticker: string, days = 90): Promise<PricePoint[]> {
  try {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);

    const history = await yahooFinance.historical(ticker, {
      period1: start,
      period2: end,
      interval: "1d",
    });

    return history
      .filter((h) => h.close != null)
      .map((h) => ({
        date: h.date.toISOString().split("T")[0],
        close: h.close as number,
      }));
  } catch (err) {
    logger.warn({ err, ticker }, "Yahoo Finance price history fetch failed");
    return [];
  }
}

export async function fetchNews(ticker: string): Promise<NewsItem[]> {
  try {
    const result = await yahooFinance.search(ticker, { quotesCount: 0, newsCount: 8 });
    return (result.news ?? []).map((n) => ({
      title: n.title,
      source: n.publisher ?? "Yahoo Finance",
      date: n.providerPublishTime
        ? new Date(n.providerPublishTime).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "",
      link: n.link,
    }));
  } catch (err) {
    logger.warn({ err, ticker }, "Yahoo Finance news fetch failed");
    return [];
  }
}

export function formatMarketCap(value: number | null): string | null {
  if (value == null) return null;
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toFixed(0)}`;
}

export function formatRevenue(value: number | null): string | null {
  if (value == null) return null;
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toFixed(0)}`;
}

export function formatPct(value: number | null): string | null {
  if (value == null) return null;
  return `${(value * 100).toFixed(1)}%`;
}

export function formatNum(value: number | null, decimals = 1): string | null {
  if (value == null) return null;
  return value.toFixed(decimals) + "x";
}
