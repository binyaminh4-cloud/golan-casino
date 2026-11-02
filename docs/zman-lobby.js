// One read-only readiness request. Do not show an unavailable money game before its SQL is installed.
(async function () {
 const card=document.getElementById('zlmLobbyCard');if(!card)return;
 try{
  if(!/[?&]preview(?:[=&]|$)/.test(location.search)){
   const {data:{session}}=await db.auth.getSession();if(!session)return;
   const {data,error}=await db.rpc('zlm_ready');if(error||data!==1)return;
  }
  card.style.removeProperty('display');
  window.dispatchEvent(new Event('zlm-ready'));
 }catch{ /* Remain hidden until a later successful lobby load. */ }
})();
