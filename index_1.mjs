// strategy.js
import axios from "axios";
import { EMA } from "technicalindicators";
import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();

const { DELTA_API_KEY, DELTA_API_SECRET, SYMBOL, INTERVAL, BASE_URL } = process.env;

// === 1. Fetch OHLC from Delta Testnet ===
async function fetchOHLC() {
  const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = now - 24 * 60 * 60;

  const symbol = "DOGSUSD"; // replace with exact testnet symbol
  const resolution = "15m"; // 1-minute candles

  const url = "https://api.india.delta.exchange/v2/history/candles";

  try {
    const res = await axios.get(url, {
      params: {
        symbol,
        resolution,
        start: oneDayAgo,
        end: now,
      },
    });
  const candles = res.data.result || [];
  return candles.map(c => ({
    open: parseFloat(c.open),
    high: parseFloat(c.high),
    low: parseFloat(c.low),
    close: parseFloat(c.close),
  }));
}catch(err){
  console.log(err);
}
}

// === 2. Compute Heikin Ashi Candles ===
function computeHeikinAshi(data) {
  const ha = [];
  let haOpen = (data[0].open + data[0].close) / 2;
  for (let i = 0; i < data.length; i++) {
    const { open, high, low, close } = data[i];
    const haClose = (open + high + low + close) / 4;
    haOpen = (haOpen + haClose) / 2;
    const haHigh = Math.max(high, haOpen, haClose);
    const haLow = Math.min(low, haOpen, haClose);
    ha.push({ haOpen, haClose, haHigh, haLow });
  }
  return ha;
}

// === 3. Detect Signal ===
function detectSignal(data) {
  const closes = data.map(c => c.close);
  const ema50 = EMA.calculate({ period: 50, values: closes });
  const offset = data.length - ema50.length;
  const ha = computeHeikinAshi(data);

  const i = data.length - 2; // last closed candle

  const haNow = ha[i];
  const haPrev1 = ha[i - 1];
  const haPrev2 = ha[i - 2];

  const dojiRatio = 0.25;
  const isDoji = (candle) => {
    const body = Math.abs(candle.haClose - candle.haOpen);
    const range = candle.haHigh - candle.haLow;
    return range > 0 && body / range < dojiRatio;
  };

  const doji1 = isDoji(haPrev1);
  const doji2 = isDoji(haPrev2);
  const bullishPrev = haPrev1.haClose > haPrev1.haOpen;
  const noLowerWick = (haPrev1.haOpen - haPrev1.haLow) <= (haPrev1.haHigh - haPrev1.haClose) * 0.1;
  const uptrend = data[i].close > ema50[i - offset];

  const setupA = (doji2 || doji1) && bullishPrev && noLowerWick;
  const setupB = haPrev2.haClose < haPrev2.haOpen && (doji1 || doji2) && bullishPrev && noLowerWick;
  const pattern = setupA || setupB;
  const breakout = data[i].high > haPrev1.haHigh;

  const entryCondition = uptrend && pattern && breakout;
  return entryCondition ? "BUY" : null;
}

// === 4. Auth Helper ===
function signRequest(queryString) {
  return crypto.createHmac("sha256", DELTA_API_SECRET).update(queryString).digest("hex");
}

// === 5. Place Testnet Order ===
async function placeOrder(side) {
  const timestamp = Date.now();
  const query = `timestamp=${timestamp}`;
  const signature = signRequest(query);

  const body = {
    product_id: SYMBOL,
    size: 1,
    side: side.toLowerCase(),
    order_type: "market",
  };

  try {
    const res = await axios.post(`${BASE_URL}/v2/orders`, body, {
      headers: {
        "api-key": DELTA_API_KEY,
        timestamp,
        signature,
        "Content-Type": "application/json",
      },
    });
    console.log(`✅ ${side} Order Placed (Testnet):`, res.data);
  } catch (err) {
    console.error("❌ Order Failed:", err.response?.data || err.message);
  }
}

// === 6. Run Strategy Once ===
export async function runStrategy() {
  try {
    const data = await fetchOHLC();
    const signal = await detectSignal(data);
    if (signal === "BUY") {
      console.log("🚀 Buy Signal Detected! Placing Testnet Order..."+Date());
      // await placeOrder("BUY");
    } else {
      console.log("No Signal This Time."+Date());
    }
  } catch (err) {
    console.log(JSON.stringify(err));
    console.error("Error running strategy:", err.message);
  }
}

// Run immediately if script is started directly
if (process.argv[1].endsWith("strategy.js")) {
  runStrategy();
}
runStrategy()
