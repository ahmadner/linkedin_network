# تحليل شبكة LinkedIn + رسائل مخصصة لكل شخص

أداة Python تشتغل محليًا على جهازك: تقرأ **التصدير الرسمي** لبياناتك من LinkedIn،
تنظّف وتصنّف كل شخص في شبكتك، ترتّبهم بالأولوية حسب أهدافك، وتكتب لكل واحد
رسالة مخصصة (عربي + إنجليزي) حسب **الشركة والقطاع والمنصب** الي هو فيه.

المخرجات: ملف Excel واحد فيه 7 شيتات + ملف CSV للداتا الخام.

---

## 1) ليش التصدير الرسمي وليس scraping

| الطريقة | الحكم |
|---|---|
| **Official Data Export** (المستخدمة هنا) | قانونية 100%، داتا من مصدرها، كاملة، تاريخ الاتصال موجود، ما بتعرّض حسابك لأي خطر |
| LinkedIn Official API | **ما بيوفّر** قائمة الـ connections — محصور بـ partners لأغراض مختلفة |
| Scraping / automation tools | خرق لشروط الاستخدام، خطر تقييد أو إغلاق الحساب، وداتا ناقصة وغير موثوقة |

التصدير الرسمي يعطي لكل شخص: الاسم الأول، الاسم الأخير، رابط البروفايل،
الإيميل (إذا الشخص سمح بمشاركته)، الشركة، المسمى الوظيفي، وتاريخ الاتصال.

---

## 2) كيف تجيب ملف التصدير (٥ دقائق)

1. افتح LinkedIn → اضغط صورتك → **Settings & Privacy**
2. **Data privacy** → **Get a copy of your data**
3. اختر **Want something in particular?** وحدّد:
   - **Connections** ← قائمة الأشخاص (إلزامي)
   - **Messages** ← سجل المحادثات (ضروري لميزة "هل بعثنا قبل؟")
   - **Invitations** ← طلبات الاتصال ونصوصها
4. **Request archive** → أدخل كلمة المرور
5. بيوصلك إيميل من LinkedIn فيه رابط التحميل
   (Connections لحاله ~10 دقائق؛ مع Messages ممكن يوصل لـ 24 ساعة)
6. حمّل الـ `.zip` وحطّه في `data/raw/`

> إذا اخترت Connections فقط، الأداة بتشتغل عادي بس عمود "هل بعثنا قبل؟"
> بيطلع `Unknown - no message data` بدل ما يخمّن — ومذكور صريح في شيت Data_Quality.

> الأداة بتقبل الـ `.zip` مباشرة، أو المجلد المستخرج، أو ملف `Connections.csv` لحاله.

---

## 3) التشغيل

```powershell
pip install -r requirements.txt
```

انسخ ملف الإعدادات من القالب (أول مرة بس):

```powershell
Copy-Item config/my_profile.example.json config/my_profile.json
```

> لو نسيت، أول تشغيل بينسخه عنك لحاله وبينبّهك انه فاضي.
> نسختك `config/my_profile.json` مستثناة من git لأنها بتحمل إيميلك ورقمك ولينك الـ CV،
> والقالب `config/my_profile.example.json` هو المتتبّع.

```powershell
python src/main.py --input data/raw/Basic_LinkedInDataExport.zip
```

تجربة سريعة على بيانات وهمية قبل ما تجيب تصديرك — تصدير كامل مزيّف
(connections + messages + invitations + profile) فتشوف ميزة "بعتنا قبل؟" شغّالة:

```powershell
python src/main.py -i samples/export_example -p config/my_profile.sample.json --log data/outreach_log.example.csv --name example
```

أو على ملف الـ connections لحاله بدون أي سجل تواصل:

```powershell
python src/main.py -i samples/Connections.sample.csv -p config/my_profile.sample.json --name demo
```

خيارات مفيدة:

