# 在庫移動機能（開発者向け）

## 1. 概要
- 「在庫再配置」画面はセッションと期間をもとに PSI 行列を取得し、倉庫・チャネル間の在庫移動計画（Transfer Plan）の作成・編集を行います。【F:frontend/src/pages/ReallocationPage.tsx†L620-L706】
- PSI 行列は `/api/psi/matrix` 経由で集計済みの `MatrixRowData` を取得し、保存済みの移動量とドラフト差分を合成して表示・計算します。【F:backend/app/services/transfer_plans.py†L21-L120】【F:frontend/src/pages/ReallocationPage.tsx†L488-L568】
- 移動計画は API 側でヘッダー・行を管理し、ドラフト生成・保存・再読込がフロントエンドの React Query フローと同期する設計です。【F:backend/app/routers/transfer_plans.py†L136-L238】【F:frontend/src/pages/ReallocationPage.tsx†L329-L455】

## 2. PSI 行列取得と加工
1. `fetch_matrix_rows` は指定セッション・期間の `psi_base` を SKU×倉庫×チャネルで集計し、開始日基準の在庫（stock_at_anchor）と標準在庫（stdstock）、期間内入出庫などをまとめます。【F:backend/app/services/transfer_plans.py†L21-L120】
2. 計画 ID が与えられた場合、`transfer_plan_lines` を出庫（負）/入庫（正）に分けて結合し、ベース集計に移動量をマージします。【F:backend/app/services/transfer_plans.py†L53-L110】
3. フロントエンドは取得した行に保存済み移動量・ドラフト差分を重ね合わせ、`stock_fin` や Gap などの指標をリアルタイムで再計算します。【F:frontend/src/pages/ReallocationPage.tsx†L488-L568】
4. PSI 行列 UI（`PSIMatrixTabs`）は SKU ナビゲーション、複数タブ（クロステーブル・ヒートマップ・KPI など）を通じて分析視点を切り替えられるよう構成されています。【F:frontend/src/features/reallocation/psi/PSIMatrixTabs.tsx†L20-L234】

## 3. 推奨計画生成ロジック
- `/api/transfer-plans/recommend` は指定条件の PSI 行列を再集計し、倉庫ごとのメインチャネルと再配置ポリシーを取得した上でアルゴリズムを実行します。【F:backend/app/routers/transfer_plans.py†L136-L199】
- `recommend_plan_lines` は SKU 単位で不足セル（メインチャネル Gap<0）を抽出し、次の順序で移動候補を作成します。【F:backend/app/services/transfer_logic.py†L130-L239】
  1. 同一倉庫内の非メインチャネル余剰から補填（intra）。
  2. 他倉庫の非メインチャネル余剰から補填（inter_nonmain）。
  3. ポリシーが許可する場合、他倉庫メインチャネルからも補填（inter_main）。
- 補填量は `rounding_mode` 設定に従って 1 個単位へ丸められ、`allow_overfill` が false の場合は受け側の標準在庫超過をブロックします。【F:backend/app/services/transfer_logic.py†L210-L266】
- 公平分配モード（`fair_share_mode` ≠ `off`）では、SKU ごとに不足セルへ余剰を比率配分する専用ルーチン `_recommend_fair_share` が呼び出されます。【F:backend/app/services/transfer_logic.py†L276-L360】

## 4. API エンドポイント
- `GET /api/transfer-plans`：条件に合致する計画一覧を返却。クエリはセッションや期間でフィルタできます。【F:backend/app/routers/transfer_plans.py†L30-L118】
- `POST /api/transfer-plans/recommend`：指定セッション・期間（＋任意 SKU/倉庫/チャネル）から推奨ドラフトを生成し、計画ヘッダーと行を新規保存します。【F:backend/app/routers/transfer_plans.py†L136-L199】
- `GET /api/transfer-plans/{plan_id}`：計画詳細を取得し、フロント側でドラフト行へ変換します。【F:backend/app/routers/transfer_plans.py†L200-L238】【F:frontend/src/pages/ReallocationPage.tsx†L372-L455】
- `PUT /api/transfer-plans/{plan_id}/lines`：計画行を全件置換。出庫数量が在庫起点を超えると 422 エラーを返します。【F:backend/app/routers/transfer_plans.py†L200-L282】

## 5. フロントエンド連携
- フィルタフォームではセッション・期間を指定し、「Create recommendation」「Load plan」「Refresh list」などの操作でドラフト生成・既存計画読込を行います。【F:frontend/src/pages/ReallocationPage.tsx†L706-L792】
- 計画行テーブルでは SKU・倉庫・チャネル・数量・理由を編集でき、保存時に未入力や数量不正をバリデーションします。【F:frontend/src/pages/ReallocationPage.tsx†L260-L360】【F:frontend/src/pages/ReallocationPage.tsx†L792-L936】
- 行一覧は CSV 形式でダウンロードでき、出力には計画 ID や手動編集フラグが含まれます。【F:frontend/src/pages/ReallocationPage.tsx†L540-L620】【F:frontend/src/pages/ReallocationPage.tsx†L792-L906】

## 6. マスタとグローバルパラメータ
- 倉庫マスタ `warehouse_master` の `main_channel` 列はメインチャネル優先順位を決める根拠となり、推奨生成時に `fetch_main_channel_map` で参照されます。【F:backend/app/models.py†L170-L207】【F:backend/app/services/transfer_plans.py†L200-L214】
- チャネル一覧は `channel_master` に保持され、倉庫マスタの外部参照先になります。【F:backend/app/models.py†L162-L175】
- 再配置ポリシー `reallocation_policy` は以下の 4 つの制御フラグを持ち、推奨アルゴリズム全体の振る舞いを切り替えます。【F:backend/app/models.py†L208-L236】【F:backend/app/services/reallocation_policy.py†L12-L64】
  - `take_from_other_main`：他倉庫メインチャネルからの移動を許可。
  - `rounding_mode`：数量丸め方法（floor/round/ceil）。
  - `allow_overfill`：標準在庫超過を許容。
  - `fair_share_mode`：公平分配モード（off/equalize_ratio_closing/equalize_ratio_start）。
- ポリシー API は `GET /api/reallocation-policy` で取得、`PUT /api/reallocation-policy` で更新します。更新時は管理者認証が必須です。【F:backend/app/routers/reallocation_policy.py†L20-L55】

## 7. バリデーションと制約
- 保存 API は `from` = `to`、`line_id` 重複、`plan_id` 不一致を拒否し、出庫合計が `stock_at_anchor` を超える場合は 422 エラーになります。【F:backend/app/routers/transfer_plans.py†L214-L282】
- 推奨生成時は期間の前後関係やセッション存在確認を行い、不正なリクエストを 400/404 エラーで防ぎます。【F:backend/app/routers/transfer_plans.py†L136-L170】
- アルゴリズム内では不足が解消できなかった理由（donor 不足、丸め、オーバーフィル禁止など）をログ出力し、調査時に根拠を追跡できるようにしています。【F:backend/app/services/transfer_logic.py†L200-L273】
