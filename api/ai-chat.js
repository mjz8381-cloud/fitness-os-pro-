// /api/ai-chat.js
// نقطة دخول آمنة للـ AI Coach. المفتاح السري (لما يتحدد) هيتحط كـ Environment Variable
// في Vercel، مش في الكود، فمش هيظهر أبدًا للمستخدم في المتصفح.
//
// إزاي يشتغل:
// 1) الفرونت إند بيبعت token المستخدم (من Supabase Auth) + الرسالة
// 2) الدالة دي بتتحقق من الـ token مع Supabase، وتتأكد إن عنده كريدت متاح
// 3) بتخصم كريدت وترجع رد (mock دلوقتي، AI حقيقي بعدين)

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://iiqjfvdtyzirqkcunmjb.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // مفتاح سري — يتحط في Vercel Environment Variables بس
const AI_DAILY_LIMIT = 20;
const AI_MONTHLY_LIMIT = 300;

export default async function handler(req, res) {
  // CORS: نسمح بس لطلبات POST من نفس الموقع
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { message, accessToken } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'مفيش رسالة' });
    }
    if (!accessToken) {
      return res.status(401).json({ error: 'لازم تسجّل دخول الأول' });
    }

    // 1) تحقق من هوية المستخدم عن طريق Supabase Auth
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: process.env.SUPABASE_ANON_KEY || '',
      },
    });
    if (!userRes.ok) return res.status(401).json({ error: 'جلسة غير صالحة، سجّل دخول تاني' });
    const user = await userRes.json();
    const userId = user.id;
    if (!userId) return res.status(401).json({ error: 'جلسة غير صالحة' });

    // 2) لو مفيش service key متظبط لسه، نشتغل في وضع mock كامل من غير قاعدة بيانات
    // (بيسمح للفرونت إند يشتغل ويتجرب حتى قبل ما تظبط متغيرات البيئة)
    if (!SUPABASE_SERVICE_KEY) {
      const reply = mockReply(message);
      return res.status(200).json({ reply, mock: true });
    }

    // 3) اقرأ الكريدت الحالي من app_state (باستخدام service key اللي بيتخطى RLS)
    const stateRes = await fetch(
      `${SUPABASE_URL}/rest/v1/app_state?user_id=eq.${userId}&select=ai_credits_daily,ai_credits_monthly,ai_credits_reset_date,is_pro,is_admin,trial_started_at`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    const stateRows = await stateRes.json();
    const state = stateRows && stateRows[0];
    if (!state) return res.status(404).json({ error: 'حساب غير موجود' });

    // تحقق من الاشتراك/التجربة (نفس منطق isPro في الفرونت إند)
    const isAdmin = !!state.is_admin;
    const isPro = !!state.is_pro;
    const trialActive = state.trial_started_at
      ? (Date.now() - new Date(state.trial_started_at).getTime()) < 86400000
      : false;
    if (!isAdmin && !isPro && !trialActive) {
      return res.status(403).json({ error: 'محتاج تفعّل Pro أو تجربة مجانية عشان تستخدم الـ AI Coach' });
    }

    // تصفير الكريدت اليومي/الشهري لو يوم/شهر جديد
    const today = new Date().toISOString().slice(0, 10);
    let daily = state.ai_credits_daily || 0;
    let monthly = state.ai_credits_monthly || 0;
    const lastReset = state.ai_credits_reset_date;
    if (lastReset !== today) daily = 0;
    if (!lastReset || lastReset.slice(0, 7) !== today.slice(0, 7)) monthly = 0;

    if (!isAdmin) {
      if (daily >= AI_DAILY_LIMIT) return res.status(429).json({ error: 'خلص رصيدك اليومي — هيتجدد بكرة' });
      if (monthly >= AI_MONTHLY_LIMIT) return res.status(429).json({ error: 'خلص رصيدك الشهري' });
    }

    // 4) هات الرد (mock دلوقتي، AI حقيقي لما نربط مفتاح حقيقي هنا)
    const reply = mockReply(message);

    // 5) اخصم كريدت واحفظ
    await fetch(`${SUPABASE_URL}/rest/v1/app_state?user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        ai_credits_daily: daily + 1,
        ai_credits_monthly: monthly + 1,
        ai_credits_reset_date: today,
      }),
    });

    return res.status(200).json({ reply, creditsLeft: { daily: AI_DAILY_LIMIT - daily - 1, monthly: AI_MONTHLY_LIMIT - monthly - 1 } });
  } catch (e) {
    console.error('ai-chat error:', e);
    return res.status(500).json({ error: 'حصل خطأ، جرب تاني' });
  }
}

// رد تجريبي بسيط لحد ما نربط مفتاح AI حقيقي
function mockReply(message) {
  const msg = message.toLowerCase();
  if (/تمرين|حصة|برنامج|عضل/.test(message)) {
    return 'تقدر تفتح تبويب البرنامج عشان تشوف حصة النهارده بالتفصيل. عايزني أساعدك في حاجة تانية عن التمرين؟';
  }
  if (/اكل|تغذي|بروتين|سعر/.test(message)) {
    return 'تقدر تفتح تبويب التغذية عشان تشوف هدف السعرات بتاعك النهارده وخطة مقترحة.';
  }
  if (/معاد|جدول|موعد/.test(message)) {
    return 'تقدر تدير جدولك وتحدد ميعاد الجيم من تبويب "حسابي" تحت قسم الجدول الأسبوعي.';
  }
  return `(رد تجريبي من السيرفر — لسه مفيش AI حقيقي متربط) سؤالك كان: "${message}". لما نربط مفتاح API هرد عليك بتفصيل أكتر.`;
}
