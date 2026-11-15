# Architecture Overview

AuraStudy 採用 **Modular Monolith** 設計，兼顧開發敏捷度與嚴格的模組邊界控制。

## 分層職責

1. **`src/app/` & `src/pages/`**
   - 負責應用程式初始化、主題／Token 載入與頁面佈局組合。
2. **`src/features/`**
   - 按業務能力切分：`timeline`、`schedule-cards`、`ai-chat`、`proposals`、`settings`。
   - 各 Feature 之間不得直接存取或修改彼此的內部狀態。
3. **`src/application/`**
   - `commands/`：寫入與狀態變更指令（例如未來套用提案或儲存行程）。
   - `services/`：查詢協調與跨領域流程編排。
4. **`src/domain/`**
   - `schedule/`：核心行程實體、時間不變量與衝突規則。
   - `proposals/`：AI 提案變更模型（`create` / `update` / `delete`）。
   - `planning/`：學習排程規劃計算規則。
   - **限制**：完全純 TypeScript，不依賴 React、瀏覽器 API、資料庫或 AI SDK。
5. **`src/infrastructure/`**
   - `database/`、`repositories/`、`ai/`：具體實作持久化儲存與 AI 模型呼叫。
6. **`src/shared/`**
   - 跨層共用基礎 UI 元件、Zod Schemas 與無副作用工具函式。

## 依賴規則

`UI (pages/features) -> Application -> Domain`
`Infrastructure -> Application / Domain (實作介面)`
