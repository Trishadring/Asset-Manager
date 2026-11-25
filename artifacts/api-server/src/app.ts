import express, { type Express, type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.set("trust proxy", 1);

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  next();
});

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
const ALLOWED_ORIGINS = process.env["CORS_ORIGINS"]?.split(",") ?? ["http://localhost:5173", "http://localhost:8080"];
app.use(cors({
  credentials: true,
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) cb(null, true);
    else cb(null, false);
  },
}));
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));

app.use("/api", router);

// ── SPA fallback for accounting app (standalone/self-hosted) ──────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const accountingDist = path.resolve(__dirname, "../../accounting/dist/public");

app.use(express.static(accountingDist, { index: false }));
app.use("/accounting", express.static(accountingDist, { index: false }));
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    next();
    return;
  }
  if (req.path.startsWith("/api")) {
    next();
    return;
  }
  // Missing static files (anything with an extension) should 404 rather than
  // receive index.html.
  if (path.extname(req.path)) {
    next();
    return;
  }
  res.sendFile(path.join(accountingDist, "index.html"), (err) => {
    if (err) next();
  });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err, path: _req.path }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

export default app;
