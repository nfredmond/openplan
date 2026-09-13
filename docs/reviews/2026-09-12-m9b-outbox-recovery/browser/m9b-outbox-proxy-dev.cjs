const http=require('node:http'),fs=require('node:fs'),{spawn}=require('node:child_process');
const app='/home/nathaniel/.local/state/openplan/engagement-write-recovery-2026-09-12/openplan';
let campaignId=null,fail=false,refused=0,forwarded=0,child;
const proxy=http.createServer(async(req,res)=>{
 const parsed=new URL(req.url,'http://127.0.0.1:3219');
 if(parsed.pathname==='/__control'){
  if(req.method==='POST'){
   const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks));
   if(typeof body.fail!=='boolean'||!/^[-a-f0-9]{36}$/.test(body.campaignId)){res.writeHead(400).end();return;}
   campaignId=body.campaignId;fail=body.fail;
  }
  res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({campaignId,fail,refused,forwarded}));return;
 }
 const target=new URL('http://127.0.0.1:29821');target.pathname=parsed.pathname;target.search=parsed.search;
 let forwardedBody,writeCampaign;
 if(req.method==='POST'&&parsed.pathname==='/rest/v1/engagement_email_outbox'){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);forwardedBody=Buffer.concat(chunks);
  try{const body=JSON.parse(forwardedBody);writeCampaign=(Array.isArray(body)?body[0]:body)?.campaign_id}catch{}
 }
 if(fail&&writeCampaign===campaignId){
  refused++;res.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({code:'08006',message:'SYNTHETIC outbox write unavailable',details:null,hint:null}));return;
 }
 forwarded++;
 const upstream=http.request(target,{method:req.method,headers:{...req.headers,host:target.host}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});
 upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Local backend unavailable')});if(forwardedBody)upstream.end(forwardedBody);else req.pipe(upstream);
});
proxy.on('error',e=>{console.error(e.message);process.exit(1)});
proxy.listen(3219,'127.0.0.1',()=>{
 const fd=fs.openSync('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/m9b-outbox-dev.log','w');
 child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port','3256'],{cwd:app,env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:3219',RESEND_API_KEY:'SYNTHETIC_LOCAL_ONLY',NODE_OPTIONS:'--require=/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/m9b-outbox-email-stub.cjs'},stdio:['ignore',fd,fd]});
 console.log(JSON.stringify({proxyPid:process.pid,devPid:child.pid,app,emailTransport:'local fetch stub; no external delivery'}));
 child.on('exit',code=>{proxy.closeAllConnections();proxy.close(()=>process.exit(code??0))});
});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{if(child)child.kill('SIGTERM');else proxy.close(()=>process.exit(0))});
