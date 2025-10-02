# 在庫再配置ロジック現状把握と仕様整理

## A. 現状把握レポート

### 1. Gap・Gap After と PSI 指標の算出

- **バックエンド集計**：`fetch_matrix_rows` が PSI 行を生成し、`gap = stock_at_anchor - stdstock`、`stock_fin = stock_closing + move` を計算。【F:backend/app/services/transfer_plans.py†L175-L199】
- **フロント合成**：再配置画面ではサーバー返却行とローカルドラフトの差分を `move = baseMove - savedMove + draftMove` で再構成し、`stock_fin = stock_closing + move` を再計算する。【F:frontend/src/pages/ReallocationPage.tsx†L489-L534】
- **Gap 値の利用**：シミュレート行の `gap` は `stdstock - stock_closing`（=期末基準）で一時的に再計算されるため、サーバー値（期首基準）と符号規約が乖離している。【F:frontend/src/pages/ReallocationPage.tsx†L489-L534】
- **PSI 行へのマッピング**：UI へ渡す直前に `gap = stockStart - stdStock`、`gapAfter = stockStart + move - stdStock` を求め、`Gap After = Gap + Move` が成り立つ実装。ただし Gap 自体が `Std - Start` ではなく `Start - Std` になっている。【F:frontend/src/pages/ReallocationPage.tsx†L665-L689】
- **KPI/ビューの参照**：`PSIMatrixTabs` 系コンポーネントは `METRIC_DEFINITIONS` の順序（Start → Inbound → Outbound → Closing → Move → Final → Std → Gap → Gap After）を共通利用し、`getMetricValue` も `Gap = stockStart - stdStock`、`Gap After = stockStart + move - stdStock` を返却する。【F:frontend/src/features/reallocation/psi/utils.ts†L1-L72】

> **Gap・Gap After の符号まとめ**
>
> | 状態 | 望ましい定義 | 現実装の振る舞い |
> | --- | --- | --- |
> | Gap | `Std - Stock @ Start`（不足で正） | `Stock @ Start - Std`（不足で負）
> | Gap After | `Gap + Move` | `Gap + Move`（ただし Gap の符号が逆転）
>
> ダミーデータ（Std=4.55, Stock@Start=4, Move=1）でのトレース：望ましい仕様では `Gap=+0.55`, `GapAfter=+1.55`; 現実装は `Gap=-0.55`, `GapAfter=+0.45`。

### 2. ドラフト合成・クエリキー・再フェッチ

- **ラインロード/保存**：プラン読込時は API 応答をドラフト化し、`lines` と `baselineLines` を同期。保存後は全行差し替え→成功時にローカル状態を保存結果でリセットし、マトリクスとプラン一覧を再フェッチして乖離を解消。【F:frontend/src/pages/ReallocationPage.tsx†L332-L361】【F:frontend/src/pages/ReallocationPage.tsx†L350-L364】
- **移動量マージ**：サーバー保存済み Move とローカルドラフトを `buildMoveMap` で SKU×倉庫×チャネルごとに集約し、保存前の下書き差分を PSI 行に反映。【F:frontend/src/pages/ReallocationPage.tsx†L476-L534】
- **React Query キー**：PSI 行列は `["psi-matrix", sessionId, start, end, planId, skuListSignature]` をキーにし、セッション・期間・プラン単位でキャッシュされる。プラン保存・推奨生成後に再フェッチを明示している。【F:frontend/src/hooks/useTransferPlans.ts†L34-L70】【F:frontend/src/pages/ReallocationPage.tsx†L344-L364】

### 3. 推奨ロジック（transfer_logic）

- **フロー**：SKU 単位でチャネルセルを `_CellState` に変換し、各倉庫のメインチャネル不足（Gap < 0）を優先度順に処理。まず倉庫内（intra）余剰 `available_surplus` から充当し、残不足があれば倉庫間（inter）余剰を探索。【F:backend/app/services/transfer_logic.py†L75-L181】
- **丸めと制約**：Move 数量は `Decimal.quantize(1, ROUND_HALF_UP)` で 1 個単位に丸め、`available_surplus` が `stock_at_anchor` を下回らないよう在庫残を確認。【F:backend/app/services/transfer_logic.py†L61-L133】
- **バリデーション**：保存 API は `from == to`、`line_id` 重複、`plan_id` 不一致を拒否し、`stock_at_anchor` を超える出庫をエラーとする（安全在庫相当）。【F:backend/app/routers/transfer_plans.py†L214-L253】
- **タイブレーク**：現行 inter 選定は「余剰量の多い順」単一基準のみで、チャネル種別・倉庫規模・安定ソートは未実装。【F:backend/app/services/transfer_logic.py†L148-L179】

## B. 決定木ロジック仕様（Gap = Std − Stock @ Start 前提）

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
- **Gap After**：各セルで `GapAfter = (Std − Stock@Start) + MoveNet`。Move は入庫なら正、出庫なら負として Gap に加算する（UI 再計算も同式を明記）。【F:frontend/src/pages/ReallocationPage.tsx†L665-L689】
- **在庫下限**：`available_surplus` 判定で `stock_at_anchor - allocated_out` を超過しないことを保証。必要に応じて別安全在庫しきい値を掛けられる旨を注記。【F:backend/app/services/transfer_logic.py†L61-L73】

## C. 不整合と改善提案

1. **Gap 基準の混在是正**
   - バックエンドとフロント双方で `Gap = Std − Stock @ Start` へ符号統一。`fetch_matrix_rows` と UI マッピング、`getMetricValue` の式を修正し、`Gap` を参照する KPI の符号も揃える。
   - `simulatedMatrixRows` で `gap` を `stdstock - stock_closing` に再計算している箇所を削除し、サーバー算出値（期首基準）をそのまま保持すると整合が取れる。

2. **UI 明示**
   - KPI カード・ツールチップに「Gap は Std vs Stock @ Start（期首基準）」と記載することで利用者に基準点を提示。

3. **インタードナーのソート強化**
   - 決定木ストーリーに沿い、`donors_inter.sort` にチャネル優先度・倉庫合計在庫・安定キーを組み合わせる（`tuple` ソートで実装可能）。

4. **大規模 SKU 対応**
   - React Query キーに SKU フィルタ署名を含めているため、SKU 単位のタブ切替時にキャッシュヒットする。さらに検索／倉庫フィルタを API パラメータに昇格させれば不要な全件再計算を抑制可能。【F:frontend/src/hooks/useTransferPlans.ts†L34-L70】

---

### 参考：ダミーデータのトレース

| SKU/倉庫/チャネル | Std | Stock@Start | Move | Gap (=Std−Start) | GapAfter (=Gap+Move) |
| --- | --- | --- | --- | --- | --- |
| 住商GL online retail | 4.55 | 4 | +1 | +0.55 | +1.55 |
| 名鉄運輸 online wholesale | 24.57 | 27 | −1 | −2.43 | −3.43 |

Gap の符号が意図通り（不足で正）になること、GapAfter が Move を加味した差分であることを確認できる。
