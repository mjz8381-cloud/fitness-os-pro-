// supabase/functions/send-scheduled-notifications/index.ts
// دي مش الدالة اللي التطبيق بينادها. دي بتتنادى تلقائيًا كل دقيقة من pg_cron
// (شوف نهاية supabase/sql/002_push_notifications.sql) وبتبعت Push حقيقي
// لأي إشعار وقته حان، حتى لو التطبيق مقفول أو الموبايل نايم.
//
// Deploy: supabase functions deploy send-scheduled-notifications --no-verify-jwt
// Secrets:
//   supabase secrets set VAPID_PUBLIC_KEY=...
//   supabase secrets set VAPID_PRIVATE_KEY=...
//   supabase secrets set VAPID_SUBJECT=mailto:you@example.com
// (SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY متوفرين تلقائيًا جوه أي Edge Function)

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

Deno.serve(async (req) => {
  // الدالة دي بتتنادى من pg_cron بس (بتوكن السيرفر)، مش من المتصفح
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const nowIso = new Date().toISOString();
    // أي حاجة وقتها حان، بس مش قديمة أوي (لو السيرفر وقف شوية) — آخر 10 دقايق بس
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const { data: due, error: dueErr } = await sb
      .from("scheduled_notifications")
      .select("id,user_id,title,body")
      .eq("sent", false)
      .lte("fire_at", nowIso)
      .gte("fire_at", cutoff)
      .limit(200);

    if (dueErr) throw dueErr;
    if (!due || !due.length) return new Response(JSON.stringify({ sent: 0 }), { status: 200 });

    const userIds = [...new Set(due.map((d) => d.user_id))];
    const { data: subs, error: subsErr } = await sb
      .from("push_subscriptions")
      .select("id,user_id,endpoint,p256dh,auth")
      .in("user_id", userIds);
    if (subsErr) throw subsErr;

    const subsByUser = new Map<string, typeof subs>();
    for (const s of subs || []) {
      const arr = subsByUser.get(s.user_id) || [];
      arr.push(s);
      subsByUser.set(s.user_id, arr);
    }

    let sentCount = 0;
    const deadEndpoints: string[] = [];
    const sentIds: string[] = [];

    for (const item of due) {
      const userSubs = subsByUser.get(item.user_id) || [];
      const payload = JSON.stringify({ title: item.title, body: item.body, tag: item.id });
      for (const s of userSubs) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
          );
          sentCount++;
        } catch (e: any) {
          // 404/410 يعني الاشتراك ده مات (المستخدم مسح المتصفح أو ألغى الإذن)
          if (e?.statusCode === 404 || e?.statusCode === 410) deadEndpoints.push(s.endpoint);
          console.error("push send failed", item.id, e?.statusCode || e);
        }
      }
      sentIds.push(item.id);
    }

    if (sentIds.length) {
      await sb.from("scheduled_notifications").update({ sent: true }).in("id", sentIds);
    }
    if (deadEndpoints.length) {
      await sb.from("push_subscriptions").delete().in("endpoint", deadEndpoints);
    }
    await sb.rpc("cleanup_old_scheduled_notifications");

    return new Response(JSON.stringify({ due: due.length, sent: sentCount }), { status: 200 });
  } catch (e) {
    console.error("send-scheduled-notifications error", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
