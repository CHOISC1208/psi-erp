# 在庫再配置ロジック現状把握と仕様整理

## A. 現状把握レポート

### 1. Gap・Gap After と PSI 指標の算出

- **バックエンド入力**：`fetch_matrix_rows` は `stock_at_anchor`（期首在庫）、`inbound_qty`、`outbound_qty`、`stdstock`、`move` を返却するが、`stock_closing` はそのままでは不足分を表せない値（0 あるいは未設定）で送られてくるケースがある。【F:backend/app/services/transfer_plans.py†L175-L199】
- **フロント合成**：再配置画面では Transfer Plan Lines の集計から `move` を算出し、`stock_closing = stock_at_anchor + inbound_qty - outbound_qty`、`stock_fin = stock_closing + move` を導出する。【F:frontend/src/pages/ReallocationPage.tsx†L802-L858】
- **Gap 値の利用**：`gap` は `stock_fin - stdstock`、`gap_after = gap + move` を保持し、在庫差を最終値基準で把握する。【F:frontend/src/pages/ReallocationPage.tsx†L820-L846】
- **PSI 行へのマッピング**：UI に渡す段階でも同じ式で `stockClosing`、`stockFinal`、`gap`、`gapAfter` を再計算してから `PSIMatrixTabs` に供給する。【F:frontend/src/pages/ReallocationPage.tsx†L1042-L1072】
- **KPI/ビューの参照**：`getMetricValue` も `Gap = Stock Final − Std Stock`、`Gap After = Gap + Move` を返すため、カード・表・ヒートマップで基準が統一される。【F:frontend/src/features/reallocation/psi/utils.ts†L56-L85】

### 2. ドラフト合成・クエリキー・再フェッチ

- **ラインロード/保存**：プラン読込時は API 応答をドラフト化し、`lines` と `baselineLines` を同期。保存後は全行差し替え→成功時にローカル状態を保存結果でリセットし、マトリクスとプラン一覧を再フェッチして乖離を解消。【F:frontend/src/pages/ReallocationPage.tsx†L332-L361】【F:frontend/src/pages/ReallocationPage.tsx†L350-L364】
- **移動量マージ**：サーバー保存済み Move とローカルドラフトを `buildMoveMap` で SKU×倉庫×チャネルごとに集約し、保存前の下書き差分を PSI 行に反映。【F:frontend/src/pages/ReallocationPage.tsx†L476-L534】
- **React Query キー**：PSI 行列は `["psi-matrix", sessionId, start, end, planId, skuListSignature]` をキーにし、セッション・期間・プラン単位でキャッシュされる。プラン保存・推奨生成後に再フェッチを明示している。【F:frontend/src/hooks/useTransferPlans.ts†L34-L70】【F:frontend/src/pages/ReallocationPage.tsx†L344-L364】

### 3. 推奨ロジック（transfer_logic）

- **フロー**：SKU 単位でチャネルセルを `_CellState` に変換し、各倉庫のメインチャネル不足（Gap < 0）を優先度順に処理。まず倉庫内（intra）余剰 `available_surplus` から充当し、残不足があれば倉庫間（inter）余剰を探索。【F:backend/app/services/transfer_logic.py†L75-L181】
- **丸めと制約**：Move 数量は `Decimal.quantize(1, ROUND_HALF_UP)` で 1 個単位に丸め、`available_surplus` が `stock_at_anchor` を下回らないよう在庫残を確認。【F:backend/app/services/transfer_logic.py†L61-L133】
- **バリデーション**：保存 API は `from == to`、`line_id` 重複、`plan_id` 不一致を拒否し、`stock_at_anchor` を超える出庫をエラーとする（安全在庫相当）。【F:backend/app/routers/transfer_plans.py†L214-L253】
- **タイブレーク**：現行 inter 選定は「余剰量の多い順」単一基準のみで、チャネル種別・倉庫規模・安定ソートは未実装。【F:backend/app/services/transfer_logic.py†L148-L179】

## B. 決定木ロジック仕様（Gap = Stock Final − Std 前提）

### 1. フローチャート（簡易）

```
不足セル? (Gap > 0)
├─ いいえ → Move 0
└─ はい
   ├─ 倉庫内余剰あり? (Gap < 0 他チャネル)
   │   └─ Donor 候補を ①余剰量降順 → ②メインチャネル以外優先 → ③倉庫総在庫降順 → ④倉庫ID昇順 で整列
   │       └─ 可能量だけ 1個単位で Move, GapAfter 更新
   └─ なお不足? → 倉庫間へ
        └─ Donor 候補を同じ ①〜④ ルールで整列し、在庫下限を尊重しながら Move
```

### 2. 擬似コード（≤20 行）

