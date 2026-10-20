@echo off
chcp 65001 >nul
title Erasa - allow phone access
rem يفتح المنفذ 3000 في جدار حماية ويندوز للشبكات الخاصة فقط (Wi-Fi المنزل/المكتب) حتى يصل الهاتف للبرنامج.
rem يحتاج صلاحيات المسؤول: سيطلب ويندوز الموافقة.

net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

set PORT=3000
for /f "usebackq tokens=1,* delims==" %%A in ("%~dp0.env") do (
  if /i "%%A"=="PORT" set PORT=%%~B
)

netsh advfirewall firewall delete rule name="Erasa System" >nul 2>&1
netsh advfirewall firewall add rule name="Erasa System" dir=in action=allow protocol=TCP localport=%PORT% profile=private
if errorlevel 1 (
  echo [خطأ] تعذر إضافة القاعدة.
) else (
  echo تم: الهاتف يستطيع الآن فتح البرنامج على المنفذ %PORT% من نفس شبكة Wi-Fi.
  echo تأكد أن شبكة Wi-Fi مضبوطة على "خاصة" Private في إعدادات ويندوز.
)
pause
