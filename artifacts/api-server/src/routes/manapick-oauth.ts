import { Router, type IRouter, type Request, type Response } from "express";
import {
  beginManapoolOAuth,
  completeManapoolOAuth,
  disconnectManapool,
  getManapoolConnectionStatus,
} from "../lib/manapool-oauth";

const router: IRouter = Router();

router.get(
  "/manapick/oauth/start",
  async (req: Request, res: Response): Promise<void> => {
    await beginManapoolOAuth(req, res);
  },
);

router.get(
  "/manapick/oauth/callback",
  async (req: Request, res: Response): Promise<void> => {
    await completeManapoolOAuth(req, res);
  },
);

router.get(
  "/manapick/oauth/status",
  async (req: Request, res: Response): Promise<void> => {
    await getManapoolConnectionStatus(req, res);
  },
);

router.post(
  "/manapick/oauth/disconnect",
  async (req: Request, res: Response): Promise<void> => {
    await disconnectManapool(req, res);
  },
);

export default router;
