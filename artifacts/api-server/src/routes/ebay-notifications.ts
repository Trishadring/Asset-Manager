import { Router, type IRouter } from "express";
import { createHash } from "crypto";

const router: IRouter = Router();

/**
 * eBay Marketplace Account Deletion Notification endpoint.
 * Required by eBay to use production APIs.
 *
 * GET  — eBay challenge/verification handshake
 * POST — actual deletion notification (we just acknowledge it)
 */
router.get("/ebay/account-deletion", (req, res): void => {
  const challengeCode = req.query["challenge_code"];
  if (!challengeCode || typeof challengeCode !== "string") {
    res.status(400).json({ error: "Missing challenge_code" });
    return;
  }

  const verificationToken = process.env["EBAY_DELETION_VERIFICATION_TOKEN"] ?? "";
  // eBay requires: sha256(challengeCode + verificationToken + endpointURL)
  const endpointUrl = `https://${req.headers["x-forwarded-host"] ?? req.headers["host"]}/api/ebay/account-deletion`;
  const challengeResponse = createHash("sha256")
    .update(challengeCode + verificationToken + endpointUrl)
    .digest("hex");

  res.json({ challengeResponse });
});

router.post("/ebay/account-deletion", (req, res): void => {
  // Acknowledge the deletion notification — no user data stored
  res.sendStatus(200);
});

export default router;
