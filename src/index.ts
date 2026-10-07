import "dotenv/config";
import express from "express";
import { config } from "./config.js";
import { assetlinksRouter } from "./routes/assetlinks.js";
import { startV4Scheduler, v4Router } from "./routes/v4.js";

const app = express();
// Helius webhook batches can be large.
app.use(express.json({ limit: "12mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use(v4Router);
app.use(assetlinksRouter);
startV4Scheduler();

// config.port reads process.env.PORT (set by Render/Railway), falling back to 3000 locally.
// Bind 0.0.0.0 so the platform's proxy can reach the container.
app.listen(config.port, "0.0.0.0", () => {
  console.log(`KEPT V4 backend listening on :${config.port}, program ${config.programId}`);
});
