import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import purchasesRouter from "./purchases";
import ordersRouter from "./orders";
import dashboardRouter from "./dashboard";
import salesRouter from "./sales";
import ebayNotificationsRouter from "./ebay-notifications";
import ebayRouter from "./ebay";
import manapickRouter from "./manapick";
import manapickOAuthRouter from "./manapick-oauth";
import tcgplayerRouter from "./tcgplayer";
import { isPublicManaPickRoute } from "../lib/public-manapick";

const router: IRouter = Router();

// Auth routes — public (handle login/logout/callback/user)
router.use(authRouter);

// eBay marketplace deletion notifications — must be publicly reachable
router.use(ebayNotificationsRouter);

// Health check — public
router.use(healthRouter);

// Require authentication for all remaining routes (skipped in development)
router.use((req: Request, res: Response, next: NextFunction) => {
  if (isPublicManaPickRoute(req.method, req.path)) {
    next();
    return;
  }

  if (process.env["NODE_ENV"] !== "production" || req.isAuthenticated()) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized" });
});

router.use(dashboardRouter);
router.use(purchasesRouter);
router.use(ordersRouter);
router.use(salesRouter);
router.use(ebayRouter);
router.use(manapickOAuthRouter);
router.use(manapickRouter);
router.use(tcgplayerRouter);

export default router;
