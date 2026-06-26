# AlphaAgent — AI Investment Research Agent

An autonomous AI agent that takes a company name, conducts deep financial and market research using Claude, and delivers a clear **INVEST** or **PASS** verdict — streamed live to the UI with step-by-step progress.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/investment-agent run dev` — run the frontend
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required env: `ANTHROPIC_API_KEY` — Anthropic API key for Claude

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 18, Vite, Tailwind CSS, TanStack Query, wouter
- API: Express 5
- AI: Anthropic Claude (claude-opus-4-8) via `@anthropic-ai/sdk`
- DB: PostgreSQL + Drizzle ORM
- Streaming: Server-Sent Events (SSE)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth)
- `lib/db/src/schema/research.ts` — DB schema for research sessions
- `artifacts/api-server/src/lib/researcher.ts` — Claude agent logic
- `artifacts/api-server/src/routes/research/index.ts` — API routes + SSE streaming
- `artifacts/investment-agent/src/pages/home.tsx` — Home page with search + history
- `artifacts/investment-agent/src/pages/research-detail.tsx` — Live research progress + full report

## Architecture decisions

- **Single-shot LLM call**: Claude receives a structured system prompt and produces a complete JSON research report in one call — simpler, faster, and more reliable than a multi-step tool-calling agent for a first version
- **SSE for streaming**: Server-Sent Events give the UI live step-by-step progress without WebSocket complexity
- **OpenAPI-first**: Full API contract in openapi.yaml drives both typed React Query hooks (frontend) and Zod validation schemas (backend) via Orval codegen
- **JSON blobs in DB**: bulletsFor, bulletsAgainst, financialData, newsHeadlines stored as JSON strings in text columns — simple and flexible for evolving schemas
- **Confidence score from LLM**: Claude self-reports a confidence score (0–100) as part of its structured output

## Product

- Enter any company name → AI agent researches it and returns INVEST or PASS
- Live streaming progress view with animated step indicators during analysis
- Full report: verdict banner, confidence ring gauge, bull/bear case bullets, key financial metrics grid, multi-paragraph reasoning, recent news feed
- Research history on home page with aggregate stats (invest rate, avg confidence)
- Delete individual sessions

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- The SSE stream endpoint (`/api/research/:id/stream`) must be listed BEFORE `/:id` in the router — Express matches routes in order and `/stats` + `/:id/stream` would be captured by `/:id` otherwise
- Claude responses occasionally wrap JSON in markdown code fences — the researcher strips these before parsing
- `X-Accel-Buffering: no` header is required on SSE responses to prevent nginx/proxy from buffering events

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- README.md has full assignment documentation including example runs and architecture explanation
