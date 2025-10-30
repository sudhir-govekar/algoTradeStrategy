import axios from "axios";

async function fetchOHLC() {
    const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = now - 24 * 60 * 60;

  const symbol = "DOGSUSD"; // replace with exact testnet symbol
  const resolution = "1h"; // 1-minute candles

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

    console.log("Response:", res.data);
  } catch (err) {
    console.error(
      "Error fetching candles:",
      err.response?.data || err.message
    );
  }
}

fetchOHLC();
