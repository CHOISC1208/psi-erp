# カラーパレットガイド

PSI ERP フロントエンドで利用しているカラーパレットの概要と、主なセマンティックトークンの用途をまとめています。スタイルは `frontend/src/styles/palette.css` で定義され、CSS カスタムプロパティとして利用できます。

## ベースパレット

ベースパレットは夜間のダッシュボードを意識したダークトーンを中心に構成されています。

| グループ | 変数例 | 色 | 説明 |
| --- | --- | --- | --- |
| Midnight | `--palette-midnight-1000` 〜 `-825` | #0b1220 など | アプリ全体の背景やパネルの濃い層に使う最も暗いグラデーション |
| Slate | `--palette-slate-900` 〜 `-100` | #1f2937 など | パネルのバリエーションやボーダー、テキストに使うニュートラルグレイ |
| Ice & Rose | `--palette-ice-100`, `--palette-rose-50` | #f3f8ff / #fff5f5 | 情報・警告などのハイライト背景用の淡い色 |
| White | `--palette-white` | #ffffff | 反転背景やテキストのハイコントラスト用途 |
| Blue/Sky/Teal | `--palette-blue-*`, `--palette-sky-*`, `--palette-teal-600` | #3b82f6 など | 主ボタンやリンク、通知などのアクセントカラー |
| Green/Amber/Red | `--palette-green-500` など | #22c55e など | 成功・注意・エラーのステータスを示すシグナルカラー |

## セマンティックトークン

### サーフェス

| トークン | 用途 |
| --- | --- |
| `--surface-body` | ページ全体の背景色 |
| `--surface-panel`, `--surface-panel-*` | パネルやカードの背景。`-strong`/`-soft` でコントラストを調整 |
| `--surface-table*` | テーブル背景、ヘッダー、交互行の色分け |
| `--surface-input` | 入力欄の背景 |
| `--surface-sidebar-hover` | サイドバーのホバー状態 |
| `--surface-info`, `--surface-warning` | 情報・警告系の通知背景 |

### ボーダー

| トークン | 用途 |
| --- | --- |
| `--border-default` | ベースとなるボーダー色 |
| `--border-subtle`, `--border-muted`, `--border-soft` | それぞれ強度の異なる仕切り線 |
| `--border-focus` | フォーカスリングの強調色 |
| `--border-highlight` | 強調したい要素の縁取り |

### テキスト

| トークン | 用途 |
| --- | --- |
| `--text-primary`, `--text-high` | メインテキスト、強調テキスト |
| `--text-secondary`, `--text-muted` | 補足テキストや説明文 |
| `--text-contrast` | ダーク背景上でのコントラスト確保 |
| `--text-on-panel`, `--text-on-light`, `--text-on-bright` | 特定の背景上で読みやすさを保つためのテキスト色 |
| `--text-info`, `--text-warning` | 情報・警告ラベル用のテキスト色 |

### アクセントとコンポーネント

| トークン | 用途 |
| --- | --- |
| `--accent-*` | ボタン、リンク、バッジなどで使うブランドアクセント |
| `--button-*` | ボタンの背景色とホバー時の色、文字色 |
| `--badge-*` | バッジ背景と文字色 |
| `--card-*` | カード背景と補助テキスト |
| `--layout-page-background` | レイアウト全体の背景（ライトエリアなど） |

## 利用方法

React コンポーネントや CSS モジュールでカスタムプロパティを参照することで、テーマに沿った配色を簡単に適用できます。

```css
.my-panel {
  background-color: var(--surface-panel);
  color: var(--text-on-panel);
  border: 1px solid var(--border-subtle);
}
```

ベースパレットの値を直接変更するのではなく、セマンティックトークンを通じて利用することで、テーマの一貫性を保ちながら配色を調整できます。
