// All customer data is fetched from our persistent Node.js API.
const $ = id => document.getElementById(id);
const esc = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => '$'+value.toFixed(2);
let token = localStorage.getItem('vvansToken') || sessionStorage.getItem('vvansToken') || '';
let cart = {items:[],count:0,subtotal:0,total:0};
async function api(route,method='GET',body) {
 const response=await fetch('/api'+route,{
   method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
   body:body===undefined?undefined:JSON.stringify(body)
 });
 const result=response.status===204?null:await response.json();
 if(!response.ok) throw Error(result.error || 'Request failed');
 return result;
}
function notice(message,error=false) {
 $('notice').className='alert '+(error?'alert-danger':'alert-success');
 $('notice').textContent=message;
 // Form errors remain visible above the open modal too.
 for(const id of ['loginForm','signupForm']) {
  let line=$(id).querySelector('[role="alert"]');
  if(!line) {line=document.createElement('p'); line.setAttribute('role','alert'); line.className='text-danger mt-2'; $(id).append(line);}
  line.textContent=error?message:'';
 }
}
function renderCart() {
 $('cartCount').textContent=cart.count;
 $('cartItems').innerHTML=cart.items.map(i=>`<div class="card card-body mb-3"><div class="d-flex gap-3">
 <img src="${esc(i.product.image)}" alt="${esc(i.product.name)}" class="cart-item-thumb rounded">
 <div><strong>${esc(i.product.name)}</strong><p>${money(i.product.price)} each</p>
 <div class="btn-group btn-group-sm"><button class="btn btn-outline-dark" data-quantity="${i.quantity-1}" data-product="${i.productId}" aria-label="Decrease quantity">−</button>
 <span class="btn disabled">${i.quantity}</span><button class="btn btn-outline-dark" data-quantity="${i.quantity+1}" data-product="${i.productId}" aria-label="Increase quantity">+</button></div>
 <button class="btn btn-sm text-danger" data-remove="${i.productId}">Remove</button></div></div></div>`).join('')||'<p>Your cart is empty.</p>';
 $('cartTotals').textContent='Total: '+money(cart.total)+' · Free shipping';
 $('orderSummary').innerHTML=cart.items.map(i=>`<div class="d-flex justify-content-between mb-2"><span>${esc(i.product.name)} × ${i.quantity}</span><strong>${money(i.lineTotal)}</strong></div>`).join('')+
 `<hr><p>Shipping: FREE</p><p class="h5 mb-4">Total: ${money(cart.total)}</p>`;
}
async function refreshCart() {cart=token?await api('/cart'):{items:[],count:0,subtotal:0,total:0}; renderCart();}
async function orders() {
 if(!token) {$('orderHistory').textContent='Log in to view your orders.'; return;}
 const list=await api('/orders');
 $('orderHistory').innerHTML=list.slice().reverse().map(o=>`<div class="border rounded p-3 mb-2"><strong>Order ${esc(o.id)}</strong><p class="mb-0">${esc(new Date(o.createdAt).toLocaleString())} · ${money(o.total)} · ${esc(o.status)}</p></div>`).join('')||'No orders yet.';
}
async function reviews() {
 const list=await api('/reviews');
 $('savedReviews').innerHTML=list.map(r=>`<div class="col-md-4"><div class="border rounded p-3"><strong>${esc(r.name)} · ${r.rating}/5</strong><p class="mb-0">${esc(r.comment)}</p></div></div>`).join('')||'<p>No submitted reviews yet.</p>';
}
function clearSession() { token=''; localStorage.removeItem('vvansToken'); sessionStorage.removeItem('vvansToken'); }
async function account() {
 let user=null;
 if(token) {
  try {user=await api('/me');} catch {clearSession();}
 }
 $('accountStatus').textContent=user?'Signed in as '+user.name:'Not logged in';
 $('logoutButton').classList.toggle('d-none',!user);
 document.querySelectorAll('[data-bs-target="#loginModal"], [data-bs-target="#signupModal"]').forEach(b=>b.classList.toggle('d-none',!!user));
 if(user) {$('checkoutFullName').value=user.name; $('checkoutEmailAddr').value=user.email;}
 await refreshCart(); await orders();
}
$('loginForm').onsubmit=async event=>{
 event.preventDefault();
 try {
  const result=await api('/login','POST',{email:$('loginEmail').value,password:$('loginPassword').value});
  clearSession(); token=result.token;
  ($('rememberMeCheck').checked?localStorage:sessionStorage).setItem('vvansToken',token);
  bootstrap.Modal.getOrCreateInstance($('loginModal')).hide(); $('loginForm').reset(); await account(); notice('Logged in successfully.');
 } catch(e) {notice(e.message,true);}
};
$('signupForm').onsubmit=async event=>{
 event.preventDefault();
 if($('signupPassword').value!==$('signupConfirmPassword').value) return notice('Passwords do not match.',true);
 try {
  await api('/signup','POST',{name:$('signupName').value,email:$('signupEmail').value,password:$('signupPassword').value});
  bootstrap.Modal.getOrCreateInstance($('signupModal')).hide(); $('signupForm').reset(); notice('Account created. You can now log in.');
 } catch(e) {notice(e.message,true);}
};
$('logoutButton').onclick=async()=>{
 try {await api('/logout','POST'); clearSession(); await account(); notice('Logged out.');} catch(e) {notice(e.message,true);}
};
$('cartItems').onclick=async event=>{
 const b=event.target.closest('button'); if(!b) return;
 const id=Number(b.dataset.remove||b.dataset.product); const quantity=Number(b.dataset.quantity);
 try {
  cart=await api('/cart/'+id,b.dataset.remove||quantity===0?'DELETE':'PUT',b.dataset.remove||quantity===0?undefined:{quantity});
  renderCart();
 } catch(e) {notice(e.message,true);}
};
$('checkoutForm').onsubmit=async event=>{
 event.preventDefault();
 const button=document.querySelector('[form="checkoutForm"]'); button.disabled=true;
 try {
  const order=await api('/checkout','POST',{
   fullName:$('checkoutFullName').value,email:$('checkoutEmailAddr').value,phone:$('checkoutPhone').value,
   address:$('checkoutAddress').value,city:$('checkoutCity').value,postalCode:$('checkoutPostalCode').value
  });
  await refreshCart(); await orders(); notice('Order placed! Reference: '+order.id+' · '+money(order.total));
 } catch(e) {notice(e.message,true);} finally {button.disabled=false;}
};
$('reviewForm').onsubmit=async event=>{
 event.preventDefault();
 try {await api('/reviews','POST',{rating:Number($('reviewRating').value),comment:$('reviewComment').value}); $('reviewForm').reset(); await reviews(); notice('Review submitted.');}
 catch(e) {notice(e.message,true);}
};
async function loadProducts() {
 const products=await api('/products');
 document.querySelector('#products .row.g-4').innerHTML=products.map(p=>`<div class="col-12 col-sm-6 col-lg-4"><div class="product-card h-100 d-flex flex-column">
 <div class="product-img-wrap"><img src="${esc(p.image)}" alt="${esc(p.name)} frame" class="img-fluid"></div>
 <div class="p-3 mt-auto"><div class="d-flex justify-content-between"><h3 class="h5 font-serif">${esc(p.name)}</h3><strong>${money(p.price)}</strong></div>
 <p class="small text-secondary">Frame with prescription lenses</p><button class="btn btn-outline-dark rounded-pill w-100" data-add="${p.id}">Add to cart</button></div></div></div>`).join('');
}
document.querySelector('#products').onclick=async event=>{
 const button=event.target.closest('[data-add]'); if(!button) return;
 if(!token) {notice('Please log in before adding products.',true); bootstrap.Modal.getOrCreateInstance($('loginModal')).show(); return;}
 button.disabled=true;
 try {cart=await api('/cart','POST',{productId:Number(button.dataset.add),quantity:1}); renderCart(); bootstrap.Offcanvas.getOrCreateInstance($('shoppingCart')).show();}
 catch(e) {notice(e.message,true);} finally {button.disabled=false;}
};
Promise.all([loadProducts(),account(),reviews()]).catch(e=>notice('Could not load store: '+e.message,true));
