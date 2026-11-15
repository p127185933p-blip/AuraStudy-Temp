# AuraStudy Android 封裝與桌面小工具（Widget）本機打包指南

本指南說明如何將 **AuraStudy** Web/PWA 專案透過 **Capacitor** 封裝為 Android App，並掛載原生的 **4x2 桌面小工具（AuraStudy Home Widget）**。

> **設計邊界提醒**：Android Widget 僅負責「今日行程快速查看（最多 4 筆）」、「近期截止日期（最多 3 筆）」、「重要行程摘要」以及「點擊開啟 AuraStudy App」，不進行完整編輯或 AI 對話。

---

## 前置需求

- Node.js 20+ 與 npm
- Android Studio（含 Android SDK 34+ 與 Platform Tools）
- 已下載本專案完整原始碼至本機

---

## 步驟一：建置 Web 正式檔案

在專案根目錄執行：

```bash
npm install
npm run build
```

確認 `dist/` 目錄已成功產出。

---

## 步驟二：安裝 Capacitor 並建立 Android 原生專案

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap add android
npx cap sync android
```

根目錄的 `capacitor.config.ts` 已預設：
- `appId`: `"com.aurastudy.app"`
- `appName`: `"AuraStudy"`
- `webDir`: `"dist"`

---

## 步驟三：複製 `android-widget/` 原生模板至 Android 專案

將本目錄內的原生程式碼與資源複製到 Capacitor 產生的 `android/` 專案對應路徑：

```bash
cp -r android-widget/app/src/main/* android/app/src/main/
```

包含以下檔案：
- `java/com/aurastudy/app/widget/AuraStudyWidgetBridge.kt`
- `java/com/aurastudy/app/widget/AuraStudyWidgetProvider.kt`
- `res/layout/widget_aurastudy.xml`
- `res/xml/widget_aurastudy_info.xml`
- `res/values/colors.xml`
- `res/values-night/colors.xml`
- `res/drawable/widget_bg_rounded.xml`
- `res/drawable/widget_pill_bg.xml`
- `res/drawable/widget_row_bg.xml`
- `res/drawable/widget_row_expired_bg.xml`
- `res/drawable/widget_stripe_schedule.xml`
- `res/drawable/widget_stripe_deadline.xml`
- `res/drawable/widget_divider_line.xml`

---

## 步驟四：註冊 WebView 橋接與 Widget Provider

### 1. 修改 `android/app/src/main/java/com/aurastudy/app/MainActivity.java`（或 `.kt`）

在 `onCreate` 之後取得 Capacitor WebView 並註冊 `AuraStudyWidgetBridge`：

```kotlin
package com.aurastudy.app

import android.os.Bundle
import com.aurastudy.app.widget.AuraStudyWidgetBridge
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    bridge?.webView?.let { webView ->
      AuraStudyWidgetBridge.registerWithWebView(webView, this)
    }
  }
}
```

### 2. 修改 `android/app/src/main/AndroidManifest.xml`

在 `<application> ... </application>` 區塊內加入 Widget Receiver 宣告：

```xml
<receiver
    android:name="com.aurastudy.app.widget.AuraStudyWidgetProvider"
    android:exported="true">
    <intent-filter>
        <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
    </intent-filter>
    <meta-data
        android:name="android.appwidget.provider"
        android:resource="@xml/widget_aurastudy_info" />
</receiver>
```

---

## 步驟五：於 Android Studio 建置 APK 並加入桌面小工具

1. 執行 `npx cap open android` 開啟 Android Studio。
2. 等待 Gradle Sync 完成後，點選 **Build > Build Bundle(s) / APK(s) > Build APK(s)**（或直接點 **Run** 部署至實體 Android 手機）。
3. 開啟手機上的 **AuraStudy** App，任一正式行程載入或更新後，前端會自動透過 `window.AuraStudyAndroidBridge.updateWidgetSnapshot(...)` 寫入 `SharedPreferences` 並發送 `APPWIDGET_UPDATE`。
4. 回到 Android 手機主畫面長按空白處 → 點選 **小工具（Widgets）** → 找到 **AuraStudy** 並拖曳至桌面即可查看「今日行程」與「近期截止」。
