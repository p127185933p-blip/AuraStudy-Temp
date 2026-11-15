# AGENTS.md — AuraStudy 核心開發憲法

本文件定義 **AuraStudy** 專案的最高架構與工程開發準則。所有後續階段（Phase 1 至 Phase 5）的實作、重構與審查皆必須嚴格遵守本憲法，不得有任何例外。

---

## 1. 依賴方向鐵律（Strict Dependency Rule）

本專案採用 **Modular Monolith + 分層架構（Layered Architecture）**，依賴方向嚴格單向流動：

```text
UI (src/pages, src/features)
        │
        ▼
Application (src/application/commands, src/application/services)
        │
        ▼
Domain (src/domain/schedule, src/domain/proposals, src/domain/planning)
```

- **Domain 層純潔性**：`src/domain/` 僅包含純 TypeScript 領域模型、不變量（Invariants）、驗證規則與純函式邏輯。
- **Domain 絕對禁止匯入**：`src/domain/` **絕對禁止** 匯入 `react`、`react-dom`、任何瀏覽器 DOM/UI API、資料庫 SDK（如 Supabase）、AI SDK（如 `@google/genai`）或 `infrastructure` / `application` / `features` / `pages` 模組。
- **Infrastructure 職責分離**：`src/infrastructure/`（`database/`、`ai/`、`repositories/`）負責實作資料持久化讀寫、外部 AI 服務介接與儲存庫介面，不得包含 UI 元件或畫面邏輯。
- **Application 協調層**：`src/application/` 負責協調 Use Case（Commands / Services），呼叫 `Domain` 執行業務驗證，並透過介面委派 `Infrastructure` 進行讀寫。

---

## 2. 禁止模組跨界（Module Boundary Isolation）

- **Feature 隔離**：`src/features/*`（`timeline`、`schedule-cards`、`ai-chat`、`proposals`、`settings`）之間**禁止**直接修改彼此的內部狀態或跨 Feature 匯入私有實作。跨模組通訊必須透過 `src/application/` 或 `src/app/` 提供的公共契約進行。
- **UI 禁止直連資料庫**：`src/pages/` 與 `src/features/` **絕對禁止** 直接讀寫資料庫或直接呼叫外部 AI SDK，所有狀態變更與外部請求皆須經由 `src/application/`。
- **Shared 層界線**：`src/shared/`（`ui/`、`schemas/`、`utils/`）僅存放跨層共用的無業務狀態元件、基礎 Zod Schema 與純工具函式，不得反過來依賴 `features/` 或 `pages/`。

---

## 3. 核心資料模型分離（Deadline vs. Schedule）

行程與截止事項在語意與規則上必須**嚴格分離**，絕不混為同一鬆散結構：

1. **`Deadline`（截止事項）**
   - 僅包含截止日期／時間點 `dueDate`。
   - **無**開始時間與結束時間區間。
   - **不參與**時段衝突檢查（Time Conflict Check）。
   - 具備 `revision` 樂觀鎖版本號。

2. **`Schedule`（排程時段）**
   - **必須**同時具備 `startAt` 與 `endAt`。
   - 必須滿足領域不變量：`endAt > startAt`。
   - **必須**進行時間區間衝突檢查。
   - 具備 `revision` 樂觀鎖版本號。

---

## 4. AI 協作邊界（Proposal-First Collaboration）

- **唯讀提議原則**：AI 永遠只能讀取必要上下文並產生待確認的 `ProposalChange`（類型僅限 `create` / `update` / `delete`）。
- **人工核准鐵律**：AI **絕對不可** 未經使用者明確點擊「✓ Accept」確認按鈕，就直接建立、更新或刪除任何正式的 `Schedule` 或 `Deadline`。
- **可預期與可追溯**：所有 AI 變更必須以視覺化差異提案呈現，確保使用者在套用前能清楚辨識新增、修改與刪除項目。

---

## 5. 開發紀律（Engineering Discipline）

- **嚴禁擅自增加規格外功能（No Unrequested Features）**：嚴格依循當前階段驗收目標開發，不提前實作未來階段功能，不加入未經要求的小工具、遙測面板或裝飾性假互動。
- **嚴禁過度抽象化（No Over-Engineering）**：維持簡潔、清晰、可讀的程式碼，不為假設中的未來需求建立複雜的通用工廠或過度包裝。
- **驗證門檻**：每次開發階段完成前，必須驗證以下項目全數通過：
  1. `npm run typecheck`（`tsc --noEmit` 零錯誤）
  2. `npm run test`（`vitest run` 全數通過）
  3. `npm run build`（Vite 正式建置成功）