```
for each sku:
  shortages = cells where channel == main && gap > 0 sorted by gap desc
  donors = build donor list with movable_stock = max(0, min(gap_surplus, stock_at_start - allocated))
  for shortage in shortages:
    for scope in [intra, inter]:
      candidates = donors filtered by same warehouse if intra else others
      sort candidates by (-movable_stock,
                          is_main_channel,      # False < True
                          -warehouse_total_stock,
                          warehouse_id,
                          channel)
      for donor in candidates while shortage.remaining > 0:
        qty = clamp_to_unit(min(donor.movable_stock, shortage.remaining))
        if qty <= 0: continue
        register_move(donor -> shortage, qty)
        donor.allocate(qty); shortage.remaining -= qty
```

### 3. 出力と算定式

- **Move 行形式**：`{ sku, from_warehouse, from_channel, to_warehouse, to_channel, qty, reason }`（現行 API と互換）。【F:backend/app/services/transfer_logic.py†L131-L177】
- **Gap After**：各セルで `GapAfter = (StockFinal − Std) + MoveNet`。Move は入庫なら正、出庫なら負として Gap に加算する（UI 再計算も同式を明記）。【F:frontend/src/pages/ReallocationPage.tsx†L1044-L1069】
- **在庫下限**：`available_surplus` 判定で `stock_at_anchor - allocated_out` を超過しないことを保証。必要に応じて別安全在庫しきい値を掛けられる旨を注記。【F:backend/app/services/transfer_logic.py†L61-L73】

## C. 不整合と改善提案

1. **Gap 基準の混在是正（対応済み）**
   - `Gap = Stock Final − Std` へ統一し、`simulatedMatrixRows`・`PSIMatrixTabs`・`getMetricValue` が同じ基準で再計算するよう修正済み。【F:frontend/src/pages/ReallocationPage.tsx†L802-L858】【F:frontend/src/pages/ReallocationPage.tsx†L1042-L1072】【F:frontend/src/features/reallocation/psi/utils.ts†L56-L85】

2. **UI 明示**
   - KPI カード・ツールチップに「Gap は Stock Final vs Std（期末基準）」と記載することで利用者に基準点を提示。

3. **インタードナーのソート強化**
   - 決定木ストーリーに沿い、`donors_inter.sort` にチャネル優先度・倉庫合計在庫・安定キーを組み合わせる（`tuple` ソートで実装可能）。

4. **大規模 SKU 対応**
   - React Query キーに SKU フィルタ署名を含めているため、SKU 単位のタブ切替時にキャッシュヒットする。さらに検索／倉庫フィルタを API パラメータに昇格させれば不要な全件再計算を抑制可能。【F:frontend/src/hooks/useTransferPlans.ts†L34-L70】

## D. データ受け渡しと UI 変換フロー

1. **API 応答（MatrixRow）**：`/api/psi/matrix` は SKU × 倉庫 × チャネル行を返し、`stock_at_anchor`（期首在庫）、`inbound_qty`、`outbound_qty`、`stdstock`、`move` などの基礎数値を含む。`stock_closing` は未設定でもよく、フロントで派生させる。【F:frontend/src/types.ts†L116-L132】
2. **移動量の合成**：保存済みプラン行とドラフト行を SKU × 倉庫 × チャネル軸でマージし、Transfer Plan Lines の合計として `move` を算出して `simulatedMatrixRows` を構築する。【F:frontend/src/pages/ReallocationPage.tsx†L802-L858】
3. **派生指標の算出**：各行で `stock_closing = stock_start + inbound - outbound`、`stock_fin = stock_closing + move`、`gap = stock_fin - stdstock`、`gap_after = gap + move` を再計算し、欠損を補完する。【F:frontend/src/pages/ReallocationPage.tsx†L820-L846】
4. **UI へのマッピング**：テーブル描画前に同じ式で `stockClosing` や `gapAfter` を埋め込み、`PSIMatrixTabs` と `getMetricValue` でも `Gap = Stock Final − Std` と `Gap After = Gap + Move` を共有する。【F:frontend/src/pages/ReallocationPage.tsx†L1042-L1072】【F:frontend/src/features/reallocation/psi/utils.ts†L56-L85】

---

### 参考：ダミーデータのトレース

| SKU/倉庫/チャネル | Std | Stock@Start | Move | Gap (=StockFinal−Std) | GapAfter (=Gap+Move) |
| --- | --- | --- | --- | --- | --- |
| 住商GL online retail | 4.55 | 4 | +1 | +0.45 | +1.45 |
| 名鉄運輸 online wholesale | 24.57 | 27 | −1 | −3.43 | −4.43 |

Gap の符号が意図通り（余剰で正、不足で負）になること、GapAfter が Move を加味した差分であることを確認できる。
