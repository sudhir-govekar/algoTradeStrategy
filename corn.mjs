import cron from "node-cron";
import { runStrategy } from "./index_1.mjs";

console.log("📈 Starting HA Doji Testnet Bot...");
cron.schedule("*/5 * * * *", runStrategy);
