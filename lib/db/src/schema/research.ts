import { pgTable, text, serial, timestamp, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const researchTable = pgTable("research_sessions", {
  id: serial("id").primaryKey(),
  company: text("company").notNull(),
  status: text("status").notNull().default("pending"),
  verdict: text("verdict"),
  summary: text("summary"),
  reasoning: text("reasoning"),
  bulletsFor: text("bullets_for"),
  bulletsAgainst: text("bullets_against"),
  financialData: text("financial_data"),
  newsHeadlines: text("news_headlines"),
  priceHistory: text("price_history"),
  ticker: text("ticker"),
  confidenceScore: real("confidence_score"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const insertResearchSchema = createInsertSchema(researchTable).omit({
  id: true,
  createdAt: true,
});
export type InsertResearch = z.infer<typeof insertResearchSchema>;
export type ResearchSession = typeof researchTable.$inferSelect;
