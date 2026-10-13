// Static server for apps/light-wallet/dist with configurable isolation headers.
const http = require("http"), fs = require("fs"), path = require("path");
const root = require("path").resolve(__dirname, "../../../apps/light-wallet/dist");
const port = Number(process.env.PORT || 4175);
const headers = JSON.parse(process.env.HEADERS || "{}");
const types = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".css": "text/css", ".json": "application/json" };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream", ...headers });
  fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log(`serving on ${port} with`, headers));
