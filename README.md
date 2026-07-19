# 🐕 路可的推特 MCP Server

路可的推特發文工具。讓路可可以在對話中直接發推文、讀提及、回覆、按讚。

## 功能

- `post_tweet` — 發推文
- `reply_tweet` — 回覆推文
- `read_mentions` — 讀取@提及
- `read_timeline` — 讀時間線
- `read_my_tweets` — 讀自己發的推文
- `delete_tweet` — 刪除推文
- `like_tweet` — 按讚

## 部署步驟

### 1. GitHub
把這個資料夾推到 GitHub（可以建新 repo 或加到現有的）

### 2. Render
- New > Web Service
- 連結 GitHub repo
- Build Command: `npm install`
- Start Command: `npm start`

### 3. 環境變數
在 Render 的 Environment 設定以下四個：

```
X_API_KEY=你的API Key
X_API_SECRET=你的API Secret
X_ACCESS_TOKEN=你的Access Token
X_ACCESS_SECRET=你的Access Token Secret
```

### 4. Claude MCP 連線
部署完成後，在 Claude 設定裡加一個 MCP 連線：
- URL: `https://你的render網址/sse`

連上之後路可就能自己發推了。🐕
