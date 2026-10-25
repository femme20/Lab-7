// Node.js built-in HTTP + JSON file persistence. No npm packages required.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomBytes,randomUUID,scrypt:deriveKey,timingSafeEqual} = require('node:crypto');
const {promisify} = require('node:util');
const scrypt = promisify(deriveKey);
const {createStore} = require('./store');
class HttpError extends Error {
  constructor(status,message) { super(message); this.status=status; }
}
function text(value,key,max=200) {
  if (typeof value!=='string' || !value.trim() || value.trim().length>max) throw new HttpError(400,`${key} is required (max ${max} characters)`);
  return value.trim();
}
function email(value) {
  const result = text(value,'email').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new HttpError(400,'Enter a valid email');
  return result;
}
function integer(value,label,min=1,max=99) {
  if (!Number.isInteger(value) || value<min || value>max) throw new HttpError(400,`${label} must be an integer from ${min} to ${max}`);
  return value;
}
async function body(req) {
  if (!String(req.headers['content-type']).includes('application/json')) throw new HttpError(415,'Use application/json');
  const chunks=[]; let size=0;
  for await (const chunk of req) {
    size+=chunk.length;
    if(size>65536) throw new HttpError(413,'Body too large');
    chunks.push(chunk);
  }
  try {
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || Array.isArray(value) || typeof value!=='object') throw Error();
    return value;
  } catch { throw new HttpError(400,'Send a valid JSON object'); }
}
function createApp(file=path.join(__dirname,'data','store.json')) {
 const store=createStore(file);
 const publicDir=path.join(__dirname,'public');
 function userOf(db,req) {
   const token=/^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization||'')?.[1];
   const session=db.sessions.find(s=>s.token===token && s.expiresAt>Date.now());
   const user=session && db.users.find(u=>u.id===session.userId);
   if(!user) throw new HttpError(401,'Please log in first');
   return user;
 }
 const publicUser=u=>({id:u.id,name:u.name,email:u.email});
 function cartOf(db,userId) {
   let cart=db.carts.find(c=>c.userId===userId);
   if(!cart) {cart={userId,items:[]}; db.carts.push(cart);}
   return cart;
 }
 function cartView(db,cart) {
   const items=cart.items.map(item=>{
     const product=db.products.find(p=>p.id===item.productId);
     return {...item,product,lineTotal:product.price*item.quantity};
   });
   const subtotal=items.reduce((sum,item)=>sum+item.lineTotal,0);
   return {items,subtotal,shipping:0,total:subtotal,count:items.reduce((sum,i)=>sum+i.quantity,0)};
 }
 function json(res,status,value) {
   res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   res.end(status===204 ? undefined : JSON.stringify(value));
 }
 return http.createServer(async(req,res)=>{
  try {
   const url=new URL(req.url,'http://localhost');
   const route=url.pathname; const method=req.method;
   if(!route.startsWith('/api/')) {
     if(method!=='GET' && method!=='HEAD') throw new HttpError(405,'Method not allowed');
     // Serve only the storefront assets, never server code or stored customer data.
     const relative=decodeURIComponent(route==='/'?'/index.html':route);
     if(!/^\/(index\.html|style\.css|app\.js|images\/[\w.-]+)$/.test(relative)) throw new HttpError(404,'File not found');
     const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.jpg':'image/jpeg','.png':'image/png'};
     let contents;
     try {contents=await fs.readFile(path.join(publicDir,relative));}
     catch(error) {if(error.code==='ENOENT') throw new HttpError(404,'File not found'); throw error;}
     res.writeHead(200,{'Content-Type':types[path.extname(relative)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});
     return res.end(method==='HEAD'?undefined:contents);
   }
   if(route==='/api/signup' && method==='POST') {
     const b=await body(req); const name=text(b.name,'name'); const address=email(b.email);
     if(typeof b.password!=='string'|| b.password.length<6 || b.password.length>128) throw new HttpError(400,'Password must have 6–128 characters');
     const salt=randomBytes(16).toString('hex');
     const passwordHash=(await scrypt(b.password,salt,64)).toString('hex');
     const user=await store.edit(db=>{
       if(db.users.some(u=>u.email===address)) throw new HttpError(409,'Email already registered');
       const u={id:randomUUID(),name,email:address,salt,passwordHash}; db.users.push(u); return publicUser(u);
     });
     return json(res,201,user);
   }
   if(route==='/api/login' && method==='POST') {
     const b=await body(req); const address=email(b.email);
     if(typeof b.password!=='string' || b.password.length>128) throw new HttpError(400,'Password required');
     const db=await store.read(); const user=db.users.find(u=>u.email===address);
     const hash=await scrypt(b.password,user?user.salt:'invalid-user-salt',64);
     if(!user||!timingSafeEqual(hash,Buffer.from(user.passwordHash,'hex'))) throw new HttpError(401,'Incorrect email or password');
     const token=randomBytes(32).toString('hex'); const expiresAt=Date.now()+7*24*60*60*1000;
     await store.edit(data=>{
       data.sessions=data.sessions.filter(s=>s.expiresAt>Date.now());
       data.sessions.push({token,userId:user.id,expiresAt});
     });
     return json(res,200,{token,expiresAt,user:publicUser(user)});
   }
   if(route==='/api/products' && method==='GET') return json(res,200,(await store.read()).products);
   if(route==='/api/reviews' && method==='GET') return json(res,200,(await store.read()).reviews);
   if(route==='/api/me' && method==='GET') return json(res,200,publicUser(userOf(await store.read(),req)));
   if(route==='/api/logout' && method==='POST') {
     await store.edit(db=>{ userOf(db,req); const token=req.headers.authorization.slice(7); db.sessions=db.sessions.filter(s=>s.token!==token); });
     return json(res,204);
   }
   if(route==='/api/cart' && method==='GET') {
     const db=await store.read(); const user=userOf(db,req);
     return json(res,200,cartView(db,db.carts.find(c=>c.userId===user.id)||{items:[]}));
   }
   const cartMatch=/^\/api\/cart\/([1-9]\d*)$/.exec(route);
   if((route==='/api/cart' && method==='POST') || (cartMatch && ['PUT','PATCH','DELETE'].includes(method))) {
     const b=method==='DELETE'?{}:await body(req);
     const productId=cartMatch?Number(cartMatch[1]):integer(b.productId,'productId',1,1000000);
     const quantity=method==='DELETE'?0:integer(b.quantity,'quantity');
     const result=await store.edit(db=>{
       const user=userOf(db,req);
       if(!db.products.some(p=>p.id===productId)) throw new HttpError(404,'Product not found');
       const cart=cartOf(db,user.id); const item=cart.items.find(i=>i.productId===productId);
       if(method==='DELETE') {
         if(!item) throw new HttpError(404,'Cart item not found');
         cart.items=cart.items.filter(i=>i.productId!==productId);
       } else if(method==='POST') {
         if(item) item.quantity=integer(item.quantity+quantity,'Combined quantity');
         else cart.items.push({productId,quantity});
       } else {
         if(!item) throw new HttpError(404,'Cart item not found');
         item.quantity=quantity;
       }
       return cartView(db,cart);
     });
     return json(res,method==='POST'?201:200,result);
   }
   if(route==='/api/checkout' && method==='POST') {
     const b=await body(req); const shipping={};
     for(const key of ['fullName','phone','address','city','postalCode']) shipping[key]=text(b[key],key);
     shipping.email=email(b.email);
     const order=await store.edit(db=>{
       const user=userOf(db,req); const cart=cartOf(db,user.id);
       if(!cart.items.length) throw new HttpError(400,'Your cart is empty');
       // Compute prices on the server. Ignore client-supplied prices and totals.
       const view=cartView(db,cart);
       const order={id:randomUUID(),userId:user.id,createdAt:new Date().toISOString(),shipping,...view,status:'Placed',paymentMethod:'Cash on delivery (demo)'};
       db.orders.push(order); cart.items=[]; return order;
     });
     return json(res,201,order);
   }
   if(route==='/api/orders' && method==='GET') {
     const db=await store.read(); const user=userOf(db,req);
     return json(res,200,db.orders.filter(o=>o.userId===user.id));
   }
   if(route==='/api/reviews' && method==='POST') {
     const b=await body(req); const comment=text(b.comment,'comment',1000); const rating=integer(b.rating,'rating',1,5);
     const review=await store.edit(db=>{
       const user=userOf(db,req);
       const review={id:randomUUID(),userId:user.id,name:user.name,rating,comment,createdAt:new Date().toISOString()};
       db.reviews.push(review); return review;
     });
     return json(res,201,review);
   }
   throw new HttpError(404,'Endpoint not found');
  } catch(error) {
    if(!error.status) console.error(error);
    if(!res.headersSent) json(res,error.status||500,{error:error.status?error.message:'Internal server error'});
    else res.destroy();
  }
 });
}
if(require.main===module) createApp().listen(3005,'127.0.0.1',()=>console.log('VVANS: http://localhost:3005'));
module.exports={createApp};
