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
- `stock_at_anchor`
- `inbound_qty`
- `outbound_qty`
- `net_flow`
- `stock_closing`
- `safety_stock`
- `movable_stock`

ヘッダー名は大文字小文字・スペースの違いを無視して突き合わせます。

任意列:

- `sku_name`

## データフォーマット

- `date`: `YYYY-MM-DD` もしくは `YYYY/MM/DD`
- 数値列: 空欄は `NULL` として扱われます。それ以外は 10 進数として解釈されます。
- 空行はスキップされます。

## エラー応答

- 文字コード判定に失敗した場合: HTTP 400 `{ "detail": "Invalid encoding" }`
- 必須列不足・データ形式不正など: 従来通り HTTP 400/422 が返されます。