| الخيار | الوظيفة |
|---|---|
| `-i, --input` | مسار الـ zip / المجلد / Connections.csv |
| `-p, --profile` | ملف بياناتك وأهدافك (افتراضي `config/my_profile.json`) |
| `-o, --outdir` | مجلد المخرجات (افتراضي `data/out`) |
| `--name` | اسم ملف المخرجات |
| `--previous` | تقرير سابق `.xlsx` — تنقل منه أعمدة المتابعة الي عبّيتها |
| `--log` | ملف سجلّك اليدوي (افتراضي `data/outreach_log.csv`) |
| `--no-history` | تجاهل سجل الرسائل تمامًا |
| `--suggest-profile` | يقرأ ملفاتك الشخصية من نفس التصدير (Profile/Positions/Skills) ويعبّي لك مسودة بروفايل |

---

## 3.5) ميزة «هل بعثنا لهذا الشخص قبل؟»

الأداة بتقرأ `messages.csv` و`Invitations.csv` من نفس التصدير، وبتربط كل رسالة
بصاحبها عن طريق **رابط البروفايل أولًا** وبالاسم ثانيًا، وبتحدد تلقائيًا من هو
صاحب الحساب (من `Profile.csv`) عشان تعرف اتجاه كل رسالة.

النتيجة: 3 أوضاع، وكل وضع له **رسالة مختلفة كليًا**:

| الوضع | الحالة | الرسالة المولّدة |
|---|---|---|
| **Cold** | ولا رسالة بينكم (ولو في طلب اتصال بدون رسالة) | تعريف كامل بنفسك |
| **Reconnect** | تحادثتم قبل، أو هو بعتلك وما رديت | «آخر تواصل بينا كان قبل سنتين…» بدون إعادة تعريف |
| **Nudge** | بعتت وما رد | تذكير واحد قصير ومحترم، **بدون تكرار العرض** |

الأعمدة الجديدة في التقرير: `Contacted Before?` (أخضر = جديد، أصفر = سبق التواصل)،
`Msgs I Sent`، `Msgs Received`، `They Ever Replied?`، `Last Contact`،
`Days Since`، `Last Direction`، `Invite Sent?`، `Channels Used`،
`History Matched By`، و`Outreach Advice` الي يكتب لك التوصية بالكلام:

> *«You wrote 10 days ago and got no reply — do not write again yet, wait at least a month»*

وكمان النقاط بتتأثر: الي بعتتله وما رد ينزل **-12**، والي تواصلت معه خلال 30 يوم ينزل **-8** —
عشان الترتيب يعطيك الي فعلًا منطقي تبعتله اليوم.

### تواصل خارج LinkedIn أو بعد التصدير
`data/outreach_log.csv` — سجّل فيه أي تواصل بالإيميل أو واتساب أو اللي بعتته
بعد ما سحبت التصدير. القالب جاهز في `data/outreach_log.example.csv`:

```csv
profile_url,full_name,channel,direction,sent_at,note
https://www.linkedin.com/in/lina-haddad/,Lina Haddad,Email,out,2026-11-20,بعتت السيرة الذاتية
https://www.linkedin.com/in/rana-saleh-ux/,Rana Saleh,whatsapp,received,2026-09-02,سألت عن الفرص
```

عمود `direction`: اكتب `out` / `sent` / `بعثت` للي بعتته، و`in` / `received` / `رد`
للي وصلك. لو خليته فاضي بيعتبره صادر منك — الخطأ الآمن، لأنه يمنع رسالة
بدل ما يبعت تعريف لشخص صار بينكم كلام.

ملفك الحقيقي `data/outreach_log.csv` مستثنى من git (فيه أسماء وأرقام ناس).

### الحفاظ على متابعتك بين التشغيلات
```powershell
python src/main.py -i data/raw/export.zip --previous data/out/linkedin_network_2026-11-27.xlsx
```
بينقل أعمدة `Status` و`Date Sent` و`Replied?` و`Next Step` و`Notes` الي عبّيتها
يدويًا، بالمطابقة على رابط البروفايل — فتصدير جديد ما بيضيّع شغلك.

---

## 4) `config/my_profile.json` — الملف الوحيد الي بتعدّله

كل رسالة وكل درجة أولوية مبنية على هذا الملف:

