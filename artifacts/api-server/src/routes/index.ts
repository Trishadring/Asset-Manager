import { Router, type IRouter } from "express";
import healthRouter from "./health";
import purchasesRouter from "./purchases";
import ordersRouter from "./orders";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(purchasesRouter);
router.use(ordersRouter);

export default router;
