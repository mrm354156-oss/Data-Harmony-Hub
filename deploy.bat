@echo off
echo ============================================
echo  نشر المشروع على GitHub Pages
echo ============================================
echo.
echo الخطوات المطلوبة:
echo.
echo 1. إنشاء مستودع على GitHub:
echo    - اذهب إلى https://github.com/new
echo    - اسم المستودع مثلاً: data-harmony-hub
echo    - لا تضف README, .gitignore أو License
echo.
echo 2. رفع المشروع إلى GitHub:
echo    cd /d %~dp0
echo    git init
echo    git add .
echo    git commit -m "النشر الأولي"
echo    git branch -M main
echo    git remote add origin https://github.com/mrm029671-tech/-.git
echo    git push -u origin main
echo.
echo 3. تفعيل GitHub Pages:
echo    - اذهب إلى Settings ^> Pages في المستودع
echo    - Source: GitHub Actions
echo.
echo 4. بعد الرفع، GitHub Actions سيبني وينشر تلقائياً
echo    - راجع التبويب Actions في المستودع
echo.
echo 5. سيتم النشر على:
echo    https://mrm029671-tech.github.io/-/
echo.
echo ============================================
echo ملاحظة: تأكد من تغيير mrm029671-tech إلى اسم
echo المستخدم الخاص بك في GitHub
echo ============================================
pause