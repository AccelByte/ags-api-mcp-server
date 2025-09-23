const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

// Simple SSE endpoint
app.get('/mcp/sse', (req, res) => {
  console.log('SSE connection received');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });
  
  res.write('event: connected\ndata: {"message":"MCP Server connected"}\n\n');
  
  // Keep connection alive
  const pingInterval = setInterval(() => {
    if (res.destroyed) {
      clearInterval(pingInterval);
      return;
    }
    res.write('event: ping\ndata: {"timestamp":"' + new Date().toISOString() + '"}\n\n');
  }, 30000);
  
  req.on('close', () => {
    clearInterval(pingInterval);
    console.log('SSE client disconnected');
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const port = 3000;
app.listen(port, () => {
  console.log(`Test server running on port ${port}`);
  console.log(`SSE endpoint: http://localhost:${port}/mcp/sse`);
  console.log(`Health check: http://localhost:${port}/health`);
});
