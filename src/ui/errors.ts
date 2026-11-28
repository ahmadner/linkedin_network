const MESSAGES: Array<[RegExp, string | ((m: RegExpExecArray) => string)]> = [
  [/today's safe limit/i, "وصلت الحد الآمن لليوم. الباقي بضل بالقائمة لبكرا."],
  [/this week's safe limit/i, "وصلت الحد الآمن لهالأسبوع. الباقي بضل بالقائمة للأسبوع الجاي."],
  [/security check/i, "LinkedIn طلب تحقق أمني. افتح linkedin.com وكمّل التحقق، وما تبعت إشي لمدة يوم."],
  [/too many requests/i, "LinkedIn بيقول في طلبات كثير. استنى يوم قبل ما تبعت مرة ثانية."],
  [/not signed in/i, "مش مسجّل دخول على LinkedIn بهاد المتصفح. سجّل دخول وجرّب مرة ثانية."],
  [/stopped by you/i, "وقفتها إنت."],
  [/people search/i, "افتح صفحة بحث أشخاص على LinkedIn بهاد المتصفح أول."],
  [/send list is still running/i, "في قائمة إرسال لسا شغّالة. وقّفها أول."],
  [/already running|already being read/i, "في مزامنة شغّالة هلأ. استنى لتخلص."],
  [/extension (is not installed|did not answer)|not installed in this browser/i, "الإضافة مش مركّبة أو مش شغّالة. نزّلها من صفحة البيانات."],
  [/not allowed to use the extension/i, "هالصفحة مش مسموح لها تحكي مع الإضافة."],
  [/unknown request/i, "نسخة الإضافة عندك قديمة. نزّل النسخة الجديدة من صفحة البيانات."],
  [/nothing valid to send/i, "ما في إشي صالح للإرسال بالقائمة."],
  [/could not find this person/i, "ما لقيت هالشخص على LinkedIn."],
  [/member id|own linkedin profile/i, "ما قدرت أقرأ حسابك على LinkedIn. افتح linkedin.com مرة بهاد المتصفح وجرّب مرة ثانية."],
  [/activity page/i, "LinkedIn ما فتح صفحة نشاطك، فما قدرت أقرأ المنشورات. افتح صفحة Activity ببروفايلك مرة وجرّب مرة ثانية."],
  [/could not open a linkedin tab|linkedin tab did not answer/i, "ما قدرت أفتح LinkedIn بالمتصفح. تأكد إنك مسجّل دخول وجرّب مرة ثانية."],
  [/endpoints did not answer/i, "LinkedIn ما رد على طلبات المزامنة. ممكن يكون غيّر طريقة عمله، جرّب بعد شوي."],
  [/linkedin answered (\d+)/i, (m) => `LinkedIn رد بخطأ (${m[1]}). جرّب بعد شوي.`],
  [/no conversation with this contact/i, "ما في محادثة مع هالشخص."],
  [/no connections\.csv found/i, "ما لقيت Connections.csv. ارفع ملف الـ zip كامل أو ملف Connections.csv."],
  [/does not look like a linkedin connections\.csv/i, "هاد الملف مش Connections.csv من LinkedIn (ما فيه عمود First Name و Last Name)."],
  [/saved by a newer version/i, "ملف الحفظ هاد من نسخة أحدث من الأداة. حدّث الصفحة وجرّب مرة ثانية."],
  [/not a saved state of this tool/i, "هاد الـ zip مش ملف حفظ من هالأداة."],
  [/pdf needs at least one page/i, "الـ PDF لازم يكون فيه صفحة وحدة عالأقل."],
  [/image model returned no image/i, "موديل الصور ما رجّع صورة. جرّب مرة ثانية."],
  [/model returned (an )?(empty|no) /i, "الموديل رجّع نتيجة فاضية. جرّب مرة ثانية."],
  [/did not return valid json/i, "الموديل رجّع رد مش مفهوم. جرّب مرة ثانية."],
  [/invalid api key/i, "مفتاح OpenAI غلط أو انلغى. حط مفتاح جديد من صفحة الذكاء الاصطناعي."],
  [/rate limit or quota/i, "OpenAI طلب نخفف الطلبات. استنى دقيقة وجرّب مرة ثانية."],
  [/openai error (\d+)/i, (m) => `صار خطأ من OpenAI (رمز ${m[1]}). جرّب بعد شوي.`],
  [/quotaexceeded|quota.*exceeded/i, "المساحة المتاحة بالمتصفح خلصت. نزّل ملف حفظ وامسح الصور القديمة."],
  [/failed to fetch|networkerror|load failed/i, "ما في اتصال بالإنترنت أو الخدمة مش متاحة هلأ. جرّب مرة ثانية."],
];

export function arabicError(message: string): string {
  for (const [re, text] of MESSAGES) {
    const match = re.exec(message);
    if (match) return typeof text === "string" ? text : text(match);
  }
  return message;
}

export function errorText(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "وقّفت الشغل. اللي خلص قبل الإيقاف انحفظ.";
  if (error instanceof DOMException && error.name === "QuotaExceededError") return arabicError("QuotaExceeded");
  return arabicError(error instanceof Error ? error.message : String(error));
}
