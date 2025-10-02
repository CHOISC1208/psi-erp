# 3.Upload

PSI 基礎データ取り込み API (`POST /psi/{session_id}/upload`) の入力ファイル仕様をまとめています。

## 文字エンコーディング

以下の優先順で自動判定されます。

1. `UTF-16`（BOM 有り/無し含む）
2. `UTF-8-SIG` / `UTF-8`
3. `CP932`

※ Tableau の *Unicode* 出力（実際は UTF-16LE TSV）や Excel の Shift_JIS (CP932) CSV もそのままアップロードできます。

## 区切り文字

先頭最大 200 行をスキャンし、タブ (`\t`)、カンマ (`,`)、セミコロン (`;`) の出現回数を比較して最頻値を採用します。すべて同数またはゼロの場合はカンマ区切りとして扱います。

- Tableau *Unicode*：タブ区切りが選択されます。
- 一般的な CSV：カンマ区切りが選択されます。

## ヘッダー行

1 行目にヘッダーを含めてください。以下の列が必須です。

- `sku_code`
- `warehouse_name`
- `channel`
- `date`
- `category_1`
- `category_2`
- `category_3`
- `fw_rank`
- `ss_rank`
- `stock_at_anchor`
- `inbound_qty`
- `outbound_qty`
- `net_flow`
- `stock_closing`
- `safety_stock`
- `movable_stock`
- `stdstock`
- `gap`

ヘッダー名は大文字小文字・スペースの違いを無視して突き合わせます。

任意列:

- `sku_name`

### 列一覧

| 列名 | 型 | 必須 | 用途 |
| --- | --- | --- | --- |
| `sku_code` | text | 必須 | SKU コード。セッション内で一意に識別します。 |
| `sku_name` | text | 任意 | SKU 名称。空欄の場合は未設定として扱われます。 |
| `category_1` | text | 必須 (空欄可) | カテゴリ第 1 階層。UI 表示とエクスポートで利用します。 |
| `category_2` | text | 必須 (空欄可) | カテゴリ第 2 階層。空欄は `NULL` として保存されます。 |
| `category_3` | text | 必須 (空欄可) | カテゴリ第 3 階層。空欄は `NULL` として保存されます。 |
| `fw_rank` | varchar(2) | 必須 (空欄可) | FW ランク。チャネルや SKU の優先度指標として UI／レポートで参照します。最大 2 文字までの英字を想定しています。 |
| `ss_rank` | varchar(2) | 必須 (空欄可) | Safety Stock ランク。安全在庫順序の把握に利用します。最大 2 文字までの英字を想定しています。 |
| `warehouse_name` | text | 必須 | 倉庫名称。 |
| `channel` | text | 必須 | 販売チャネル。 |
| `date` | date | 必須 | 計上日。`YYYY-MM-DD` または `YYYY/MM/DD`。 |
| `stock_at_anchor` | numeric | 必須 (空欄可) | 前日終値（起点在庫）。 |
| `inbound_qty` | numeric | 必須 (空欄可) | 入庫予定数量。 |
| `outbound_qty` | numeric | 必須 (空欄可) | 出庫予定数量。 |
| `net_flow` | numeric | 必須 (空欄可) | ネットフロー（入庫−出庫）。 |
| `stock_closing` | numeric | 必須 (空欄可) | 当日終値。 |
| `safety_stock` | numeric | 必須 (空欄可) | 安全在庫。 |
| `movable_stock` | numeric | 必須 (空欄可) | 可動在庫（終値−安全在庫）。 |
| `stdstock` | numeric | 必須 (空欄可) | 標準在庫。編集対象指標として `psi_metrics_master` に登録されます。 |
| `gap` | numeric | 必須 (空欄可) | 在庫ギャップなど派生指標。アップロード値をそのまま保存します。 |

## データフォーマット

- `date`: `YYYY-MM-DD` もしくは `YYYY/MM/DD`
- 数値列: 空欄は `NULL` として扱われます。それ以外は 10 進数として解釈されます。
- `fw_rank`, `ss_rank`: 空欄は `NULL`、それ以外は最大 2 文字の英字として検証され、英大文字に正規化されます。
- 空行はスキップされます。

## エラー応答

- 文字コード判定に失敗した場合: HTTP 400 `{ "detail": "Invalid encoding" }`
- 必須列不足・データ形式不正など: 従来通り HTTP 400/422 が返されます。
