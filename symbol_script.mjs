import axios from "axios";

const fetchSymbols = async () => {
  const res = await axios.get("https://api.india.delta.exchange/v2/products");
  const perpetuals = res.data.result.filter(
    (p) => p.contract_type === "perpetual_futures"
  );
  console.log(
    perpetuals.map((p) => ({ symbol: p.symbol, name: p.description }))
  );
};

fetchSymbols();
