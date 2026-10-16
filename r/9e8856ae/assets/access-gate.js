(function () {
  'use strict';
  const element=document.querySelector('#xiyou-encrypted-content');
  if(!element)return;
  const payload=JSON.parse(element.textContent),form=document.querySelector('#access-password-form'),input=document.querySelector('#access-password'),message=document.querySelector('#password-error'),button=form.querySelector('button');
  const bytes=value=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
  const cacheKey='xiyou-access-key:'+payload.releaseId;
  async function decrypt(key,encrypted){
    if(encrypted.xiyouEncrypted!==1||encrypted.releaseId!==payload.releaseId)throw new Error('wrong release');
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(encrypted.iv),additionalData:new TextEncoder().encode(encrypted.releaseId)},key,bytes(encrypted.ciphertext));
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));
  }
  async function open(key){
    const content=await decrypt(key,payload);
    if(typeof content.html!=='string'||typeof content.config!=='string')throw new Error('invalid content');
    window.XIYOU_ACCESS_CONTEXT={decryptConfig:async source=>(await decrypt(key,JSON.parse(source))).config};
    try{const raw=new Uint8Array(await crypto.subtle.exportKey('raw',key));sessionStorage.setItem(cacheKey,btoa(String.fromCharCode(...raw)));}catch{}
    const config=content.config.replace(/<\/script/gi,'<\\/script');
    const html=content.html.replace(/<script\b[^>]*\bsrc=["']site-config\.js[^"']*["'][^>]*>\s*<\/script>/i,()=>'<script>'+config+'</script>');
    if(html===content.html)throw new Error('configuration tag missing');
    document.open();document.write(html);document.close();
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();button.disabled=true;message.textContent='正在验证…';
    try{
      if(!crypto.subtle)throw new Error('secure browser required');
      const password=input.value.replace(/[\s-]/g,'').toUpperCase();
      const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
      const key=await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:bytes(payload.salt),iterations:payload.iterations},material,{name:'AES-GCM',length:256},true,['decrypt']);
      await open(key);
    }catch{message.textContent='密码不正确，请核对本次发布密码。';button.disabled=false;input.focus();}
  });
  try{const cached=sessionStorage.getItem(cacheKey);if(cached)void crypto.subtle.importKey('raw',bytes(cached),{name:'AES-GCM'},true,['decrypt']).then(open).catch(()=>{try{sessionStorage.removeItem(cacheKey);}catch{}});}catch{}
})();
