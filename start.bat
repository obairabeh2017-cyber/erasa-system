@echo off
chcp 65001 >nul
title Erasa - شركة ايراسا
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [خطأ] Node.js غير مثبت. ثبّت الإصدار 22 LTS من https://nodejs.org ثم أعد المحاولة.
  pause
  exit /b 1
)

if not exist ".env" (
  echo [خطأ] ملف .env غير موجود. راجع خطوات التثبيت في README.md
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo تثبيت الحزم لأول مرة...
  call npm install || goto :fail
)

echo تطبيق ترحيلات قاعدة البيانات (إن وُجدت)...
call npx prisma migrate deploy || goto :fail

if not exist ".next\BUILD_ID" (
  echo بناء البرنامج لأول مرة - قد يستغرق دقيقة أو دقيقتين...
  call npm run build || goto :fail
)

start "" /min cmd /c "timeout /t 6 >nul & start http://localhost:3000"
call npm start
goto :eof

:fail
echo.
echo [خطأ] فشل التشغيل. راجع الرسائل أعلاه وقسم "حل المشكلات" في README.md
pause
exit /b 1
