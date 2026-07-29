// supabase/functions/ai-chat/index.ts
// بينادى من التطبيق بدل الرد الجاهز (fakeAiReply). المفتاح هنا بس، مش في المتصفح خالص.
// Deploy: supabase functions deploy ai-chat
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import { createClient } from "npm:@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing_auth" }, 401);

    // عميل باسم المستخدم نفسه (بتوكن الـ JWT بتاعه) — عشان auth.uid() يشتغل صح
    // جوه الدوال، وعشان هو بس اللي بيستهلك من رصيده هو
    const sbAsUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await sbAsUser.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "unauthenticated" }, 401);

    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.messages) || !body.messages.length) {
      return json({ error: "bad_request" }, 400);
    }
    const system = String(body.system || "").slice(0, 6000);
    const messages = body.messages.slice(-6).map((m: any) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: String(m.content || "").slice(0, 3000),
    }));
    const maxTokens = Math.min(Math.max(Number(body.max_tokens) || 300, 50), 800);

    // 1) استهلاك كريدت واحد — الحقيقة الوحيدة موجودة في قاعدة البيانات
    const { data: creditRows, error: creditErr } = await sbAsUser.rpc("consume_ai_credit");
    if (creditErr) {
      console.error("consume_ai_credit error", creditErr);
      return json({ error: "credit_check_failed" }, 500);
    }
    const credit = Array.isArray(creditRows) ? creditRows[0] : creditRows;
    if (!credit?.allowed) {
      return json(
        { error: "out_of_credits", daily_left: credit?.daily_left ?? 0, monthly_left: credit?.monthly_left ?? 0 },
        402,
      );
    }

    // 2) نداء حقيقي لـ Anthropic — المفتاح سرّي على السيرفر بس
    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: maxTokens,
        system,
        messages,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("Anthropic upstream error", aiRes.status, errText);
      return json(
        { error: "ai_upstream_error", daily_left: credit.daily_left, monthly_left: credit.monthly_left },
        502,
      );
    }

    const aiData = await aiRes.json();
    const text = (aiData.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");

    return json({ text, daily_left: credit.daily_left, monthly_left: credit.monthly_left });
  } catch (e) {
    console.error("ai-chat internal error", e);
    return json({ error: "internal_error" }, 500);
  }
});
