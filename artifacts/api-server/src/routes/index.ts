import { Router, type IRouter } from "express";
import healthRouter from "./health";
import manapickRouter from "./manapick";
import manapickOAuthRouter from "./manapick-oauth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(manapickOAuthRouter);
router.use(manapickRouter);

export default router;
