# UI Guidelines

AuraStudy 的視覺語言核心為：**簡約、整齊、優雅、圓潤、粗實、清楚**。

## 視覺原則

1. **高對比與柔和淺色畫布**：採用乾淨低飽和淺色背景與深色高對比文字，確保長時間閱讀與戶外行動裝置瀏覽皆清晰不刺眼。
2. **圓潤與粗實邊界**：卡片使用 `14px`–`20px` 圓角，搭配 `1.5px`–`2px` 清晰邊框與單層實體感陰影，避免模糊多層疊加或卡片套卡片。
3. **語意色彩區隔**：
   - `Schedule`（排程時段）：沉穩藍（`--color-schedule-*`）
   - `Deadline`（截止事項）：醒目琥珀橘（`--color-deadline-*`）
   - AI 提案 `CREATE`：柔和綠（`--color-proposal-create-*`）
   - AI 提案 `UPDATE`：清晰天藍變更提示色（`--color-proposal-update-*`）
   - AI 提案 `DELETE`：淡化紅（`--color-proposal-delete-*`）
4. **雙端響應式設計**：所有設計 Token 同步適配手機（Android 單手觸控最小點擊熱區 `44px`）與桌面寬螢幕佈局。
