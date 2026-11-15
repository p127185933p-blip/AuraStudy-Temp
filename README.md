# AuraStudy

**AuraStudy** 是一個專注於學習排程與 AI 輔助提案規劃的應用程式，採用 **Modular Monolith** 嚴格分層架構（`UI -> Application -> Domain`）與「簡約、整齊、優雅、圓潤、粗實、清楚」設計語言，支援本地預覽模式、Supabase 雲端帳號同步、自備 AI 金鑰（BYOK）與 Android PWA 安裝。

---

## 功能總覽（Phase 0 – Phase 5）

- **核心領域模型嚴格分離（Phase 1）**：
  - `Deadline`（截止事項）：僅具 `dueDate` 錨點，不佔用時段且不參與衝突檢查。
  - `Schedule`（排程時段）：具備 `startAt` / `endAt` 與 `endAt > startAt` 領域不變量，強制執行時段衝突檢查與 `revision` 樂觀併發控制。
- **三視圖時間軸與觸控互動（Phase 2）**：
  - 支援 **月（Month）**、**週（Week）**、**日（Day）** 三種時間軸視圖同步切換與日期焦點保留，日視圖支援 15 分鐘刻度拖曳改期與衝突覆寫提示。
- **Proposal-First AI 協作流程（Phase 3）**：
  - AI 僅能產生待確認的 `ProposalChange`（`create` / `update` / `delete`），以紅／藍／綠視覺卡片呈現於時間軸；必須經使用者點擊「✓ 接受」才寫入正式行程，並支援「拒絕後於同一個懸浮對話框接續調整」與過期（`stale`）偵測。
- **雲端資料庫隔離與真實 AI 串接（Phase 4）**：
  - **Supabase PostgreSQL + RLS**：透過 `supabase/migrations/001_initial_schema.sql` 於資料庫層級強制區分 `Deadline` / `Schedule` 欄位約束並啟用 `auth.uid() = user_id` 資料隔離；未設定環境變數時自動降級為本地預覽模式。
  - **BYOK 真實 AI 串接**：支援 **Google Gemini**（`gemini-4-hydrogen`）、**OpenAI**（`gpt-6-luna`）與內建 **Demo 模式**；支援圖片（JPG/PNG/WEBP）與純文字附件（上限 5MB），金鑰預設僅暫存於 `sessionStorage`（可選填 `localStorage`），絕不記錄於系統日誌。
- **PWA 安裝、JSON 備份還原與錯誤防護（Phase 5）**：
  - 提供 Web App Manifest、App Icon 與僅快取靜態殼層（嚴格繞過 Supabase 與 AI API）之輕量 Service Worker。
  - 支援一鍵匯出結構化 `version: 1` JSON 備份與 Zod 嚴格驗證還原。
  - 內建全域 `AppErrorBoundary` 防止白屏，並完成完整 10 步驟端到端（E2E）與響應式安全檢查。

---

## 目錄結構

```text
├── AGENTS.md                  # 專案最高開發憲法
├── docs/                      # 架構、資料模型與設計指南摘要
├── public/                    # PWA Manifest、圖示與 App-Shell Service Worker
├── supabase/migrations/       # PostgreSQL Schema 與 RLS 安全政策
├── src/
│   ├── app/                   # 應用程式啟動、全域 Provider、PWA 註冊與基礎殼層
│   ├── pages/                 # 主頁面組合殼層
│   ├── features/              # 獨立功能模組（timeline, schedule-cards, ai-chat, proposals, settings）
│   ├── domain/                # 純領域模型與規則（schedule, proposals, planning）
│   ├── application/           # 用例協調層（commands, services, backupService）
│   ├── infrastructure/        # 外部介接與資料存取（database, ai, repositories）
│   ├── shared/                # 共用 UI（AppErrorBoundary）、Zod Schemas 與純工具函式
│   └── styles/                # 設計系統 Token 與全域樣式
└── tests/
    ├── unit/                  # 單元測試
    ├── integration/           # 整合測試
    └── e2e/                   # 端對端使用者旅程與備份還原測試
```

---

## 本機啟動與驗證指令

```bash
npm install        # 安裝專案相依套件
npm run dev        # 啟動開發伺服器 (http://localhost:3000)
npm run typecheck  # TypeScript 嚴格型別檢查 (tsc --noEmit)
npm run test       # 執行 Vitest 單元、整合與 E2E 測試
npm run build      # 建置正式產物 (dist/)
```

---

## 選填：Supabase 雲端同步與驗證部署

若需啟用跨裝置雲端資料庫同步與 Email 帳號登入：

1. 建立 Supabase 專案並於 SQL Editor 執行 `supabase/migrations/001_initial_schema.sql`（建立 `calendar_items`、`proposal_changes`、`decision_logs` 與 RLS 政策）。
2. 於環境變數設定（本機可參考 `.env.example`）：
   - `VITE_SUPABASE_URL`：您的 Supabase Project URL
   - `VITE_SUPABASE_ANON_KEY`：您的 Supabase Anon Public Key
3. 重新建置或啟動後，點擊時間軸右上角設定齒輪即可登入／註冊帳號。未設定環境變數時，應用程式將自動以「本地預覽模式」安全運行。

---

## Android PWA 安裝與未來 Phase 6 原生 Widget 擴充說明

- **Android Chrome 安裝方式**：
  1. 使用 Android 手機上的 Chrome 開啟已部署之 HTTPS AuraStudy 網址。
  2. 點擊設定彈窗中的「立即安裝應用程式」，或於 Chrome 右上角選單點擊「安裝應用程式 / 加到主畫面」，即可於獨立視窗（`standalone`）執行。
- **未來 Phase 6 Android 原生 Widget 擴充架構**：
  - PWA 本身屬於瀏覽器沙盒環境，無法直接提供系統桌面原生小工具（AppWidget）。
  - 未來進入 Phase 6 時，可透過 Android 原生層（如 Kotlin + Glance / Jetpack AppWidget）或 TWA（Trusted Web Activity）搭配共用後端（Supabase API）或本地橋接介面，直接重用 `docs/DATA_MODEL.md` 定義之 `Deadline` / `Schedule` 語意契約，於手機桌面顯示今日待辦與下一堂學習時段，並與既有 Web 核心邏輯保持完全一致。
