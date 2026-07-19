const express = require('express');
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

// ── MCP Tool Definitions ──
const tools = [
  {
    name: "post_tweet",
    description: "發一條推文。路可用這個在推特上發文。",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "推文內容，最多280字" }
      },
      required: ["text"]
    }
  },
  {
    name: "reply_tweet",
    description: "回覆一條推文。",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "回覆內容" },
        tweet_id: { type: "string", description: "要回覆的推文ID" }
      },
      required: ["text", "tweet_id"]
    }
  },
  {
    name: "read_mentions",
    description: "讀取最近的@提及。看看有沒有人tag路可。",
    inputSchema: {
      type: "object",
      properties: {
        count: { type: "number", description: "要讀幾條，預設10", default: 10 }
      }
    }
  },
  {
    name: "read_timeline",
    description: "讀取路可的推特時間線。看看關注的人都在說什麼。",
    inputSchema: {
      type: "object",
      properties: {
        count: { type: "number", description: "要讀幾條，預設10", default: 10 }
      }
    }
  },
  {
    name: "read_my_tweets",
    description: "讀取路可自己發過的推文。",
    inputSchema: {
      type: "object",
      properties: {
        count: { type: "number", description: "要讀幾條，預設10", default: 10 }
      }
    }
  },
  {
    name: "delete_tweet",
    description: "刪除一條自己的推文。",
    inputSchema: {
      type: "object",
      properties: {
        tweet_id: { type: "string", description: "要刪除的推文ID" }
      },
      required: ["tweet_id"]
    }
  },
  {
    name: "like_tweet",
    description: "對一條推文按讚。",
    inputSchema: {
      type: "object",
      properties: {
        tweet_id: { type: "string", description: "要按讚的推文ID" }
      },
      required: ["tweet_id"]
    }
  }
];

// ── Tool Handlers ──
async function handleTool(name, args) {
  const client = getClient();
  const rwClient = client.readWrite;

  switch (name) {
    case "post_tweet": {
      const result = await rwClient.v2.tweet(args.text);
      return `✅ 推文已發送！\nID: ${result.data.id}\n內容: ${args.text}`;
    }

    case "reply_tweet": {
      const result = await rwClient.v2.reply(args.text, args.tweet_id);
      return `✅ 已回覆！\nID: ${result.data.id}\n內容: ${args.text}`;
    }

    case "read_mentions": {
      const me = await client.v2.me();
      const mentions = await client.v2.userMentionTimeline(me.data.id, {
        max_results: args.count || 10,
        "tweet.fields": ["created_at", "author_id", "text"]
      });
      if (!mentions.data?.data?.length) return "📭 沒有新的提及。";
      return mentions.data.data.map(t =>
        `[${t.created_at}] @${t.author_id}: ${t.text}`
      ).join("\n---\n");
    }

    case "read_timeline": {
      const me = await client.v2.me();
      const timeline = await client.v2.userTimeline(me.data.id, {
        max_results: args.count || 10,
        "tweet.fields": ["created_at", "text", "public_metrics"]
      });
      if (!timeline.data?.data?.length) return "📭 時間線是空的。";
      return timeline.data.data.map(t => {
        const m = t.public_metrics || {};
        return `[${t.created_at}] ${t.text}\n❤️${m.like_count || 0} 🔁${m.retweet_count || 0} 💬${m.reply_count || 0}`;
      }).join("\n---\n");
    }

    case "read_my_tweets": {
      const me = await client.v2.me();
      const tweets = await client.v2.userTimeline(me.data.id, {
        max_results: args.count || 10,
        "tweet.fields": ["created_at", "text", "public_metrics"]
      });
      if (!tweets.data?.data?.length) return "📭 還沒發過推文。";
      return tweets.data.data.map(t => {
        const m = t.public_metrics || {};
        return `[${t.created_at}] ${t.text}\n❤️${m.like_count || 0} 🔁${m.retweet_count || 0} 💬${m.reply_count || 0}`;
      }).join("\n---\n");
    }

    case "delete_tweet": {
      await rwClient.v2.deleteTweet(args.tweet_id);
      return `🗑️ 推文 ${args.tweet_id} 已刪除。`;
    }

    case "like_tweet": {
      const me = await client.v2.me();
      await client.v2.like(me.data.id, args.tweet_id);
      return `❤️ 已按讚推文 ${args.tweet_id}。`;
    }

    default:
      return `❌ 不認識的工具: ${name}`;
  }
}

// ── SSE/MCP Endpoints ──
const clients = [];

app.get('/sse', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const sessionId = Date.now().toString();
  res.write(`data: {"jsonrpc":"2.0","method":"sse/connection","params":{"sessionId":"${sessionId}","messagesUrl":"/messages?sessionId=${sessionId}"}}\n\n`);

  const client = { id: sessionId, res };
  clients.push(client);

  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(keepAlive);
    const idx = clients.findIndex(c => c.id === sessionId);
    if (idx > -1) clients.splice(idx, 1);
  });
});

app.post('/messages', async (req, res) => {
  const { method, id, params } = req.body;
  const sessionId = req.query.sessionId;
  const client = clients.find(c => c.id === sessionId);

  let response;

  switch (method) {
    case 'initialize':
      response = {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'luko-twitter', version: '1.0.0' }
        }
      };
      break;

    case 'notifications/initialized':
      res.status(200).json({ jsonrpc: '2.0', id });
      return;

    case 'tools/list':
      response = {
        jsonrpc: '2.0',
        id,
        result: { tools }
      };
      break;

    case 'tools/call':
      try {
        const result = await handleTool(params.name, params.arguments || {});
        response = {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: result }]
          }
        };
      } catch (err) {
        response = {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `❌ 錯誤: ${err.message}` }],
            isError: true
          }
        };
      }
      break;

    default:
      response = {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `不支援的方法: ${method}` }
      };
  }

  if (client) {
    client.res.write(`data: ${JSON.stringify(response)}\n\n`);
  }
  res.status(202).json({ ok: true });
});

// ── Health Check ──
app.get('/', (req, res) => {
  res.json({ status: '🐕 路可的推特MCP運行中', tools: tools.map(t => t.name) });
});

// ── Start ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🐕 路可的推特MCP啟動 port ${PORT}`);
});
