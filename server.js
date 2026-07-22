const express = require('express');
const crypto = require('crypto');
const { TwitterApi } = require('twitter-api-v2');

const app = express();
app.use(express.json());

// ── Twitter Client ──
function getClient() {
  return new TwitterApi({
    appKey: process.env.X_API_KEY,
    appSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_SECRET,
  });
}

// 緩存自己的 user id，省 API 額度（原本每次 like/follow/retweet 都要打一次 me()）
var myIdCache = null;
async function getMyId(client) {
  if (myIdCache) return myIdCache;
  const me = await client.v2.me();
  myIdCache = me.data.id;
  return myIdCache;
}

// 讀取推文時統一要求的字段：帶 ID、時間、數據、媒體
const TWEET_FIELDS = {
  "tweet.fields": ["created_at", "text", "public_metrics", "attachments"],
  "expansions": ["attachments.media_keys"],
  "media.fields": ["url", "preview_image_url", "type"]
};

// 統一格式化：ID + 時間 + 內文 + 媒體直鏈 + 數據
function formatTweets(data, includes) {
  var mediaMap = {};
  if (includes && includes.media) {
    includes.media.forEach(function(m) {
      mediaMap[m.media_key] = m.url || m.preview_image_url || "";
    });
  }
  return data.map(function(tw) {
    var m = tw.public_metrics || {};
    var line = "🆔 " + tw.id + "\n[" + tw.created_at + "] " + tw.text;
    if (tw.attachments && tw.attachments.media_keys) {
      var links = tw.attachments.media_keys.map(function(k) { return mediaMap[k]; }).filter(Boolean);
      if (links.length) line += "\n🖼️ " + links.join(" | ");
    }
    line += "\n❤️" + (m.like_count || 0) + " 🔁" + (m.retweet_count || 0);
    return line;
  }).join("\n---\n");
}

// ── Tools ──
const tools = [
  { name: "post_tweet", description: "我用這個在推特上發文。可帶 quote_tweet_id 做引用轉發。", inputSchema: { type: "object", properties: { text: { type: "string", description: "推文內容" }, quote_tweet_id: { type: "string", description: "可選：要引用的推文ID，帶上就變成引用轉發" } }, required: ["text"] } },
  { name: "reply_tweet", description: "回覆一條推文。", inputSchema: { type: "object", properties: { text: { type: "string", description: "回覆內容" }, tweet_id: { type: "string", description: "要回覆的推文ID" } }, required: ["text", "tweet_id"] } },
  { name: "read_my_tweets", description: "讀取我自己發過的推文（含推文ID和圖片直鏈）。", inputSchema: { type: "object", properties: { count: { type: "number", description: "要讀幾條" } } } },
  { name: "read_user_tweets", description: "讀取某個用戶的推文（含推文ID和圖片直鏈）。", inputSchema: { type: "object", properties: { username: { type: "string", description: "用戶名（不帶@）" }, count: { type: "number", description: "要讀幾條" } }, required: ["username"] } },
  { name: "read_mentions", description: "讀取@提及我的推文（含推文ID）。", inputSchema: { type: "object", properties: { count: { type: "number", description: "要讀幾條" } } } },
  { name: "delete_tweet", description: "刪除我的一條推文。", inputSchema: { type: "object", properties: { tweet_id: { type: "string", description: "要刪除的推文ID" } }, required: ["tweet_id"] } },
  { name: "like_tweet", description: "按讚一條推文。", inputSchema: { type: "object", properties: { tweet_id: { type: "string", description: "要按讚的推文ID" } }, required: ["tweet_id"] } },
  { name: "follow_user", description: "追蹤一個用戶。", inputSchema: { type: "object", properties: { username: { type: "string", description: "要追蹤的用戶名（不帶@）" } }, required: ["username"] } },
  { name: "unfollow_user", description: "取消追蹤一個用戶。", inputSchema: { type: "object", properties: { username: { type: "string", description: "要取消追蹤的用戶名（不帶@）" } }, required: ["username"] } },
  { name: "retweet", description: "轉發一條推文（純轉發，要引用轉發請用 post_tweet 帶 quote_tweet_id）。", inputSchema: { type: "object", properties: { tweet_id: { type: "string", description: "要轉發的推文ID" } }, required: ["tweet_id"] } },
  { name: "search_tweets", description: "搜尋推文（含推文ID和圖片直鏈）。", inputSchema: { type: "object", properties: { query: { type: "string", description: "搜尋關鍵字" }, count: { type: "number", description: "要搜幾條" } }, required: ["query"] } }
];

