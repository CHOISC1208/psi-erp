# 倉庫移動（チャネル振替）機能仕様

## 機能の説明
- 倉庫内で販売チャネル間の在庫を付け替える計画を記録し、PSI日次集計でチャネル間移動量（channel_move）として加味します。【F:backend/app/routers/psi.py†L360-L506】
- フロントエンドでは、各SKU×倉庫×チャネルの日次行からモーダルを開き、既存の移動レコードの確認・追加・削除と、移動差分のプレビューを行います。【F:frontend/src/components/ChannelMoveModal.tsx†L7-L178】
- 登録済みレコードはAPI経由で取得・編集でき、CSVとしてエクスポートして計画共有に活用できます。【F:backend/app/routers/channel_transfers.py†L50-L217】

## 仕様
### API エンドポイント
- `GET /channel-transfers/`：セッションID、SKU、倉庫名、期間などでフィルタした移動レコード一覧を返します。日付順→SKU→倉庫→from/toチャネルの順にソートします。【F:backend/app/routers/channel_transfers.py†L50-L95】
- `GET /channel-transfers/{session_id}/export`：フィルタ条件付きで対象セッションのレコードをCSVストリームとしてダウンロードします（ヘッダー含む）。【F:backend/app/routers/channel_transfers.py†L136-L217】
- `POST /channel-transfers/`：新規レコードを登録します。対象セッションの存在確認と、from/toチャネルの一致禁止、重複キー時の409エラー処理を行います。【F:backend/app/routers/channel_transfers.py†L220-L246】
- `PUT /channel-transfers/{複合キー}`：既存レコードを更新します。from/toチャネルが同一になる更新は拒否し、重複キー競合時は409を返します。【F:backend/app/routers/channel_transfers.py†L249-L304】
- `DELETE /channel-transfers/{複合キー}`：指定レコードを削除します。【F:backend/app/routers/channel_transfers.py†L307-L336】

### バリデーションとUI要件
- モーダルで作成するドラフトは、数量が正の数値であること・相手チャネルが未入力でないこと・同一チャネル指定でないことをリアルタイム検証します。保存ボタンは未検証・未変更・API処理中などの場合に無効化されます。【F:frontend/src/components/ChannelMoveModal.tsx†L103-L179】
- API層ではfrom/toチャネルの一致を禁止し、セッション未存在や重複キーをHTTPエラーとして通知します。【F:backend/app/routers/channel_transfers.py†L229-L304】
- テーブル未作成環境でも操作できるよう、API呼び出し時に`channel_transfers`テーブルをチェックし必要に応じて作成します。【F:backend/app/routers/channel_transfers.py†L21-L27】

### PSI 集計への反映
- PSI集計APIは`channel_transfers`を入出庫別に集計し、チャネルごとの純移動量を算出してPSIの移動列に反映します。未登録時はゼロとして扱われます。【F:backend/app/routers/psi.py†L380-L520】

## 関連データベース
- `psi.channel_transfers`テーブルはセッションID・SKU・倉庫・日付・from/toチャネルを複合主キーに持ち、数量と任意メモ、作成・更新日時を保持します。【F:docs/database.md†L203-L216】
- ORMモデル`ChannelTransfer`はPydanticスキーマと連携し、同テーブルをタイムスタンプ付きで表現します。【F:backend/app/models.py†L188-L222】【F:backend/app/schemas.py†L152-L178】
- PSI集計では`channel_transfers`を`psi_base`/`psi_edits`と結合してチャネル別移動量を計算します（`channel_move`列）。【F:backend/app/routers/psi.py†L380-L506】