```jsonc
"me": {
  "full_name": "...",            // اسمك
  "current_role": "...",          // دورك الحالي أو المستهدف
  "years_experience": 4,
  "target_roles": ["..."],        // الأدوار الي بتدور عليها
  "top_skills": ["..."],          // أهم 3-4 مهارات (تظهر في الرسالة)
  "highlight_ar": "...",          // إنجاز بسطر واحد بالعربي
  "highlight_en": "...",          // ونفسه بالإنجليزي
  "cv_link": "https://..."        // رابط السيرة الذاتية
},
"targeting": {
  "goal": "job_search",           // job_search | sales | partnership | networking
  "target_functions":  ["Engineering & Software", "HR & Recruiting"],
  "target_industries": ["Software & IT Services", "Banking & Finance"],
  "target_companies":  ["..."],   // شركات أحلامك ← تأخذ +20 نقطة
  "excluded_companies": ["..."],  // شركات تستثنيها تمامًا
  "weights": { ... },             // أوزان النقاط — عدّلها كيف ما بدك
  "buckets": { "A": 65, "B": 45, "C": 25 }
}
```

عدّل وأعد التشغيل: الملف كله — بما فيه كل الرسائل — بيتولد من جديد بثوانٍ.

### تصحيح قطاع شركة
`config/company_overrides.csv` — سطر لكل شركة، والتصحيح بيسري على التقرير كله:

```csv
company,industry
optimiza,Software & IT Services
```

---

## 5) شيتات ملف Excel

| الشيت | المحتوى |
|---|---|
| **Dashboard** | مؤشرات عامة + توزيع المناصب والتخصصات والقطاعات + 3 رسوم بيانية + طريقة الاستخدام |
| **Priority_A** | القائمة القصيرة المرتّبة — ابدأ من فوق لتحت |
| **Connections** | كل شخص بكل التفاصيل: التصنيف، النقاط، سبب النقاط، سجل التواصل السابق، + أعمدة متابعة (Status / Date Sent / Replied / Notes) بقوائم منسدلة |
| **Messages** | لكل شخص: وضع التواصل + رسالة قصيرة (≤200 حرف) + الرسالة الكاملة + متابعة — عربي وإنجليزي، مع عدّاد أحرف يحمر إذا تجاوز الحد |
| **Companies** | صف لكل شركة: عدد معارفك فيها، أفضل نقطة دخول، عدد أصحاب القرار، التخصصات الموجودة |
| **Data_Quality** | كل حقل ناقص أو مُصلَّح في التصدير + الحقول الي LinkedIn **ما** بيوفّرها أصلًا |
| **Reference** | شرح كل قاعدة تصنيف وكل وزن نقاط — مفيش رقم بدون تفسير |

---

## 6) كيف يشتغل التصنيف

**المنصب (Seniority):** قراءة قواعدية للمسمى الوظيفي من الأعلى للأدنى:
`Founder/Owner → C-Level → VP → Director → Head → Manager → Team Lead → Senior IC → Consultant → Mid IC → Junior → Intern → Student`

الفخاخ المعروفة معالجة: **Product Manager / Project Manager / Account Manager**
تُصنّف كـ individual contributor لا كمدير أشخاص.

**التخصص (Function):** مطابقة كلمات موزونة بالعربي والإنجليزي، والأقوى يفوز —
"Senior Cloud Data Engineer" تروح لـ Data & AI لا لأول كلمة بتطابق.

**القطاع (Industry):** من اسم الشركة (bank / telecom / hospital / ministry / logistics...)
+ قائمة شركات معروفة عالميًا + ملف الـ overrides. القطاعات المحددة تُفحص قبل العامة،
فـ "Ministry of Digital Economy" حكومي لا شركة برمجيات. وأي شي ما بتأكد منه
يبقى `Unknown` — **ما يُخترع**.

**النقاط:** مجموع موزون وشفاف: recruiter/HR، صاحب قرار في تخصص مستهدف، درجة
المنصب، شركة مستهدفة، قطاع مستهدف، تخصص مستهدف، إيميل متاح، حداثة الاتصال،
وعدد معارفك في نفس الشركة. مع خصم للطلاب والشركات المجهولة.
**سبب النقاط لكل شخص موجود في عمود `Score Breakdown`.**

