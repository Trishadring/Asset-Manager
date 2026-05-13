import { Router, type IRouter } from "express";
import healthRouter from "./health";
import purchasesRouter from "./purchases";
import ordersRouter from "./orders";
import dashboardRouter from "./dashboard";
import salesRouter from "./sales";
import ebayNotificationsRouter from "./ebay-notifications";
import ebayRouter from "./ebay";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(purchasesRouter);
router.use(ordersRouter);
router.use(salesRouter);
router.use(ebayNotificationsRouter);
router.use(ebayRouter);

export default router;
