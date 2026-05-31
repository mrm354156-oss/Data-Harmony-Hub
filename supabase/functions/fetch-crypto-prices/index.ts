const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, range, accept, accept-language, cache-control, pragma",
};

const TOP_CRYPTOS = [
  // Top 25 — large caps
  "bitcoin", "ethereum", "binancecoin", "ripple", "solana",
  "cardano", "dogecoin", "tron", "avalanche-2", "chainlink",
  "polkadot", "polygon", "litecoin", "uniswap", "stellar",
  "near", "aptos", "sui", "pepe", "shiba-inu",
  "render-token", "injective-protocol", "arbitrum", "optimism", "fantom",
  // 26-50 — mid caps
  "cosmos", "internet-computer", "filecoin", "hedera-hashgraph", "vechain",
  "aave", "the-graph", "algorand", "flow", "theta-token",
  "axie-infinity", "decentraland", "the-sandbox", "eos", "maker",
  "neo", "iota", "kucoin-shares", "gala", "enjincoin",
  "fetch-ai", "ocean-protocol", "worldcoin-wld", "bonk", "floki",
  // 51-75 — additional alts
  "tezos", "elrond-erd-2", "kaspa", "thorchain", "mina-protocol",
  "klay-token", "quant-network", "chiliz", "1inch", "compound-governance-token",
  "curve-dao-token", "synthetix-network-token", "yearn-finance", "zilliqa", "basic-attention-token",
  "loopring", "ankr", "celo", "kava", "zcash",
  "dash", "qtum", "icon", "ravencoin", "ontology",
  // 76-100 — extended coverage
  "ethereum-classic", "monero", "bitcoin-cash", "stacks", "immutable-x",
  "blur", "jasmycoin", "rocket-pool", "lido-dao", "frax-share",
  "pancakeswap-token", "sushi", "dydx-chain", "gmx", "ethereum-name-service",
  "mask-network", "audius", "livepeer", "skale", "storj",
  "siacoin", "harmony", "celer-network", "wax", "aragon",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const ids = TOP_CRYPTOS.join(",");
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=1h,24h,7d`;

    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
    });

    if (!res.ok) {
      const isFallbackable = res.status === 429 || res.status >= 500;
      console.error(`CoinGecko API error: ${res.status}`);
      return new Response(
        JSON.stringify({
          error: isFallbackable ? "COINGECKO_RATE_LIMITED" : `CoinGecko API error: ${res.status}`,
          fallback: isFallbackable,
          cryptos: [],
          lastFetch: new Date().toISOString(),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await res.json();

    const cryptos = data.map((coin: any) => ({
      id: coin.id,
      symbol: coin.symbol?.toUpperCase(),
      name: coin.name,
      image: coin.image,
      currentPrice: coin.current_price,
      marketCap: coin.market_cap,
      marketCapRank: coin.market_cap_rank,
      totalVolume: coin.total_volume,
      high24h: coin.high_24h,
      low24h: coin.low_24h,
      priceChange24h: coin.price_change_24h,
      priceChangePercent24h: coin.price_change_percentage_24h,
      priceChangePercent1h: coin.price_change_percentage_1h_in_currency,
      priceChangePercent7d: coin.price_change_percentage_7d_in_currency,
      circulatingSupply: coin.circulating_supply,
      ath: coin.ath,
      athChangePercent: coin.ath_change_percentage,
    }));

    return new Response(JSON.stringify({ cryptos, lastFetch: new Date().toISOString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Crypto fetch error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message, fallback: true, cryptos: [], lastFetch: new Date().toISOString() }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
