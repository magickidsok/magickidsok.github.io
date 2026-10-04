/* MAGIC KIDS — CHAT ZONE ONLY
 * This file contains chat authentication, messaging and moderation.
 * PROTECTED PLAYER RULE: never place or modify player/transmission logic here.
 */
(function(){
  const CHAT_API_URL="https://magickidsok-github-io.elmagickids.workers.dev";
  const CHAT_API_BASES=[location.origin,CHAT_API_URL].filter(function(v,i,a){return v&&a.indexOf(v)===i;});
  let authMode="login",currentUser=null,pollTimer=null,heartbeatTimer=null,lastMessagesSignature="";

  const $=id=>document.getElementById(id);
  function esc(v){return String(v??"").replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];});}
  function setAuthMsg(msg,type){
    const el=$("customChatAuthMsg");if(!el)return;
    el.className="customChatAuthMsg"+(type?" "+type:"");el.textContent=msg||"";
  }
  async function api(path,options){
    options=options||{};
    let lastError=null;
    for(const base of CHAT_API_BASES){
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),12000);
      const req={credentials:"include",signal:controller.signal,headers:Object.assign({"Content-Type":"application/json"},options.headers||{}),method:options.method||"GET"};
      if(options.body!==undefined)req.body=options.body;
      try{
        const res=await fetch(base+path,req);
        let data={};try{data=await res.json();}catch(e){}
        if(!res.ok){
          if(res.status===404&&base===location.origin)continue;
          throw new Error(data.error||("El servidor respondió con error ("+res.status+")."));
        }
        return data;
      }catch(e){
        lastError=e;
      }finally{clearTimeout(timeout);}
    }
    if(lastError&&lastError.name==="AbortError")throw new Error("El chat tardó demasiado en responder. Probá nuevamente.");
    if(lastError&&lastError.message==="Failed to fetch")throw new Error("No se pudo conectar con el servidor del chat. Probá nuevamente en unos segundos.");
    throw lastError||new Error("No se pudo conectar con el chat.");
  }
  function setAuthMode(mode){
    authMode=mode;
    const admin=mode==="admin";
    $("customLoginTab").classList.toggle("active",!admin);
    $("customAdminTab").classList.toggle("active",admin);
    $("customUserAuth").classList.toggle("hidden",admin);
    $("customAdminAuth").classList.toggle("hidden",!admin);
    if(admin){$("customAdminPin").focus();}
    setAuthMsg("");
  }
  function setUserMode(register){
    authMode=register?"register":"login";
    $("customUserLoginTab").classList.toggle("active",!register);
    $("customRegisterTab").classList.toggle("active",register);
    $("customChatNick").classList.toggle("hidden",!register);
    $("customChatPassword2").classList.toggle("hidden",!register);
    $("customChatAuthBtn").textContent=register?"CREAR CUENTA":"INICIAR SESIÓN";
    $("customChatPassword").autocomplete=register?"new-password":"current-password";
    setAuthMsg("");
  }
  async function register(){
    const nick=$("customChatNick").value.trim().replace(/\s+/g," ").slice(0,24);
    const email=$("customChatEmail").value.trim().toLowerCase();
    const password=$("customChatPassword").value,password2=$("customChatPassword2").value;
    if(nick.length<3){setAuthMsg("El nick debe tener al menos 3 caracteres.","error");return;}
    if(nick.replace(/[^A-Za-z0-9]/g,"").toUpperCase()==="MAGICKIDS"){setAuthMsg("Ese nick está reservado para el administrador.","error");return;}
    if(!email.includes("@")){setAuthMsg("Escribí un correo válido.","error");return;}
    if(password.length<6){setAuthMsg("La contraseña debe tener al menos 6 caracteres.","error");return;}
    if(password!==password2){setAuthMsg("Las contraseñas no coinciden.","error");return;}
    const btn=$("customChatAuthBtn");btn.disabled=true;
    try{const data=await api("/api/register",{method:"POST",body:JSON.stringify({nick:nick,email:email,password:password})});setAuthMsg("Cuenta creada. Entrando…","ok");setUserMode(false);await enterChat(data.user);}
    catch(e){setAuthMsg(e.message||"No se pudo crear la cuenta.","error");}
    finally{btn.disabled=false;}
  }
  async function login(){
    const email=$("customChatEmail").value.trim().toLowerCase(),password=$("customChatPassword").value;
    if(!email||!password){setAuthMsg("Completá correo y contraseña.","error");return;}
    const btn=$("customChatAuthBtn");btn.disabled=true;
    try{const data=await api("/api/login",{method:"POST",body:JSON.stringify({email:email,password:password})});await enterChat(data.user);}
    catch(e){setAuthMsg(e.message||"No se pudo iniciar sesión.","error");}
    finally{btn.disabled=false;}
  }
  async function adminLogin(){
    const pin=$("customAdminPin").value.trim();
    if(!/^\d{4}$/.test(pin)){setAuthMsg("Ingresá el PIN de 4 dígitos del panel privado.","error");return;}
    const btn=$("customAdminLoginBtn");btn.disabled=true;
    try{const data=await api("/api/admin/login",{method:"POST",body:JSON.stringify({pin:pin})});$("customAdminPin").value="";await enterChat(data.user);}
    catch(e){setAuthMsg(e.message||"No se pudo ingresar como administrador.","error");}
    finally{btn.disabled=false;}
  }
  async function enterChat(user){
    currentUser=user;
    $("customChatAuth").classList.add("hidden");
    $("customChatApp").classList.remove("hidden");
    $("customChatUser").textContent=user.nick;
    $("customChatRole").textContent=user.isAdmin?"ADMIN ✓":"USUARIO";
    $("customChatRole").classList.toggle("admin",!!user.isAdmin);
    $("customChatCrown").classList.toggle("hidden",!user.isAdmin);
    await refreshMessages();await refreshOnline();startTimers();
  }
  function renderMessages(messages){
    const box=$("customChatMessages");
    box.innerHTML=messages.map(function(m){
      const mod=currentUser&&currentUser.isAdmin?'<span class="customChatMod"><button data-delete="'+m.id+'">BORRAR</button><button data-ban="'+esc(m.userId)+'">BANEAR</button></span>':"";
      const crown=m.isAdmin?'<span class="customChatCrownMini">👑</span>':"";
      return '<div class="customChatMsg"><div class="customChatMeta">'+crown+esc(m.nick)+" · "+new Date(m.createdAt).toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"})+mod+'</div><div class="customChatText">'+esc(m.text)+"</div></div>";
    }).join("");
    box.scrollTop=box.scrollHeight;
  }
  async function refreshMessages(){
    if(!currentUser)return;
    try{const data=await api("/api/messages?limit=80");const signature=JSON.stringify(data.messages);if(signature!==lastMessagesSignature){lastMessagesSignature=signature;renderMessages(data.messages);}}catch(e){}
  }
  async function refreshOnline(){
    if(!currentUser)return;
    try{const data=await api("/api/online");$("customChatOnline").textContent="👥 "+data.count+" conectado"+(data.count===1?"":"s");}catch(e){}
  }
  function startTimers(){
    clearInterval(pollTimer);clearInterval(heartbeatTimer);
    pollTimer=setInterval(refreshMessages,2000);
    heartbeatTimer=setInterval(async function(){try{await api("/api/heartbeat",{method:"POST",body:"{}"});await refreshOnline();}catch(e){}},10000);
  }
  async function send(){
    if(!currentUser)return;
    const input=$("customChatText"),text=input.value.trim();if(!text)return;
    const btn=$("customChatSend");btn.disabled=true;
    try{await api("/api/messages",{method:"POST",body:JSON.stringify({text:text})});input.value="";await refreshMessages();}
    catch(e){setAuthMsg(e.message||"No se pudo enviar el mensaje.","error");}
    finally{btn.disabled=false;}
  }
  async function logout(){
    try{await api("/api/logout",{method:"POST",body:"{}"});}catch(e){}
    clearInterval(pollTimer);clearInterval(heartbeatTimer);currentUser=null;lastMessagesSignature="";
    $("customChatAuth").classList.remove("hidden");$("customChatApp").classList.add("hidden");
    setUserMode(false);setAuthMsg("");
  }
  async function moderate(action,id){
    if(!currentUser||!currentUser.isAdmin)return;
    try{const payload=action==="delete"?{id:Number(id)}:{userId:id};await api("/api/admin/"+action,{method:"POST",body:JSON.stringify(payload)});await refreshMessages();}
    catch(e){setAuthMsg(e.message||"No se pudo moderar.","error");}
  }
  async function init(){
    setAuthMode("login");setUserMode(false);
    $("customLoginTab").onclick=function(){setAuthMode("login");};
    $("customAdminTab").onclick=function(){setAuthMode("admin");};
    $("customUserLoginTab").onclick=function(){setUserMode(false);};
    $("customRegisterTab").onclick=function(){setUserMode(true);};
    $("customChatAuthBtn").onclick=function(){authMode==="register"?register():login();};
    $("customAdminLoginBtn").onclick=adminLogin;
    $("customChatPassword").addEventListener("keydown",function(e){if(e.key==="Enter")(authMode==="register"?register:login)();});
    $("customChatPassword2").addEventListener("keydown",function(e){if(e.key==="Enter")register();});
    $("customAdminPin").addEventListener("keydown",function(e){if(e.key==="Enter")adminLogin();});
    $("customChatSend").onclick=send;
    $("customChatText").addEventListener("keydown",function(e){if(e.key==="Enter"){e.preventDefault();send();}});
    $("customChatLogout").onclick=logout;
    $("customChatMessages").addEventListener("click",function(e){if(e.target.dataset.delete)moderate("delete",e.target.dataset.delete);if(e.target.dataset.ban)moderate("ban",e.target.dataset.ban);});
    try{const data=await api("/api/me");if(data.user)await enterChat(data.user);}catch(e){}
  }
  document.addEventListener("DOMContentLoaded",init);
})();
