import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// In production, serve the built React frontend
// After the build, frontend files are copied into dist/public/ alongside this file
if (process.env["NODE_ENV"] === "production") {
  // __dirname is set by the esbuild banner to the directory of the output .mjs file (dist/)
  const frontendDist = path.resolve(__dirname, "public");
  logger.info({ frontendDist }, "Serving frontend static files from");
  app.use(express.static(frontendDist));
  // SPA fallback: all non-API routes return index.html
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

export default app;
