# لمسة ناعمة – تعليمات تركيب التتبع (لـ Claude in Chrome)

```
أنت تعمل داخل متصفح Chrome الخاص بي وأنا مسجّل دخول في حساباتي (Google وووردبريس موقع lamsanaema.com). المطلوب تركيب تتبع كامل لموقع لمسة ناعمة. لديك تفويض بالتنفيذ، لكن:
- لا تدخل أو تطلب أي كلمة مرور. لو ظهر تسجيل دخول أو تحقق بخطوتين، توقف وأخبرني.
- لا تغيّر أي محتوى أو تصميم في الموقع، ولا تحذف أي إضافة موجودة.
- لا تغيّر ميزانيات أو حملات في Google Ads أو Meta.

1) Google Tag Manager
   - افتح https://tagmanager.google.com . لو يوجد حاوية لموقع lamsanaema.com استخدمها، وإلا أنشئ حساب "Lamsa Naema" وحاوية Web باسم lamsanaema.com.
   - سجّل رقم الحاوية (GTM-XXXX).

2) تركيب GTM على الموقع (ووردبريس)
   - افتح https://lamsanaema.com/wp-admin ← Plugins ← Add New ← ابحث "GTM4WP" (Google Tag Manager for WordPress by Thomas Geiger) ← Install ← Activate.
   - Settings ← Google Tag Manager ← ضع رقم GTM-XXXX ← Save.
   - لو يوجد إضافة كاش (LiteSpeed / WP Rocket / W3 Total Cache / Autoptimize) امسح الكاش بالكامل.

3) GA4
   - افتح https://analytics.google.com . لو يوجد Property لـ lamsanaema.com خذ Measurement ID (G-XXXX) من Admin ← Data streams. لو لا يوجد، أنشئ Property "Lamsa Naema" (توقيت الرياض، الريال السعودي) وWeb stream للموقع.

4) داخل GTM (Workspace الافتراضي)
   أ) Variables ← Configure ← فعّل Click URL و Click Text.
   ب) Tag: "GA4 – Google Tag" نوع Google Tag بالـ ID G-XXXX، Trigger: Initialization – All Pages.
   ج) Triggers (كلها Just Links، بدون Wait for tags):
      - "WA – Muanseya": Click URL contains 966567169169 و Click URL contains whatsapp
      - "WA – Laban": Click URL contains 966542866636 و Click URL contains whatsapp
      - "Call – Muanseya": Click URL starts with tel: و Click URL contains 567169169
      - "Call – Laban": Click URL starts with tel: و Click URL contains 542866636
      - "Booking form": Form Submission على صفحة الحجز (https://lamsanaema.com/احجز-موعدك/) أو Element Visibility لرسالة التأكيد إن لم يعمل Form Submission.
   د) Tags (GA4 Event):
      - whatsapp_click مع parameter branch = munsiyah أو laban (تاج لكل Trigger واتساب)
      - phone_click مع parameter branch = munsiyah أو laban
      - booking_submit
   هـ) Meta Pixel 1733830051165442: تاج Custom HTML بكود البيكسل الأساسي (PageView) على All Pages، وتاج Custom HTML `fbq('track','Contact',{content_name:'whatsapp'})` على Triggers واتساب، و`fbq('track','Contact',{content_name:'call'})` على Triggers الاتصال، و`fbq('track','Lead')` على الحجز.
   و) Preview (Tag Assistant) ← افتح الموقع ← اضغط زر واتساب لكل فرع وزر الاتصال ← تأكد أن التاجات تعمل. (الضغط سيفتح واتساب – أغلقه بدون إرسال.)
   ز) Submit ← Publish باسم "Lamsa tracking v1".

5) GA4 ← Admin ← Events/Key events: بعد ظهور الأحداث، اجعل whatsapp_click و phone_click و booking_submit "Key events".

6) Google Ads (حساب 439-907-0066 – Lamsa Naema)
   - Tools ← Data manager ← Google Analytics ← اربط Property الـ GA4 (Link) وفعّل Auto-tagging.
   - Goals ← Conversions ← New conversion action ← Import ← Google Analytics 4 ← Web ← اختر whatsapp_click و phone_click و booking_submit ← Primary.
   - لا تغيّر أي حملة أو ميزانية.

7) أرسل لي تقريراً: رقم GTM، رقم G-، أسماء التاجات والـ Triggers، نتيجة Preview لكل زر، رقم نسخة النشر، وحالة التحويلات في Google Ads.
```
