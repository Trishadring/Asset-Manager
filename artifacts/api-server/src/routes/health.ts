import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Public diagnostic: reports only whether the required secrets are configured,
// to verify secret injection without exposing credentials. It must not list
// environment variable names or values.
router.get("/healthz/env", (_req, res) => {
  const check = (key: string) => {
    const val = process.env[key]?.trim();
    return !!val && val.length > 0;
  };
  res.json({
    hasManapoolOAuth:
      check("MANAPOOL_CLIENT_ID") && check("MANAPOOL_CLIENT_SECRET"),
    hasCookieEncryptionKey: check("COOKIE_ENCRYPTION_KEY"),
  });
});

export default router;
