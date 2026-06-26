import { Router, type IRouter } from "express";
import { eq, avg, count, sql } from "drizzle-orm";
import { db, researchTable } from "@workspace/db";
import {
  StartResearchBody,
  GetResearchParams,
  DeleteResearchParams,
  StreamResearchParams,
} from "@workspace/api-zod";
import { runResearchAgent } from "../../lib/researcher";

const router: IRouter = Router();

router.get("/research/stats", async (req, res): Promise<void> => {
  const rows = await db.select().from(researchTable);
  const completed = rows.filter((r) => r.status === "completed");
  const investCount = completed.filter((r) => r.verdict === "INVEST").length;
  const passCount = completed.filter((r) => r.verdict === "PASS").length;
  const scores = completed
    .map((r) => r.confidenceScore)
    .filter((s): s is number => s != null);
  const avgConfidence =
    scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : null;

  res.json({
    total: rows.length,
    completed: completed.length,
    investCount,
    passCount,
    avgConfidence,
  });
});

router.get("/research", async (req, res): Promise<void> => {
  const sessions = await db
    .select()
    .from(researchTable)
    .orderBy(sql`${researchTable.createdAt} desc`);
  res.json(
    sessions.map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
      completedAt: s.completedAt?.toISOString() ?? null,
    }))
  );
});

router.post("/research", async (req, res): Promise<void> => {
  const parsed = StartResearchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [session] = await db
    .insert(researchTable)
    .values({ company: parsed.data.company, status: "pending" })
    .returning();

  res.status(201).json({
    ...session,
    createdAt: session.createdAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
  });
});

router.get("/research/:id/stream", async (req, res): Promise<void> => {
  const params = StreamResearchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [session] = await db
    .select()
    .from(researchTable)
    .where(eq(researchTable.id, params.data.id));

  if (!session) {
    res.status(404).json({ error: "Research session not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  if (session.status === "completed" || session.status === "failed") {
    const updated = await db
      .select()
      .from(researchTable)
      .where(eq(researchTable.id, session.id));
    send({
      type: "complete",
      data: {
        ...updated[0],
        createdAt: updated[0].createdAt.toISOString(),
        completedAt: updated[0].completedAt?.toISOString() ?? null,
      },
    });
    res.end();
    return;
  }

  await db
    .update(researchTable)
    .set({ status: "running" })
    .where(eq(researchTable.id, session.id));

  send({ type: "progress", step: "Starting research agent", message: `Researching ${session.company}...` });

  try {
    const result = await runResearchAgent(session.company, (progress) => {
      send(progress);
    });

    // Embed extra structured data into financialData JSON under _ prefixed keys
    const enrichedFinancialData = {
      ...result.financialData,
      _scores: result.investmentScores,
      _confidenceFactors: result.confidenceFactors,
      _profile: result.companyProfile,
    };

    const [updated] = await db
      .update(researchTable)
      .set({
        status: "completed",
        ticker: result.ticker,
        verdict: result.verdict,
        summary: result.summary,
        reasoning: result.reasoning,
        bulletsFor: JSON.stringify(result.bulletsFor),
        bulletsAgainst: JSON.stringify(result.bulletsAgainst),
        financialData: JSON.stringify(enrichedFinancialData),
        newsHeadlines: JSON.stringify(result.newsHeadlines),
        priceHistory: JSON.stringify(result.priceHistory),
        confidenceScore: result.confidenceScore,
        completedAt: new Date(),
      })
      .where(eq(researchTable.id, session.id))
      .returning();

    send({
      type: "complete",
      data: {
        ...updated,
        createdAt: updated.createdAt.toISOString(),
        completedAt: updated.completedAt?.toISOString() ?? null,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Research agent failed");
    await db
      .update(researchTable)
      .set({ status: "failed" })
      .where(eq(researchTable.id, session.id));
    send({ type: "error", message: (err as Error).message ?? "Research failed" });
  }

  res.end();
});

router.get("/research/:id", async (req, res): Promise<void> => {
  const params = GetResearchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [session] = await db
    .select()
    .from(researchTable)
    .where(eq(researchTable.id, params.data.id));

  if (!session) {
    res.status(404).json({ error: "Research session not found" });
    return;
  }

  res.json({
    ...session,
    createdAt: session.createdAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
  });
});

router.delete("/research/:id", async (req, res): Promise<void> => {
  const params = DeleteResearchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(researchTable)
    .where(eq(researchTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Research session not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
