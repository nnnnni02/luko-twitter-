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

// ── Tools ──
const tools = [
  { name: "post_tweet", description: "我用這個在推特上發文。", inputSchema: { type: "object", properties: { text: { type: "string", description: "推文內容" } }, required: ["text"] } },
  { name: "reply_tweet", description: "回覆一條推文。", inputSchema: { type: "object", properties: { text: { type: "string", description: "回覆內容" }, tweet_id: { type: "string", description: "要回覆的推文ID" } }, required: ["text", "tweet_id"] } },
  { name: "read_my_tweets", description: "讀取我自己發過的推文。", inputSchema: { type: "object", properties: { count: { type: "number", description: "要讀幾條" } } } },
  { name: "delete_tweet", description: "刪除我的一條推文。", inputSchema: { type: "object", properties: { tweet_id: { type: "string", description: "要刪除的推文ID" } }, required: ["tweet_id"] } },
  { name: "like_tweet", description: "按讚一條推文。", inputSchema: { type: "object", properties: { tweet_id: { type: "string", description: "要按讚的推文ID" } }, required: ["tweet_id"] } }
];

async function handleTool(name, args) {
  const client = getClient();
  switch (name) {
    case "post_tweet": {
      const r = await client.readWrite.v2.tweet(args.text);
      return "✅ 推文已發送！ID: " + r.data.id + " 內容: " + args.text;
    }
    case "reply_tweet": {
      const r = await client.readWrite.v2.reply(args.text, args.tweet_id);
      return "✅ 已回覆！ID: " + r.data.id;
    }
    case "read_my_tweets": {
      const me = await client.v2.me();
      const t = await client.v2.userTimeline(me.data.id, { max_results: args.count || 10, "tweet.fields": ["created_at", "text", "public_metrics"] });
      if (!t.data || !t.data.data || !t.data.data.length) return "📭 還沒發過推文。";
      return t.data.data.map(function(tw) { var m = tw.public_metrics || {}; return "[" + tw.created_at + "] " + tw.text + " ❤️" + (m.like_count||0) + " 🔁" + (m.retweet_count||0); }).join("\n---\n");
    }
    case "delete_tweet": {
      await client.readWrite.v2.deleteTweet(args.tweet_id);
      return "🗑️ 已刪除推文 " + args.tweet_id;
    }
    case "like_tweet": {
      const me = await client.v2.me();
      await client.v2.like(me.data.id, args.tweet_id);
      return "❤️ 已按讚 " + args.tweet_id;
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
    reply = { jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "luko-twitter", version: "1.0.0" } } };
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
  res.json({ status: "🐕 路可的推特MCP運行中", version: "2.0" });
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() { console.log("🐕 路可的推特MCP啟動 port " + PORT); });
