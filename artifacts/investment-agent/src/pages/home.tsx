import { useState } from "react";
import { useLocation } from "wouter";
import { useListResearch, useStartResearch, useDeleteResearch, useGetResearchStats, getListResearchQueryKey, getGetResearchStatsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Search, Trash2, Clock, BarChart2, ChevronRight, Loader2, Activity, Sparkles, Shield, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ResearchSession {
  id: number;
  company: string;
  ticker: string | null;
  status: string;
  verdict: string | null;
  summary: string | null;
  confidenceScore: number | null;
  createdAt: string;
  completedAt: string | null;
}

const EXAMPLE_COMPANIES = ["Apple", "Nvidia", "Tesla", "Amazon", "Microsoft", "Meta", "Netflix", "Palantir"];

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 sm:p-5 animate-fade-in">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">{label}</p>
      <p className={`text-2xl sm:text-3xl font-bold ${accent ?? "text-foreground"}`}>{value}</p>
    </div>
  );
}

function SessionCard({ session, onDelete }: { session: ResearchSession; onDelete: () => void }) {
  const [, setLocation] = useLocation();
  const isInvest = session.verdict === "INVEST";
  const isPass = session.verdict === "PASS";
  const isPending = session.status === "pending" || session.status === "running";

  return (
    <div
      data-testid={`card-session-${session.id}`}
      className="bg-card border border-border rounded-xl p-4 sm:p-5 flex items-start gap-3 sm:gap-4 hover:shadow-md hover:border-primary/30 transition-all cursor-pointer group"
      onClick={() => setLocation(`/research/${session.id}`)}
    >
      <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${
        isInvest ? "bg-emerald-100 text-emerald-700" :
        isPass   ? "bg-rose-100 text-rose-700" :
                   "bg-muted text-muted-foreground"
      }`}>
        {isPending ? <Loader2 className="w-5 h-5 animate-spin" /> :
         isInvest  ? <TrendingUp className="w-5 h-5" /> :
         isPass    ? <TrendingDown className="w-5 h-5" /> :
                     <Activity className="w-5 h-5" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <h3 className="font-semibold text-foreground truncate">{session.company}</h3>
          {session.ticker && (
            <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{session.ticker}</span>
          )}
          {session.verdict && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              isInvest ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
            }`}>{session.verdict}</span>
          )}
          {isPending && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              {session.status === "running" ? "Running…" : "Pending"}
            </span>
          )}
        </div>
        {session.summary && (
          <p className="text-sm text-muted-foreground line-clamp-2">{session.summary}</p>
        )}
        <div className="flex items-center gap-3 mt-2">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {new Date(session.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </span>
          {session.confidenceScore != null && (
            <span className="text-xs text-muted-foreground">{Math.round(session.confidenceScore)}% confidence</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          data-testid={`button-delete-${session.id}`}
          className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-all"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        >
          <Trash2 className="w-4 h-4" />
        </button>
        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
      </div>
    </div>
  );
}

export default function Home() {
  const [company, setCompany] = useState("");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: sessions = [], isLoading: sessionsLoading } = useListResearch();
  const { data: stats } = useGetResearchStats();
  const startResearch = useStartResearch();
  const deleteResearch = useDeleteResearch();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = company.trim();
    if (!trimmed) return;
    startResearch.mutate(
      { data: { company: trimmed } },
      {
        onSuccess: (session) => {
          setCompany("");
          queryClient.invalidateQueries({ queryKey: getListResearchQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetResearchStatsQueryKey() });
          setLocation(`/research/${session.id}`);
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to start research. Try again.", variant: "destructive" });
        },
      }
    );
  };

  const handleDelete = (id: number) => {
    deleteResearch.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListResearchQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetResearchStatsQueryKey() });
          toast({ title: "Deleted", description: "Research session removed." });
        },
      }
    );
  };

  const investRate = stats && stats.completed > 0
    ? Math.round((stats.investCount / stats.completed) * 100)
    : null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-sm">
              <BarChart2 className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-extrabold text-foreground leading-none tracking-tight">AlphaAgent</h1>
              <p className="text-xs text-muted-foreground hidden sm:block">AI Investment Research · GPT-4o + Yahoo Finance</p>
            </div>
          </div>
          <span className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live Data
          </span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-14">
        {/* Hero */}
        <div className="text-center mb-8 sm:mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold mb-4">
            <Sparkles className="w-3 h-3" />
            LangGraph Agent · Real-Time Yahoo Finance Data
          </div>
          <h2 className="text-3xl sm:text-5xl font-extrabold text-foreground mb-3 tracking-tight leading-tight">
            Research any public company.<br className="hidden sm:block" />
            Get a clear verdict.
          </h2>
          <p className="text-muted-foreground text-base sm:text-lg max-w-xl mx-auto">
            Our AI agent fetches live market data, scans real news, and delivers an{" "}
            <strong className="text-foreground">INVEST</strong> or{" "}
            <strong className="text-foreground">PASS</strong> recommendation with full reasoning.
          </p>
        </div>

        {/* Feature pills */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-8 sm:mb-10 max-w-2xl mx-auto">
          {[
            { icon: Zap, label: "Live Prices", sub: "Yahoo Finance" },
            { icon: Sparkles, label: "LangGraph Agent", sub: "Multi-step AI" },
            { icon: Shield, label: "Bull & Bear", sub: "Full reasoning" },
          ].map(({ icon: Icon, label, sub }) => (
            <div key={label} className="flex flex-col items-center gap-1 p-2 sm:p-3 rounded-xl bg-card border border-border text-center">
              <Icon className="w-4 h-4 text-primary" />
              <p className="text-xs font-semibold text-foreground">{label}</p>
              <p className="text-xs text-muted-foreground hidden sm:block">{sub}</p>
            </div>
          ))}
        </div>

        {/* Search */}
        <form onSubmit={handleSubmit} className="mb-4 sm:mb-6">
          <div className="flex gap-2 max-w-2xl mx-auto">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                data-testid="input-company"
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="e.g. Apple, Nvidia, Tesla, Reliance…"
                className="w-full pl-10 pr-4 py-3 sm:py-3.5 border border-input rounded-xl bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm shadow-sm"
                disabled={startResearch.isPending}
              />
            </div>
            <button
              data-testid="button-research"
              type="submit"
              disabled={startResearch.isPending || !company.trim()}
              className="px-4 sm:px-6 py-3 sm:py-3.5 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-sm whitespace-nowrap"
            >
              {startResearch.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Sparkles className="w-4 h-4" />}
              <span className="hidden sm:inline">{startResearch.isPending ? "Starting…" : "Analyze"}</span>
              <span className="sm:hidden">{startResearch.isPending ? "…" : "Go"}</span>
            </button>
          </div>
        </form>

        {/* Example chips */}
        <div className="flex flex-wrap justify-center gap-2 mb-8 sm:mb-12">
          {EXAMPLE_COMPANIES.map((c) => (
            <button
              key={c}
              onClick={() => setCompany(c)}
              disabled={startResearch.isPending}
              className="text-xs px-3 py-1.5 rounded-full border border-border bg-card hover:bg-muted hover:border-primary/40 text-muted-foreground hover:text-foreground transition-all disabled:opacity-40"
            >
              {c}
            </button>
          ))}
        </div>

        {/* Stats */}
        {stats && stats.total > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8 sm:mb-10">
            <StatCard label="Analyses" value={stats.total} />
            <StatCard
              label="Invest Rate"
              value={investRate != null ? `${investRate}%` : "—"}
              accent={investRate != null && investRate >= 50 ? "text-emerald-600" : "text-rose-600"}
            />
            <StatCard label="Invest / Pass" value={`${stats.investCount} / ${stats.passCount}`} />
            <StatCard
              label="Avg Confidence"
              value={stats.avgConfidence != null ? `${Math.round(stats.avgConfidence)}%` : "—"}
            />
          </div>
        )}

        {/* History */}
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
            <BarChart2 className="w-3.5 h-3.5" /> Research History
          </h3>
          {sessionsLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-border rounded-2xl">
              <BarChart2 className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">No research sessions yet</p>
              <p className="text-sm text-muted-foreground mt-1">Enter a company above to get started</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {(sessions as ResearchSession[]).map((s) => (
                <SessionCard key={s.id} session={s} onDelete={() => handleDelete(s.id)} />
              ))}
            </div>
          )}
        </div>
      </main>

      <footer className="border-t border-border mt-16 py-6 text-center text-xs text-muted-foreground">
        AlphaAgent · Built with LangGraph + GPT-4o + Yahoo Finance · Live market data
      </footer>
    </div>
  );
}
