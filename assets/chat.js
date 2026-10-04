/* MAGIC KIDS — CHAT ZONE ONLY
 * Chat authentication, messages and moderation.
 * PROTECTED PLAYER RULE: this file never controls the player or transmission.
 */
(function(){
  const CHAT_API_URL="https://magickidsok-github-io.elmagickids.workers.dev";
  const TOKEN_KEY="mk_chat_token_v2";
  let mode="login",currentUser=null,pollTimer=null,heartbeatTimer=null,lastSignature="";

  const $=id=>document.getElementById(id);
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const token=()=>localStorage.getItem(TOKEN_KEY)||"";
  function saveToken(v){if(v)localStorage.setItem(TOKEN_KEY,v);}
  function clearToken(){localStorage.removeItem(TOKEN_KEY);}
  function msg(text,type){const e=$("customChatAuthMsg");if(!e)return;e.className="customChatAuthMsg "+(type||"");e.textContent=text||"";}

  async function api(path,options){
    options=options||{};
    const headers=Object.assign({"Content-Type":"application/json"},options.headers||{});
    const t=token();if(t)headers.Authorization="Bearer "+t;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    try{
      const res=await fetch(CHAT_API_URL+path,{
        method:options.method||"GET",body:options.body,headers,
        credentials:"omit",cache:"no-store",signal:controller.signal
      });
      let data={};try{data=await res.json();}catch(e){}
      if(!res.ok){
        if(res.status===401&&path!=="/api/login"&&path!=="/api/register"&&path!=="/api/admin/login"){
          clearToken();currentUser=null;showAuth();msg("Tu sesión terminó. Volvé a ingresar.","error");
        }
        throw new Error(data.error||("El servidor respondió con error ("+res.status+")."));
      }
      return data;
    }catch(e){
      if(e.name==="AbortError")throw new Error("El chat tardó demasiado en responder. Probá nuevamente.");
      if(/Failed to fetch|NetworkError|Load failed/i.test(e.message||""))throw new Error("No se pudo conectar con el servidor del chat.");
      throw e;
    }finally{clearTimeout(timer);}
  }

  function showAuth(){
    $("customChatAuth")?.classList.remove("hidden");
    $("customChatApp")?.classList.add("hidden");
  }
  function showApp(user){
    currentUser=user;
    $("customChatAuth")?.classList.add("hidden");
    $("customChatApp")?.classList.remove("hidden");
    $("customChatUser").textContent=user.nick||"Usuario";
    $("customChatRole").textContent=user.isAdmin?"ADMINISTRADOR":"USUARIO";
    $("customChatRole").classList.toggle("admin",!!user.isAdmin);
    $("customChatCrown").classList.toggle("hidden",!user.isAdmin);
    $("customChatAdminPanel").classList.toggle("hidden",!user.isAdmin);
    refreshMessages();refreshOnline();startTimers();
  }

  function setMode(next){
    mode=next;
    const admin=next==="admin",register=next==="register";
    $("customLoginTab").classList.toggle("active",!admin);
    $("customAdminTab").classList.toggle("active",admin);
    $("customUserAuth").classList.toggle("hidden",admin);
    $("customAdminAuth").classList.toggle("hidden",!admin);
    $("customUserLoginTab").classList.toggle("active",!register);
    $("customRegisterTab").classList.toggle("active",register);
    $("customChatNick").classList.toggle("hidden",!register);
    $("customChatPassword2").classList.toggle("hidden",!register);
    $("customChatAuthBtn").textContent=register?"CREAR CUENTA":"ENTRAR AL CHAT";
    $("customChatPassword").autocomplete=register?"new-password":"current-password";
    msg("");
    if(admin)$("customAdminPin").focus();else $("customChatEmail").focus();
  }

  function badNick(nick){
    return /MAGIC/i.test(nick);
  }

  async function register(){
    const nick=$("customChatNick").value.trim().replace(/s+/g," ").slice(0,24);
    const email=$("customChatEmail").value.trim().toLowerCase();
    const password=$("customChatPassword").value;
    const password2=$("customChatPassword2").value;
    if(nick.length<3)return msg("El nick debe tener al menos 3 caracteres.","error");
    if(badNick(nick))return msg("Ese nick no está permitido. No podés usar MAGIC ni MAGIC KIDS.","error");
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return msg("Escribí un correo válido.","error");
    if(password.length<6)return msg("La contraseña debe tener al menos 6 caracteres.","error");
    if(password!==password2)return msg("Las contraseñas no coinciden.","error");
    const b=$("customChatAuthBtn");b.disabled=true;
    try{
      const data=await api("/api/register",{method:"POST",body:JSON.stringify({nick,email,password})});
      saveToken(data.token);msg("Cuenta creada. Entrando…","ok");showApp(data.user);
    }catch(e){msg(e.message||"No se pudo crear la cuenta.","error");}
    finally{b.disabled=false;}
  }

  async function login(){
    const email=$("customChatEmail").value.trim().toLowerCase(),password=$("customChatPassword").value;
    if(!email||!password)return msg("Completá correo y contraseña.","error");
    const b=$("customChatAuthBtn");b.disabled=true;
    try{
      const data=await api("/api/login",{method:"POST",body:JSON.stringify({email,password})});
      saveToken(data.token);showApp(data.user);
    }catch(e){msg(e.message||"No se pudo entrar al chat.","error");}
    finally{b.disabled=false;}
  }

  async function adminLogin(){
    const pin=$("customAdminPin").value.trim();
    if(!/^\d{4}$/.test(pin))return msg("Ingresá el PIN de 4 dígitos.","error");
    const b=$("customAdminLoginBtn");b.disabled=true;
    try{
      const data=await api("/api/admin/login",{method:"POST",body:JSON.stringify({pin})});
      saveToken(data.token);$("customAdminPin").value="";showApp(data.user);
    }catch(e){msg(e.message||"No se pudo entrar como administrador.","error");}
    finally{b.disabled=false;}
  }

  function renderMessages(messages){
    const box=$("customChatMessages");
    box.innerHTML=(messages||[]).map(m=>{
      const mod=currentUser?.isAdmin?'<span class="customChatMod"><button data-delete="'+m.id+'">BORRAR</button><button data-ban="'+esc(m.userId)+'">BLOQUEAR</button></span>':"";
      const crown=m.isAdmin?'<span class="customChatCrownMini">👑</span>':"";
      return '<div class="customChatMsg"><div class="customChatMeta">'+crown+esc(m.nick)+" · "+new Date(m.createdAt).toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"})+mod+'</div><div class="customChatText">'+esc(m.text)+"</div></div>";
    }).join("");
    box.scrollTop=box.scrollHeight;
  }

  async function refreshMessages(){
    if(!currentUser)return;
    try{
      const data=await api("/api/messages?limit=80"),signature=JSON.stringify(data.messages);
      if(signature!==lastSignature){lastSignature=signature;renderMessages(data.messages);}
    }catch(e){}
  }
  async function refreshOnline(){
    if(!currentUser)return;
    try{const data=await api("/api/online");$("customChatOnline").textContent="👥 "+data.count+" conectado"+(data.count===1?"":"s");}catch(e){}
  }
  function startTimers(){
    clearInterval(pollTimer);clearInterval(heartbeatTimer);
    pollTimer=setInterval(refreshMessages,3500);
    heartbeatTimer=setInterval(async()=>{try{await api("/api/heartbeat",{method:"POST",body:"{}"});await refreshOnline();}catch(e){}},15000);
  }
  async function send(){
    const input=$("customChatText"),text=input.value.trim();
    if(!currentUser||!text)return;
    const b=$("customChatSend");b.disabled=true;
    try{await api("/api/messages",{method:"POST",body:JSON.stringify({text})});input.value="";await refreshMessages();}
    catch(e){msg(e.message||"No se pudo enviar el mensaje.","error");}
    finally{b.disabled=false;}
  }
  async function moderate(action,id){
    if(!currentUser?.isAdmin)return;
    try{
      await api("/api/admin/"+action,{method:"POST",body:JSON.stringify(action==="delete"?{id:Number(id)}:{userId:id})});
      await refreshMessages();
    }catch(e){msg(e.message||"No se pudo realizar la acción.","error");}
  }
  async function logout(){
    try{await api("/api/logout",{method:"POST",body:"{}"});}catch(e){}
    clearToken();clearInterval(pollTimer);clearInterval(heartbeatTimer);currentUser=null;lastSignature="";
    showAuth();setMode("login");msg("");
  }

  async function restore(){
    const t=token();if(!t)return;
    try{const data=await api("/api/me");if(data.user)showApp(data.user);else clearToken();}
    catch(e){clearToken();}
  }

  document.addEventListener("DOMContentLoaded",function(){
    $("customLoginTab").onclick=()=>setMode("login");
    $("customAdminTab").onclick=()=>setMode("admin");
    $("customUserLoginTab").onclick=()=>setMode("login");
    $("customRegisterTab").onclick=()=>setMode("register");
    $("customChatAuthBtn").onclick=()=>mode==="register"?register():login();
    $("customAdminLoginBtn").onclick=adminLogin;
    $("customChatPassword").addEventListener("keydown",e=>{if(e.key==="Enter")mode==="register"?register():login();});
    $("customChatPassword2").addEventListener("keydown",e=>{if(e.key==="Enter")register();});
    $("customAdminPin").addEventListener("keydown",e=>{if(e.key==="Enter")adminLogin();});
    $("customChatSend").onclick=send;
    $("customChatText").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();send();}});
    $("customChatLogout").onclick=logout;
    $("customChatMessages").addEventListener("click",e=>{
      if(e.target.dataset.delete)moderate("delete",e.target.dataset.delete);
      if(e.target.dataset.ban)moderate("ban",e.target.dataset.ban);
    });
    setMode("login");
    restore();
  });
})();