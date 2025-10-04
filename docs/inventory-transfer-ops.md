# 在庫移動機能（業務担当者向け）

## 1. 機能概要
- 在庫再配置画面では、選択したセッションと期間に対する PSI 行列を表示し、倉庫・チャネル間の在庫移動計画（Transfer Plan）を作成・編集できます。【F:frontend/src/pages/ReallocationPage.tsx†L620-L706】
- PSI 行列タブでは SKU ごとの在庫指標をクロステーブル／ヒートマップ／KPI などの視点で確認でき、ドラフト移動の影響が即時に反映されます。【F:frontend/src/features/reallocation/psi/PSIMatrixTabs.tsx†L20-L234】

## 2. 前提マスタ設定
- **倉庫マスタ**：各倉庫の「メインチャネル」を設定すると、推奨計画作成時に不足を優先的に解消する対象として扱われます。未設定の倉庫は推奨ロジックの対象外になるため、倉庫追加時は必ずメインチャネルを登録してください。【F:backend/app/models.py†L170-L207】【F:backend/app/services/transfer_plans.py†L200-L214】
- **再配置ポリシー**：管理者は `/api/reallocation-policy` を通じて以下の制御値を調整できます。【F:backend/app/routers/reallocation_policy.py†L20-L55】
  - `take_from_other_main`：他倉庫メインチャネルからも在庫を融通するか。
  - `rounding_mode`：推奨数量の丸め方（切り捨て／四捨五入／切り上げ）。
  - `allow_overfill`：標準在庫を超える入庫を許容するか。
  - `fair_share_mode`：不足倉庫への配分ルール（オフ／期末在庫比率／期首在庫比率）。
- ポリシー変更は即時に推奨アルゴリズムへ反映されるため、運用フロー変更時は事前に影響範囲を確認した上で更新してください。【F:backend/app/services/transfer_logic.py†L130-L266】

## 3. 操作フロー
1. 画面上部のフォームでセッションと期間（Start/End date）を選択し、「Apply filters」を押して PSI 行列を読み込みます。【F:frontend/src/pages/ReallocationPage.tsx†L706-L764】
2. 「Create recommendation」を押すと、指定期間の不足を補う推奨計画が自動生成され、計画 ID と行が読み込まれます。処理完了後はステータスメッセージで結果が表示されます。【F:frontend/src/pages/ReallocationPage.tsx†L706-L792】
3. 既存計画を再編集したい場合は「作成済みプラン」ドロップダウンから選択し、「Load plan」で内容を読み込みます。リストは最新順で自動補完され、必要に応じて「Refresh list」で再取得できます。【F:frontend/src/pages/ReallocationPage.tsx†L736-L792】
4. PSI 行列セクションでは SKU タブを切り替え、在庫指標の変化を確認します。検索窓やナビゲーションボタンで SKU を移動しながら内容を確認できます。【F:frontend/src/features/reallocation/psi/PSIMatrixTabs.tsx†L32-L228】

## 4. 計画行の編集と保存
- 計画行テーブルでは、SKU・倉庫・チャネル・数量・理由を直接編集できます。メニューから「Add manual line」で手動行を追加し、不要な行は「Remove」で削除します。【F:frontend/src/pages/ReallocationPage.tsx†L792-L936】
- 保存前に必須項目（SKU／移動元・先の倉庫とチャネル／数量）を入力し、数量は正の整数になるよう調整してください。条件を満たさない場合はエラーが表示され保存できません。【F:frontend/src/pages/ReallocationPage.tsx†L260-L360】【F:frontend/src/pages/ReallocationPage.tsx†L792-L876】
- 「Save lines」を押すとサーバーへ一括保存され、成功時には PSI 行列と計画一覧が最新状態に更新されます。【F:frontend/src/pages/ReallocationPage.tsx†L820-L876】

## 5. データ活用
- 「CSVダウンロード」を押すと、現在の計画行をヘッダー付き CSV で出力できます。ファイル名には計画 ID とタイムスタンプが付与され、手動行フラグや理由列も含まれます。【F:frontend/src/pages/ReallocationPage.tsx†L540-L620】【F:frontend/src/pages/ReallocationPage.tsx†L792-L876】
- 推奨計画で不足が解消されない場合は、倉庫のメインチャネル設定や再配置ポリシー値を見直し、必要に応じて手動行を追加して調整してください。【F:backend/app/services/transfer_logic.py†L200-L273】
