# データベーススキーマ（`psi`）仕様

**目的**: ERP の MVP と近い将来の拡張に必要な **PostgreSQL DDL** 一式です。スキーマは **`psi` 固定**。基本的に **冪等**（複数回流しても安全）になるように書いています。

> 実行方法の推奨: 1つのセッション（`psql` 等）で **上から順に**そのまま実行してください。既に存在するオブジェクトがあっても `IF NOT EXISTS` や安全なチェックで整合します。

---

## 0) 前提セットアップ

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid() 用
CREATE SCHEMA IF NOT EXISTS psi;
SET search_path TO psi, public;               -- 以降は psi をデフォルトに
```

### 共通: `updated_at` を自動更新するトリガ関数

```sql
CREATE OR REPLACE FUNCTION psi._touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
```

---

## 1) コア（MVP 必須）

### 1.1 セッション: `psi.sessions`

```sql
CREATE TABLE IF NOT EXISTS psi.sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  description text,
  is_leader   boolean NOT NULL DEFAULT FALSE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Leader は常に 1 件（TRUE が一意）
CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_single_leader
  ON psi.sessions (is_leader) WHERE is_leader = TRUE;

-- 既存トリガーがあれば削除（存在チェック付き）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE t.tgname = 'sessions_touch_updated_at' AND n.nspname = 'psi'
  ) THEN
    EXECUTE 'DROP TRIGGER sessions_touch_updated_at ON psi.sessions';
  END IF;
END $$;

-- updated_at 自動更新
CREATE TRIGGER sessions_touch_updated_at
BEFORE UPDATE ON psi.sessions
FOR EACH ROW EXECUTE FUNCTION psi._touch_updated_at();
```

### 1.2 PSI 基礎データ（CSV 取り込み先）: `psi.psi_base`

```sql
CREATE TABLE IF NOT EXISTS psi.psi_base (
  id              bigserial PRIMARY KEY,
  session_id      uuid NOT NULL REFERENCES psi.sessions(id) ON DELETE CASCADE,
  sku_code        text NOT NULL,
  sku_name        text,
  warehouse_name  text NOT NULL,
  channel         text NOT NULL,
  date            date NOT NULL,
  stock_at_anchor numeric(20,6),
  inbound_qty     numeric(20,6),
  outbound_qty    numeric(20,6),
  net_flow        numeric(20,6),
  stock_closing   numeric(20,6),
  safety_stock    numeric(20,6),
  movable_stock   numeric(20,6),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 重複防止（セッション×SKU×倉庫×チャネル×日）
CREATE UNIQUE INDEX IF NOT EXISTS uq_psibase_key
  ON psi.psi_base (session_id, sku_code, warehouse_name, channel, date);

-- 検索高速化
CREATE INDEX IF NOT EXISTS idx_psibase_lookup
  ON psi.psi_base (session_id, sku_code, warehouse_name, channel, date);
```

### 1.3 PSI 手修正（UI 上書き）: `psi.psi_edits`

```sql
CREATE TABLE IF NOT EXISTS psi.psi_edits (
  id             bigserial PRIMARY KEY,
  session_id     uuid NOT NULL REFERENCES psi.sessions(id) ON DELETE CASCADE,
  sku_code       text NOT NULL,
  warehouse_name text NOT NULL,
  channel        text NOT NULL,
  date           date NOT NULL,
  inbound_qty    numeric(20,6),
  outbound_qty   numeric(20,6),
  safety_stock   numeric(20,6),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_psiedits_key
  ON psi.psi_edits (session_id, sku_code, warehouse_name, channel, date);

-- 既存トリガーがあれば削除（存在チェック付き）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE t.tgname = 'psi_edits_touch_updated_at' AND n.nspname = 'psi'
  ) THEN
    EXECUTE 'DROP TRIGGER psi_edits_touch_updated_at ON psi.psi_edits';
  END IF;
END $$;

CREATE TRIGGER psi_edits_touch_updated_at
BEFORE UPDATE ON psi.psi_edits
FOR EACH ROW EXECUTE FUNCTION psi._touch_updated_at();
```

---

## 2) 推奨（あとで効く拡張）

### 2.1 マスタ類

```sql
CREATE TABLE IF NOT EXISTS psi.sku_master (
  sku_code text PRIMARY KEY,
  sku_name text NOT NULL,
  category_1 text,
  category_2 text,
  category_3 text,
  style_color text,
  suggested_retail_price numeric(20,6),
  cost_price numeric(20,6)
);

CREATE TABLE IF NOT EXISTS psi.warehouse_master (
  warehouse_name text PRIMARY KEY,
  region text
);

CREATE TABLE IF NOT EXISTS psi.channel_master (
  channel text PRIMARY KEY,
  display_name text
);
```

### 2.2 画面に出す指標の定義

```sql
CREATE TABLE IF NOT EXISTS psi.psi_metrics_master (
  name text PRIMARY KEY,
  is_editable boolean NOT NULL DEFAULT FALSE,
  display_order int NOT NULL
);

INSERT INTO psi.psi_metrics_master(name, is_editable, display_order) VALUES
  ('stock_at_anchor', FALSE, 1),
  ('inbound_qty',     TRUE,  2),
  ('outbound_qty',    TRUE,  3),
  ('net_flow',        FALSE, 4),
  ('stock_closing',   FALSE, 5),
  ('safety_stock',    TRUE,  6),
  ('movable_stock',   FALSE, 7)
ON CONFLICT (name) DO NOTHING;
```

### 2.3 在庫移動（倉庫間・チャネル変更などの将来運用）

```sql
CREATE TABLE IF NOT EXISTS psi.stock_transfers (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES psi.sessions(id) ON DELETE CASCADE,
  sku_code text NOT NULL,
  from_warehouse text,
  to_warehouse text,
  channel text,
  qty numeric(20,6) NOT NULL,
  transfer_date date NOT NULL,
  note text
);
CREATE INDEX IF NOT EXISTS idx_transfers_key
  ON psi.stock_transfers (session_id, sku_code, transfer_date);
```

```sql
CREATE TABLE IF NOT EXISTS psi.channel_transfers (
  session_id uuid NOT NULL REFERENCES psi.sessions(id) ON DELETE CASCADE,
  sku_code text NOT NULL,
  warehouse_name text NOT NULL,
  transfer_date date NOT NULL,
  from_channel text NOT NULL,
  to_channel text NOT NULL,
  qty numeric(20,6) NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, sku_code, warehouse_name, transfer_date, from_channel, to_channel),
  UNIQUE (session_id, sku_code, warehouse_name, transfer_date, from_channel, to_channel)
);
```

### 2.4 需要計画（日別）

```sql
CREATE TABLE IF NOT EXISTS psi.demand_plan_daily (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES psi.sessions(id) ON DELETE CASCADE,
  sku_code text NOT NULL,
  warehouse_name text NOT NULL,
  channel text NOT NULL,
  date date NOT NULL,
  forecast_qty numeric(20,6) NOT NULL,
  UNIQUE (session_id, sku_code, warehouse_name, channel, date)
);
```

### 2.5 編集ログ（だれが・なにを・いつ）

```sql
CREATE TABLE IF NOT EXISTS psi.psi_edit_log (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL,
  sku_code text NOT NULL,
  warehouse_name text NOT NULL,
  channel text NOT NULL,
  date date NOT NULL,
  field text NOT NULL,              -- inbound_qty / outbound_qty / safety_stock
  old_value numeric(20,6),
  new_value numeric(20,6),
  edited_at timestamptz NOT NULL DEFAULT now(),
  edited_by text
);
CREATE INDEX IF NOT EXISTS idx_editlog
  ON psi.psi_edit_log (session_id, sku_code, warehouse_name, channel, date, edited_at DESC);