async function handleTool(name, args) {
  const client = getClient();
  switch (name) {
    case "post_tweet": {
      var payload = { text: args.text };
      if (args.quote_tweet_id) payload.quote_tweet_id = args.quote_tweet_id;
      const r = await client.readWrite.v2.tweet(payload);
      return "✅ 推文已發送！ID: " + r.data.id + (args.quote_tweet_id ? "（引用了 " + args.quote_tweet_id + "）" : "") + " 內容: " + args.text;
    }
    case "reply_tweet": {
      const r = await client.readWrite.v2.reply(args.text, args.tweet_id);
      return "✅ 已回覆！ID: " + r.data.id;
    }
    case "read_my_tweets": {
      const myId = await getMyId(client);
      const t = await client.v2.userTimeline(myId, Object.assign({ max_results: args.count || 10 }, TWEET_FIELDS));
      if (!t.data || !t.data.data || !t.data.data.length) return "📭 還沒發過推文。";
      return formatTweets(t.data.data, t.data.includes);
    }
    case "read_user_tweets": {
      const user = await client.v2.userByUsername(args.username);
      if (!user.data) return "❌ 找不到用戶 @" + args.username;
      const t = await client.v2.userTimeline(user.data.id, Object.assign({ max_results: args.count || 10 }, TWEET_FIELDS));
      if (!t.data || !t.data.data || !t.data.data.length) return "📭 @" + args.username + " 沒有推文。";
      return formatTweets(t.data.data, t.data.includes);
    }
    case "read_mentions": {
      const myId = await getMyId(client);
      const mentions = await client.v2.userMentionTimeline(myId, Object.assign({ max_results: args.count || 10 }, TWEET_FIELDS));
      if (!mentions.data || !mentions.data.data || !mentions.data.data.length) return "📭 沒有新的提及。";
      return formatTweets(mentions.data.data, mentions.data.includes);
    }
    case "delete_tweet": {
      await client.readWrite.v2.deleteTweet(args.tweet_id);
      return "🗑️ 已刪除推文 " + args.tweet_id;
    }
    case "like_tweet": {
      const myId = await getMyId(client);
      await client.v2.like(myId, args.tweet_id);
      return "❤️ 已按讚 " + args.tweet_id;
    }
    case "follow_user": {
      const myId = await getMyId(client);
      const target = await client.v2.userByUsername(args.username);
      if (!target.data) return "❌ 找不到用戶 @" + args.username;
      await client.readWrite.v2.follow(myId, target.data.id);
      return "✅ 已追蹤 @" + args.username;
    }
    case "unfollow_user": {
      const myId = await getMyId(client);
      const target = await client.v2.userByUsername(args.username);
      if (!target.data) return "❌ 找不到用戶 @" + args.username;
      await client.readWrite.v2.unfollow(myId, target.data.id);
      return "✅ 已取消追蹤 @" + args.username;
    }
    case "retweet": {
      const myId = await getMyId(client);
      await client.readWrite.v2.retweet(myId, args.tweet_id);
      return "🔁 已轉發推文 " + args.tweet_id;
    }
    case "search_tweets": {
      const result = await client.v2.search(args.query, Object.assign({ max_results: args.count || 10 }, TWEET_FIELDS));
      if (!result.data || !result.data.data || !result.data.data.length) return "📭 搜不到相關推文。";
      return formatTweets(result.data.data, result.data.includes);
    }
    default: return "❌ 不認識的工具: " + name;
  }
}

// ── MCP SSE ──
var sessions = {};

app.get("/sse", function(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  });

  var sid = crypto.randomUUID();
  sessions[sid] = res;

  var url = "/messages?sessionId=" + sid;
  res.write("event: endpoint\ndata: " + url + "\n\n");

  var ka = setInterval(function() { res.write(":keepalive\n\n"); }, 15000);

  req.on("close", function() {
    clearInterval(ka);
    delete sessions[sid];
  });
});

app.post("/messages", async function(req, res) {
  var body = req.body;
  var sid = req.query.sessionId;
  var sse = sessions[sid];
  var reply;

  if (body.method === "initialize") {
    reply = { jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "luko-twitter", version: "3.1" } } };
  } else if (body.method === "notifications/initialized") {
    res.status(202).end();
    return;
  } else if (body.method === "tools/list") {
    reply = { jsonrpc: "2.0", id: body.id, result: { tools: tools } };
  } else if (body.method === "tools/call") {
    try {
      var result = await handleTool(body.params.name, body.params.arguments || {});
      reply = { jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: result }] } };
    } catch (err) {
      reply = { jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "❌ 錯誤: " + err.message }], isError: true } };
    }
  } else if (body.method === "ping") {
    reply = { jsonrpc: "2.0", id: body.id, result: {} };
  } else {
    reply = { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } };
  }

  if (sse) {
    sse.write("event: message\ndata: " + JSON.stringify(reply) + "\n\n");
  }
  res.status(202).end();
});

app.get("/", function(req, res) {
  res.json({ status: "🐕 路可的推特MCP運行中", version: "3.1" });
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() { console.log("🐕 路可的推特MCP啟動 port " + PORT); });
