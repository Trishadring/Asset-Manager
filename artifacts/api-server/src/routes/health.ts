import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Public diagnostic: reveals which env var KEYS are present (never values).
// Used to verify secret injection in production without exposing credentials.
router.get("/healthz/env", (_req, res) => {
  const check = (key: string) => {
    const val = process.env[key];
    return !!val && val.length > 0;
  };
  res.json({
    NODE_ENV: process.env["NODE_ENV"],
    hasManapool: check("MANAPOOL_EMAIL") && check("MANAPOOL_API_KEY"),
    hasEbay: check("EBAY_CLIENT_ID") && check("EBAY_CLIENT_SECRET"),
    hasDatabase: check("DATABASE_URL"),
    envKeyCount: Object.keys(process.env).length,
    envKeys: Object.keys(process.env).sort(),
  });
});

export default router;