```

### 2.6 セッション別パラメータ

```sql
CREATE TABLE IF NOT EXISTS psi.session_params (
  session_id uuid NOT NULL REFERENCES psi.sessions(id) ON DELETE CASCADE,
  key text NOT NULL,
  value text NOT NULL,
  PRIMARY KEY(session_id, key)
);
```

### 2.7 日別キャッシュ（将来のパフォーマンス改善用）

```sql
CREATE TABLE IF NOT EXISTS psi.psi_daily_cache (
  session_id uuid NOT NULL REFERENCES psi.sessions(id) ON DELETE CASCADE,
  sku_code text NOT NULL,
  warehouse_name text NOT NULL,
  channel text NOT NULL,
  date date NOT NULL,
  stock_at_anchor numeric(20,6),
  inbound_qty    numeric(20,6),
  outbound_qty   numeric(20,6),
  net_flow       numeric(20,6),
  stock_closing  numeric(20,6),
  safety_stock   numeric(20,6),
  movable_stock  numeric(20,6),
  last_refreshed timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(session_id, sku_code, warehouse_name, channel, date)
);
```

---

## 3) 既存 `public.sessions` からの移行（必要な場合）

```sql
-- public.sessions が既にあり、id が UUID（または UUID 文字列）である場合の例
INSERT INTO psi.sessions (id, title, description, is_leader, created_at, updated_at)
SELECT id::uuid, title, description, is_leader, created_at, updated_at
FROM public.sessions
ON CONFLICT (id) DO NOTHING;
```

---

## 4) 動作確認スニペット（クイックテスト）

```sql
-- 存在確認
SELECT to_regclass('psi.sessions')   AS sessions;
SELECT to_regclass('psi.psi_base')   AS psi_base;
SELECT to_regclass('psi.psi_edits')  AS psi_edits;

-- セッション 1 件作成
INSERT INTO psi.sessions (title, description) VALUES ('MVP Session', 'first try') RETURNING *;

-- 重複キー挿入テスト（psi_base）
INSERT INTO psi.psi_base (session_id, sku_code, warehouse_name, channel, date, stock_at_anchor, inbound_qty, outbound_qty, safety_stock)
VALUES (
  (SELECT id FROM psi.sessions ORDER BY created_at DESC LIMIT 1),
  '25SSBA001','MainWH','online','2025-09-20',8584,0,8,15
) ON CONFLICT DO NOTHING;

-- 取得例
SELECT * FROM psi.sessions ORDER BY created_at DESC;
SELECT * FROM psi.psi_base ORDER BY date ASC LIMIT 5;
```

---

## 5) メモ

* アプリ側の `.env` は `DB_SCHEMA=psi` を設定。
* Alembic を使う場合、`alembic/env.py` で `SET search_path TO {settings.db_schema}, public` を実行する構成であれば、この DDL と整合します。
* 既に `public` に同名テーブルがある場合は、`search_path` や明示スキーマ指定（`psi.`）の混在に注意してください。
