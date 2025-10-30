// ha_doji_bot.js
require('dotenv').config();
const axios = require('axios');
const { ATR, EMA } = require('technicalindicators');
const DeltaRestClient = require('delta-rest-client');

const {
  DELTA_API_KEY,
  DELTA_API_SECRET,
  BASE_URL = 'https://testnet-api.delta.exchange',
  SYMBOL = 'BTCUSD',        // symbol used for placing orders
  PRODUCT_SYMBOL = 'BTCUSD',// symbol used for history API (may differ by product)
  RESOLUTION = '15m',
  SIZE = '1',               // order size - adjust to product contract size
  POLL_INTERVAL_MS = 60000
} = process.env;

// Strategy params (match your Pine inputs)
const EMA_FAST = 50;
const EMA_SLOW = 200;
const DOJI_RATIO = 0.25;
const ATR_LEN = 14;
const SWING_LEN = 10; // not used in this example, kept for parity

// helper to fetch candles from Delta history endpoint
async function fetchCandles(startSec, endSec, resolution, symbol) {
  const url = `${BASE_URL}/v2/history/candles`;
  const resp = await axios.get(url, {
    params: {
      symbol,
      resolution,
      start: startSec,
      end: endSec
    }
  });
  // response structure: array of [time, open, high, low, close, volume] per docs/examples
  return resp.data.result || resp.data || [];
}

// convert candles to objects {time,open,high,low,close,volume}
function normalizeCandles(raw) {
  return raw.map(r => ({
    time: r[0],
    open: +r[1],
    high: +r[2],
    low: +r[3],
    close: +r[4],
    volume: +r[5]
  }));
}

// compute Heikin-Ashi series from regular candles
function computeHeikinAshi(candles) {
  const ha = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const haClose = (c.open + c.high + c.low + c.close) / 4.0;
    if (i === 0) {
      const haOpen = (candles[0].open + candles[0].close) / 2.0;
      const haHigh = Math.max(c.high, haOpen, haClose);
      const haLow = Math.min(c.low, haOpen, haClose);
      ha.push({ ...c, haOpen, haClose, haHigh, haLow });
    } else {
      const prev = ha[i - 1];
      const haOpen = (prev.haOpen + prev.haClose) / 2.0;
      const haHigh = Math.max(c.high, haOpen, haClose);
      const haLow = Math.min(c.low, haOpen, haClose);
      ha.push({ ...c, haOpen, haClose, haHigh, haLow });
    }
  }
  return ha;
}

// utility: compute EMA array using technicalindicators
function computeEMA(values, period) {
  if (values.length < period) return [];
  const out = EMA.calculate({ period, values });
  // EMA.calculate returns length = values.length - period + 1, align right by padding
  const pad = values.length - out.length;
  return Array(pad).fill(null).concat(out);
}

// utility: compute ATR array using technicalindicators
function computeATR(highs, lows, closes, period) {
  if (highs.length < period) return [];
  const out = ATR.calculate({ period, high: highs, low: lows, close: closes });
  const pad = highs.length - out.length;
  return Array(pad).fill(null).concat(out);
}

function isDojiBar(haBar, dojiRatio) {
  const haBody = Math.abs(haBar.haClose - haBar.haOpen);
  const haRange = haBar.haHigh - haBar.haLow;
  return haRange > 0 ? (haBody / haRange) < dojiRatio : false;
}

