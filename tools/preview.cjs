const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const server=http.createServer((req,res)=>{
  let pathname;
  try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch(_){res.writeHead(400).end();return;}
  if(pathname==='/') pathname='/index.html';
  if(!['/index.html','/admin.html'].includes(pathname) && !/^\/assets\/[a-z]+\.(js|css)$/.test(pathname)){res.writeHead(404).end('Not found');return;}
  const file=path.join(root,pathname);
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end('Not found');return;}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'text/plain','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);});
});
server.listen(8765,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:8765/  |  体验：http://127.0.0.1:8765/?demo=1'));
module.exports=server;
