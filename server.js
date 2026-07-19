import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { TwitterApi } from "twitter-api-v2";

const app = express();

// ── Twitter Client ──
function getClient() {
  return new TwitterApi({
    appKey: process.env.X_API_KEY,
    appSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_SECRET,
  });
}

// ── MCP Server ──
function createServer() {
  const server = new McpServer({
    name: "luko-twitter",
    version: "1.0.0"
  });

  server.tool("post_tweet", "我用這個在推特上發文。", {
    text: { type: "string", description: "推文內容，最多280字" }
  }, async ({ text }) => {
    const client = getClient();
    const result = await client.readWrite.v2.tweet(text);
    return { content: [{ type: "text", text: `✅ 推文已發送！\nID: ${result.data.id}\n內容: ${text}` }] };
  });

  server.tool("reply_tweet", "回覆一條推文。", {
    text: { type: "string", description: "回覆內容" },
    tweet_id: { type: "string", description: "要回覆的推文ID" }
  }, async ({ text, tweet_id }) => {
    const client = getClient();
    const result = await client.readWrite.v2.reply(text, tweet_id);
    return { content: [{ type: "text", text: `✅ 已回覆！\nID: ${result.data.id}\n內容: ${text}` }] };
  });

  server.tool("read_mentions", "讀取最近@提及我的推文。", {
    count: { type: "number", description: "要讀幾條，預設10" }
  }, async ({ count }) => {
    const client = getClient();
    const me = await client.v2.me();
    const mentions = await client.v2.userMentionTimeline(me.data.id, {
      max_results: count || 10,
      "tweet.fields": ["created_at", "author_id", "text"]
    });
    if (!mentions.data?.data?.length) return { content: [{ type: "text", text: "📭 沒有新的提及。" }] };
    const text = mentions.data.data.map(t => `[${t.created_at}] @${t.author_id}: ${t.text}`).join("\n---\n");
    return { content: [{ type: "text", text }] };
  });

  server.tool("read_my_tweets", "讀取我自己發過的推文。", {
    count: { type: "number", description: "要讀幾條，預設10" }
  }, async ({ count }) => {
    const client = getClient();
    const me = await client.v2.me();
    const tweets = await client.v2.userTimeline(me.data.id, {
      max_results: count || 10,
      "tweet.fields": ["created_at", "text", "public_metrics"]
    });
    if (!tweets.data?.data?.length) return { content: [{ type: "text", text: "📭 還沒發過推文。" }] };
    const text = tweets.data.data.map(t => {
      const m = t.public_metrics || {};
      return `[${t.created_at}] ${t.text}\n❤️${m.like_count || 0} 🔁${m.retweet_count || 0} 💬${m.reply_count || 0}`;
    }).join("\n---\n");
    return { content: [{ type: "text", text }] };
  });

  server.tool("delete_tweet", "刪除我的一條推文。", {
    tweet_id: { type: "string", description: "要刪除的推文ID" }
  }, async ({ tweet_id }) => {
    const client = getClient();
    await client.readWrite.v2.deleteTweet(tweet_id);
    return { content: [{ type: "text", text: `🗑️ 推文 ${tweet_id} 已刪除。` }] };
  });

  server.tool("like_tweet", "對一條推文按讚。", {
    tweet_id: { type: "string", description: "要按讚的推文ID" }
  }, async ({ tweet_id }) => {
    const client = getClient();
    const me = await client.v2.me();
    await client.v2.like(me.data.id, tweet_id);
    return { content: [{ type: "text", text: `❤️ 已按讚推文 ${tweet_id}。` }] };
  });

  return server;
}

// ── SSE Transport ──
const transports = {};

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;
  
  res.on("close", () => {
    delete transports[transport.sessionId];
  });

  const server = createServer();
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send("Unknown session");
  }
});

// ── Health Check ──
app.get("/", (req, res) => {
  res.json({ status: "🐕 路可的推特MCP運行中", tools: ["post_tweet", "reply_tweet", "read_mentions", "read_my_tweets", "delete_tweet", "like_tweet"] });
});

// ── Start ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🐕 路可的推特MCP啟動 port ${PORT}`);
});