async function main() {
  // init Delta client (node wrapper)
  const client = await new DeltaRestClient(DELTA_API_KEY, DELTA_API_SECRET, { baseUrl: BASE_URL });

  console.log('Delta client initialized. Running strategy loop...');

  // main loop
  setInterval(async () => {
    try {
      // fetch last N candles (we need enough for EMAs and ATR)
      const now = Math.floor(Date.now() / 1000);
    //   const lookbackSeconds = 60 * 60 * 6; // fetch last 6 hours (adjust as needed)
    // const lookbackSeconds = 60 * 60 * 24 * 3; // 3 days = 288 candles for 15m
    // const lookbackSeconds = 14 * 24 * 60 * 60; // 14 days
    const lookbackSeconds = 7 * 24 * 60 * 60; // 7 days


      const raw = await fetchCandles(now - lookbackSeconds, now, RESOLUTION, PRODUCT_SYMBOL);
      const candles = normalizeCandles(raw);

      if (candles.length < EMA_SLOW + 5) {
        console.log('Not enough candles yet:', candles.length);
        return;
      }

      // compute HA series
      const ha = computeHeikinAshi(candles);

      // prepare arrays for indicators (we'll use close prices for EMAs)
      const closes = candles.map(c => c.close);
      const highs = candles.map(c => c.high);
      const lows = candles.map(c => c.low);

      const emaF = computeEMA(closes, EMA_FAST);
      const emaS = computeEMA(closes, EMA_SLOW);
      const atrArr = computeATR(highs, lows, closes, ATR_LEN);

      // align lengths; take last index
      const i = ha.length - 1;
      if (i < 2) return;

      // trend check
      const isUp = emaF[i] !== null && emaS[i] !== null && emaF[i] > emaS[i];
      const isDown = emaF[i] !== null && emaS[i] !== null && emaF[i] < emaS[i];

      // HA pattern replication:
      // Note: referencing bars like [1], [2] => ha[i-1], ha[i-2]
      const bar0 = ha[i];
      const bar1 = ha[i - 1];
      const bar2 = ha[i - 2];

      const isDoji1 = isDojiBar(bar1, DOJI_RATIO);
      const isDoji2 = isDojiBar(bar2, DOJI_RATIO);
      const haBull1 = bar1.haClose > bar1.haOpen;
      const haBear1 = bar1.haClose < bar1.haOpen;
      const haBear2 = bar2.haClose < bar2.haOpen;
      const haBull2 = bar2.haClose > bar2.haOpen;

      // noLowerWick_bar1 = (haOpen[1] - haLow[1]) <= (haHigh[1] - haClose[1]) * 0.12
      const noLowerWick_bar1 = (bar1.haOpen - bar1.haLow) <= (bar1.haHigh - bar1.haClose) * 0.12;
      const noUpperWick_bar1 = (bar1.haHigh - bar1.haClose) <= (bar1.haOpen - bar1.haLow) * 0.12;

      const setupA_long = (isDoji2 || isDoji1) && haBull1 && noLowerWick_bar1;
      const setupB_long = haBear2 && (isDoji1 || isDoji2) && haBull1 && noLowerWick_bar1;
      const pattern_long = setupA_long || setupB_long;
      const breaksHaHigh1 = candles[i].high > bar1.haHigh || candles[i].close > bar1.haHigh;

      const setupA_short = (isDoji2 || isDoji1) && haBear1 && noUpperWick_bar1;
      const setupB_short = haBull2 && (isDoji1 || isDoji2) && haBear1 && noUpperWick_bar1;
      const pattern_short = setupA_short || setupB_short;
      const breaksHaLow1 = candles[i].low < bar1.haLow || candles[i].close < bar1.haLow;

      const longCond = isUp && pattern_long && breaksHaHigh1;
      const shortCond = isDown && pattern_short && breaksHaLow1;

      // ATR current
      const atr = atrArr[i] || atrArr[atrArr.length - 1];

      if (longCond) {
        console.log('Long signal detected at', new Date(candles[i].time * 1000).toISOString());
        // Place a market order (example): then place SL and TP
        // 1) find product_id for symbol (using Products api example)
        const productsResp = await client.apis.Products.getProducts({ symbol: SYMBOL });
        const products = JSON.parse(productsResp.data.toString()).result || JSON.parse(productsResp.data.toString());
        const product = products.find(p => p.symbol === SYMBOL || p.instrument_name === SYMBOL) || products[0];
        if (!product) {
          console.warn('Product not found for symbol', SYMBOL);
          return;
        }
        const product_id = product.product_id || product.id || product.productId;

        // Place market buy
        const marketBuy = {
          order: {
            product_id,
            size: SIZE,
            side: 'buy',
            order_type: 'market_order'
          }
        };
        const orderResp = await client.apis.Orders.placeOrder(marketBuy);
        console.log('Market buy response:', orderResp && orderResp.data ? orderResp.data.toString() : orderResp);

        // place SL & TP as separate limit/stop orders (example)
        const entryPrice = candles[i].close;
        const sl = Math.max(0, entryPrice - atr);
        const tp = entryPrice + 2 * atr;

        // Note: exact parameters for stop/limit orders and OCO vary — confirm in docs/testnet.
        // Place TP (limit sell)
        await client.apis.Orders.placeOrder({
          order: {
            product_id,
            size: SIZE,
            side: 'sell',
            limit_price: tp.toString(),
            order_type: 'limit_order'
          }
        });

        // Place SL (stop-loss - using a stop order or conditional order, check API capabilities)
        // This example places a stop_market order if supported; otherwise implement a watcher that cancels on fill.
        try {
          await client.apis.Orders.placeOrder({
            order: {
              product_id,
              size: SIZE,
              side: 'sell',
              trigger_price: sl.toString(),
              order_type: 'stop_market' // verify with API/testnet
            }
          });
        } catch (e) {
          console.warn('Could not place stop_market via API; consider implementing a watcher to place SL on fill. Error:', e.message || e);
        }
      } else if (shortCond) {
        console.log('Short signal detected at', new Date(candles[i].time * 1000).toISOString());

        const productsResp = await client.apis.Products.getProducts({ symbol: SYMBOL });
        const products = JSON.parse(productsResp.data.toString()).result || JSON.parse(productsResp.data.toString());
        const product = products.find(p => p.symbol === SYMBOL || p.instrument_name === SYMBOL) || products[0];
        if (!product) {
          console.warn('Product not found for symbol', SYMBOL);
          return;
        }
        const product_id = product.product_id || product.id || product.productId;

        // Market sell (open short)
        const marketSell = {
          order: {
            product_id,
            size: SIZE,
            side: 'sell',
            order_type: 'market_order'
          }
        };
        const orderResp = await client.apis.Orders.placeOrder(marketSell);
        console.log('Market sell response:', orderResp && orderResp.data ? orderResp.data.toString() : orderResp);

        const entryPrice = candles[i].close;
        const sl = entryPrice + atr;
        const tp = entryPrice - 2 * atr;

        // place TP (limit buy)
        await client.apis.Orders.placeOrder({
          order: {
            product_id,
            size: SIZE,
            side: 'buy',
            limit_price: tp.toString(),
            order_type: 'limit_order'
          }
        });

        // place SL (stop market buy)
        try {
          await client.apis.Orders.placeOrder({
            order: {
              product_id,
              size: SIZE,
              side: 'buy',
              trigger_price: sl.toString(),
              order_type: 'stop_market' // verify
            }
          });
        } catch (e) {
          console.warn('Could not place stop_market via API; consider implementing a watcher to place SL on fill. Error:', e.message || e);
        }
      } else {
        // no signal
        //console.log('No signal at', new Date(candles[i].time * 1000).toISOString());
      }

    } catch (err) {
      console.error('Main loop error:', err.message || err);
    }
  }, Number(POLL_INTERVAL_MS));
}

main().catch(e => console.error('Fatal error', e));
