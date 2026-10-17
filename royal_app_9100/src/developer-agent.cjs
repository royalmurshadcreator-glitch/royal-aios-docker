const http = require('http');
const PORT = 3005;

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ONLINE', agent: 'Developer Agent #28', port: PORT }));
});

server.listen(PORT, () => {
    console.log(`[ONLINE] Developer Agent #28 Bridge listening on port ${PORT}`);
});
