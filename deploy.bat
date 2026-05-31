@echo off
echo ============================================
echo  نشر المشروع على Firebase Hosting
echo ============================================
echo.
echo الخطوات المطلوبة:
echo.
echo 1. تثبيت Firebase CLI (إذا لم يكن مثبتاً):
echo    npm install -g firebase-tools
echo.
echo 2. تسجيل الدخول إلى Firebase:
echo    firebase login
echo.
echo 3. إنشاء مشروع Firebase (مرة واحدة فقط):
echo    - اذهب إلى https://console.firebase.google.com
echo    - أنشئ مشروع جديد باسم: data-harmony-hub
echo    - ربط المستودع: firebase init hosting
echo.
echo 4. بناء المشروع:
echo    npm run build
echo.
echo 5. النشر على Firebase:
echo    firebase deploy --only hosting
echo.
echo 6. أو يمكنك ربط GitHub Actions للنشر التلقائي:
echo    - في GitHub repository ^> Settings ^> Secrets
echo    - أضف: FIREBASE_TOKEN
echo    - احصل عليه من: firebase login:ci
echo.
echo ============================================
echo رابط المشروع بعد النشر:
echo https://data-harmony-hub.web.app
echo ============================================
pause