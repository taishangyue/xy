(function () {
  'use strict';
  const element=document.querySelector('#xiyou-encrypted-content');
  if(!element)return;
  const payload=JSON.parse(element.textContent),form=document.querySelector('#access-password-form'),input=document.querySelector('#access-password'),message=document.querySelector('#password-error'),button=form.querySelector('button');
  const bytes=value=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
  const cacheKey='xiyou-access-key:'+payload.releaseId;
  const remember=document.querySelector('#remember-access');
  const rememberHelp=document.querySelector('#remember-help');
  const cachePrefix='xiyou-access-key:';
  function readCache(storage){try{return storage.getItem(cacheKey);}catch{return null;}}
  function removeCache(storage){try{storage.removeItem(cacheKey);}catch{}}
  function cache(key,remembered){
    const value=btoa(String.fromCharCode(...key));
    try{sessionStorage.setItem(cacheKey,value);}catch{}
    try{
      if(remembered)localStorage.setItem(cacheKey,value);else localStorage.removeItem(cacheKey);
      for(const name of Object.keys(localStorage))if(name.startsWith(cachePrefix)&&name!==cacheKey)localStorage.removeItem(name);
    }catch{}
    try{for(const name of Object.keys(sessionStorage))if(name.startsWith(cachePrefix)&&name!==cacheKey)sessionStorage.removeItem(name);}catch{}
  }
  try{
    const probe='xiyou-access-storage-probe';localStorage.setItem(probe,'1');localStorage.removeItem(probe);
  }catch{
    if(remember)remember.disabled=true;
    if(rememberHelp)rememberHelp.textContent='当前浏览器无法保存密码，本次仍可正常进入。';
  }
  async function decrypt(key,encrypted){
    if(encrypted.xiyouEncrypted!==1||encrypted.releaseId!==payload.releaseId)throw new Error('wrong release');
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(encrypted.iv),additionalData:new TextEncoder().encode(encrypted.releaseId)},key,bytes(encrypted.ciphertext));
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));
  }
  async function open(key,remembered){
    const content=await decrypt(key,payload);
    if(typeof content.html!=='string'||typeof content.config!=='string')throw new Error('invalid content');
    const config=content.config.replace(/<\/script/gi,'<\\/script');
    const html=content.html.replace(/<script\b[^>]*\bsrc=["']site-config\.js[^"']*["'][^>]*>\s*<\/script>/i,()=>'<script>'+config+'</script>');
    if(html===content.html)throw new Error('configuration tag missing');
    window.XIYOU_ACCESS_CONTEXT={decryptConfig:async source=>(await decrypt(key,JSON.parse(source))).config};
    cache(new Uint8Array(await crypto.subtle.exportKey('raw',key)),remembered);
    document.open();document.write(html);document.close();
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();button.disabled=true;message.textContent='正在验证…';
    try{
      if(!crypto.subtle)throw new Error('secure browser required');
      const password=input.value.replace(/[\s-]/g,'').toUpperCase();
      const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
      const key=await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:bytes(payload.salt),iterations:payload.iterations},material,{name:'AES-GCM',length:256},true,['decrypt']);
      await open(key,!!remember?.checked);
    }catch{message.textContent='密码不正确，请核对本次发布密码。';button.disabled=false;input.focus();}
  });
  async function restore(){
    button.disabled=true;
    try{
      let persistent=null,session=null;
      try{persistent=readCache(localStorage);}catch{}
      try{session=readCache(sessionStorage);}catch{}
      for(const [value,isPersistent] of [[session,false],[persistent,true]]){
        if(!value)continue;
        try{
          const key=await crypto.subtle.importKey('raw',bytes(value),{name:'AES-GCM'},true,['decrypt']);
          await open(key,!!persistent);return;
        }catch{
          try{removeCache(isPersistent?localStorage:sessionStorage);}catch{}
        }
      }
    }finally{if(form.isConnected)button.disabled=false;}
  }
  void restore();
})();
