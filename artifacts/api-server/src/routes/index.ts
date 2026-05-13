import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import purchasesRouter from "./purchases";
import ordersRouter from "./orders";
import dashboardRouter from "./dashboard";
import salesRouter from "./sales";
import ebayNotificationsRouter from "./ebay-notifications";
import ebayRouter from "./ebay";

const router: IRouter = Router();

// Auth routes — public (handle login/logout/callback/user)
router.use(authRouter);

// eBay marketplace deletion notifications — must be publicly reachable
router.use(ebayNotificationsRouter);

// Health check — public
router.use(healthRouter);

// Require authentication for all remaining routes
router.use((req: Request, res: Response, next: NextFunction) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

router.use(dashboardRouter);
router.use(purchasesRouter);
router.use(ordersRouter);
router.use(salesRouter);
router.use(ebayRouter);

export default router;
