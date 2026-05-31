// V36 — DISABLED (Hybrid Storage cleanup)
// النظام انتقل إلى Binance WebSocket مباشرة في الواجهة (useBinanceLivePrices).
// لم نعد نكتب في جداول `العملات` أو `تدفق_بيانات_السوق` لتوفير Egress و Invocations.
// تُرك هذا الـ endpoint قائماً ليُرجع 410 Gone حتى لا تتعطل أي cron jobs قديمة.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return new Response(
    JSON.stringify({
      status: "disabled",
      message: "market-data-feeder تم تعطيله — الأسعار تُجلب الآن من Binance WebSocket في الواجهة مباشرة.",
      since: "V36",
    }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
