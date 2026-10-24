// Full HTTP check against the isolated undersale-preview.cjs server only.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const api = 'http://127.0.0.1:3013/api/v1', web = 'http://localhost:3022';
async function main() {
  const login = await fetch(api+'/admin/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'preview@example.invalid',password:process.env.BMTECH_ACCOUNT_PREVIEW_PASSWORD})});
  assert.equal(login.status,201); const {accessToken}=await login.json(); assert.ok(accessToken);
  async function call(route,method='GET',body) { const r=await fetch(api+'/'+route,{method,headers:{authorization:'Bearer '+accessToken,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});const data=await r.json();assert.ok(r.ok,JSON.stringify({status:r.status,data}));return data; }
  const created=await call('admin/products','POST',{nameEn:'QA power controller',nameFr:'QA controleur',descriptionEn:'Isolated test product with real uploaded BMTech photos, specifications and stock.',descriptionFr:'Produit de test',shortDescription:'Isolated test product to verify actual uploaded photos from database to storefront.',brand:'QA',model:'Controller',condition:'USED',priceMode:'FIXED',price:12500.25,stockQuantity:2,isAvailable:true,isUndersale:true,isPublished:false,specifications:[{label:'Purpose',value:'Local QA only'}]});
  const form=new FormData();
  const files=['generator-01-enclosed-turquoise.jpeg','generator-02-portable-yellow.jpeg'];
  const buffers=files.map(name=>fs.readFileSync('../frontend/public/images/products/generators/'+name));
  files.forEach((name,i)=>form.append('files',new Blob([buffers[i]],{type:'image/jpeg'}),name));
  const uploaded=(await call('admin/products/'+created.id+'/images','POST',form)).data;
  assert.equal(uploaded.length,2);
  await call('admin/products/'+created.id+'/images/reorder','PATCH',{imageIds:[uploaded[1].id,uploaded[0].id],coverImageId:uploaded[1].id});
  await call('admin/products/'+created.id,'PATCH',{isPublished:true});
  const published=await call('products/'+created.slug);assert.equal(published.coverImageUrl,uploaded[1].url);assert.equal(published.images.length,2);
  console.log('PASS: authentication, create, multiple real uploads, main photo selection and publication.');
  const homepage=await fetch(web+'/en');assert.equal(homepage.status,200);const html=await homepage.text();
  assert.ok(html.indexOf('Explore Our Equipment Categories')<html.indexOf('Featured Power Equipment'));
  assert.ok(html.indexOf('Featured Power Equipment')<html.indexOf('id="undersale-heading"'));
  assert.ok(html.includes('Kimenyi Miseach'));assert.ok(html.includes('mailto:kimenyimiseach9@gmail.com'));assert.ok(html.includes('tel:+250792031219'));
  console.log('PASS: homepage section order and exact clickable developer credit.');
  for(const route of ['/en/undersale','/en/electronics','/en/products/'+created.slug]) {const r=await fetch(web+route);assert.equal(r.status,200);console.log('PASS: '+route);}
  const media='/api/media/'+uploaded[1].url.split('/').pop();
  const image=await fetch(web+media);assert.equal(image.status,200);assert.match(image.headers.get('content-type'),/image\/jpeg/);assert.deepEqual(Buffer.from(await image.arrayBuffer()),buffers[1]);
  const optimized=await fetch(web+'/_next/image?url='+encodeURIComponent(media)+'&w=640&q=75');assert.equal(optimized.status,200);assert.match(optimized.headers.get('content-type'),/^image\//);assert.ok((await optimized.arrayBuffer()).byteLength>100);
  console.log('PASS: saved JPEG bytes arrive through the media proxy and Next image optimization.');
  await call('admin/settings','PATCH',{ceoWhatsapp:'+99912345678'});
  const cart=await call('cart/validate','POST',{items:[{productSlug:created.slug,quantity:3}]});assert.equal(cart.lines[0].quantity,2);assert.equal(cart.ceoWhatsapp,'99912345678');assert.equal(cart.changes.length,1);
  await call('admin/products/'+created.id,'PATCH',{price:13000.5});assert.equal((await call('products/'+created.slug)).price,13000.5);
  await call('admin/products/'+created.id,'PATCH',{isPublished:false});assert.equal((await fetch(api+'/products/'+created.slug)).status,404);
  await call('admin/products/'+created.id,'PATCH',{isPublished:true});
  console.log('PASS: stock revalidation, editing, unpublishing and republishing.');
  console.log('QA product ready for browser checks: '+created.slug);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