**الرسائل:** كل شخص يُسنّد لـ archetype
(Recruiter / Hiring manager / Senior leader / Founder / Peer / Student / General)
ثم تُدمج معه **زاوية خاصة بقطاعه** — فالي بالبنك والي بالاتصالات والي بمنظمة
دولية يستلمون افتتاحيات مختلفة فعليًا، لا mail merge.

---

## 7) حقول LinkedIn ما بيوفّرها في التصدير

هاي ليست نقص في الأداة — هاي حدود المصدر نفسه، ومذكورة صريحة في شيت `Data_Quality`:

- المدينة/الدولة للشخص (تُستنتج فقط إذا رابط البروفايل حاوي عليها)
- رقم الهاتف، عدد المتابعين، ملخص البروفايل، المهارات
- التاريخ الوظيفي أو مدة بقائه في الشركة الحالية
- إذا الشخص بيوظّف حاليًا
- حجم الشركة أو موقعها الإلكتروني

---

## 8) ملاحظات استخدام

- **لا ترسل بالجملة.** LinkedIn بيقيّد الحسابات على السلوك الآلي. الرسائل هنا
  للنسخ اليدوي، والهدف 15–25 رسالة باليوم كحد أقصى.
- نوت طلب الاتصال محدود بـ **200 حرف** للحساب المجاني — الأداة بتقص على حدود
  الكلمة وبتعرض العدّاد.
- الأداة تمنعك تلقائيًا من تكرار العرض على شخص ما رد — احترم التوصية في عمود
  `Outreach Advice`، التكرار بيحرق العلاقة.
- راجع أول 5 رسائل وعدّل النبرة في `config/my_profile.json` قبل ما تكمل.
- سجّل كل تواصل في أعمدة المتابعة بشيت `Connections` عشان ما تكرر على نفس الشخص.

---

## 9) بنية المشروع

```
linkedin_network/
├── src/
│   ├── main.py        خط التشغيل الكامل (CLI)
│   ├── loader.py      قراءة التصدير بكل حالاته الشاذة
│   ├── normalize.py   تنظيف الأسماء والشركات والمسميات
│   ├── classify.py    قواعد المنصب والتخصص والقطاع
│   ├── scoring.py     حساب الأولوية بشكل شفاف
│   ├── history.py     سجل التواصل السابق (messages + invitations + log)
│   ├── messages.py    توليد الرسائل عربي/إنجليزي
│   └── report.py      كتابة ملف Excel
├── config/
│   ├── my_profile.example.json  القالب المتتبّع — انسخه
│   ├── my_profile.json          ← عدّل هذا (مستثنى من git)
│   ├── my_profile.sample.json   مثال معبّى للتجربة
│   └── company_overrides.csv    تصحيح قطاعات الشركات
├── data/
│   ├── raw/                     حطّ التصدير هنا (مستثنى من git)
│   ├── out/                     المخرجات (مستثناة من git)
│   ├── outreach_log.example.csv قالب السجل اليدوي
│   └── outreach_log.csv         سجلّك الحقيقي (مستثنى من git)
├── samples/
│   ├── Connections.sample.csv   ملف connections وهمي لحاله
│   └── export_example/          تصدير كامل وهمي: Connections + messages
│                                + Invitations + Profile
├── .gitignore       كل بيانات الناس والمخرجات مستثناة
└── .gitattributes   LF داخل الريبو، و xlsx/zip كـ binary
```

### ما بينرفع على git أبدًا
| | |
|---|---|
| `data/raw/`, `*.zip` | تصدير LinkedIn نفسه |
| `data/out/`, `*.xlsx` | التقارير — فيها أسماء وإيميلات ومناصب |
| `config/my_profile.json` | إيميلك، رقمك، لينك الـ CV |
| `data/outreach_log.csv` | سجل تواصلك الحقيقي |

الي بينرفع هو الكود والقوالب والبيانات الوهمية بس.

لا اتصال بالشبكة، لا scraping، لا استهلاك توكنز — كود حتمي يعطي نفس النتيجة
في كل مرة.
