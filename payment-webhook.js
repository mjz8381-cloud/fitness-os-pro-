// /api/payment-webhook.js
// نقطة استقبال جاهزة لتأكيد الدفع من بوابة دفع (Paymob مثلاً، بتدعم فودافون كاش).
// حاليًا: مش متربطة بأي بوابة فعلية — لما يجهز حساب التاجر، هنضيف هنا:
//   1) التحقق من توقيع/HMAC الطلب (كل بوابة ليها طريقتها) للتأكد إنه فعلاً من البوابة
//   2) استخراج user_id ومبلغ الدفع من بيانات الطلب
//   3) تفعيل is_pro = true للمستخدم في app_state
//
// دلوقتي الدالة موجودة كـ placeholder جاهز، وبترفض أي طلب لحد ما نفعّلها بمفتاح تحقق حقيقي.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://iiqjfvdtyzirqkcunmjb.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const PAYMENT_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET; // هيتحدد لما نربط بوابة حقيقية

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // لسه مفيش بوابة دفع متربطة — الـ webhook ده placeholder بس دلوقتي
  if (!PAYMENT_WEBHOOK_SECRET) {
    return res.status(501).json({ error: 'نظام الدفع لسه بيتجهز' });
  }

  try {
    // TODO: لما نربط Paymob أو غيرها، هنتحقق هنا من الـ HMAC/signature
    // بتاع الطلب عشان نتأكد إنه فعلاً جاي من البوابة مش من حد بيحاول يزوّر طلب دفع.
    // كل بوابة ليها طريقة تحقق مختلفة، هنضيفها هنا وقتها بالظبط حسب توثيقها.

    const { user_id, amount, transaction_id, status } = req.body || {};
    if (status !== 'success' || !user_id) {
      return res.status(400).json({ error: 'بيانات دفع غير مكتملة' });
    }

    await fetch(`${SUPABASE_URL}/rest/v1/app_state?user_id=eq.${user_id}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ is_pro: true }),
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('payment-webhook error:', e);
    return res.status(500).json({ error: 'حصل خطأ في معالجة الدفع' });
  }
}
