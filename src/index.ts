import "dotenv/config";
import express from "express";
import { config } from "./config.js";
import { verifySolPaymentRouter } from "./routes/verifySolPayment.js";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use(verifySolPaymentRouter);

// config.port reads process.env.PORT (set by Render/Railway), falling back to 3000 locally.
// Bind 0.0.0.0 so the platform's proxy can reach the container.
app.listen(config.port, "0.0.0.0", () => {
  console.log(`Kept backend listening on :${config.port}`);
});
