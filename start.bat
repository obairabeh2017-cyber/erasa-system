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
  echo إنشاء ملف الإعدادات .env لأول مرة...
  copy /y ".env.example" ".env" >nul
  node -e "const fs=require('fs');let s=fs.readFileSync('.env','utf8');s=s.replace('change-me-to-a-long-random-secret-value-please',require('crypto').randomBytes(48).toString('hex'));fs.writeFileSync('.env',s)"
  echo.
  echo [مهم] افتح الملف .env وضع كلمة مرور المالك في OWNER_PASSWORD ثم شغّل start.bat مرة أخرى.
  notepad .env
  pause
  exit /b 0
)

if not exist "node_modules" (
  echo تثبيت الحزم لأول مرة - يحتاج إنترنت مرة واحدة فقط...
  call npm install || goto :fail
)

if not exist ".next\BUILD_ID" (
  echo بناء البرنامج لأول مرة - قد يستغرق دقيقة أو دقيقتين...
  call npm run build || goto :fail
)

rem قاعدة البيانات المدمجة وترحيلاتها تُشغَّل تلقائياً داخل البرنامج
start "" /min cmd /c "timeout /t 8 >nul & start http://localhost:3000"
call npm start
goto :eof

:fail
echo.
echo [خطأ] فشل التشغيل. راجع الرسائل أعلاه وقسم "حل المشكلات" في README.md
pause
exit /b 1
