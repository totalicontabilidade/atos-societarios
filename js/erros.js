/* Registro de erros: quando algo quebra no computador de alguém da equipe, ninguém ficava sabendo
   até a pessoa reclamar. Fica aqui, ANTES do sistema, para pegar até erro de carregamento. Guarda a
   mensagem técnica, o arquivo e a linha, a versão — e apaga da mensagem qualquer sequência de 4+
   dígitos e qualquer e-mail, para não carregar CPF, CNPJ ou contato de cliente. Até 10 por
   carregamento, sem repetir a mesma mensagem. Quem envia para a nuvem é o sistema, quando há login. */
(function(){
  var MAX=30, porCarga=0, vistos={};
  function limpa(s){ return String(s==null?"":s).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g,"@").replace(/\d{4,}/g,"#").replace(/\s+/g," ").trim().slice(0,160); }
  function guardar(msg,onde){
    msg=limpa(msg); if(!msg || vistos[msg] || porCarga>=10) return; vistos[msg]=1; porCarga++;
    var v=(document.querySelector('meta[name="versao"]')||{}).content||"";
    var modo=""; try{ modo=(window.TINA&&window.TINA._ux&&window.TINA._ux.modo)?window.TINA._ux.modo():""; }catch(_){}
    var e={em:new Date().toISOString(),msg:msg,onde:limpa(onde).slice(0,80),versao:v,modo:modo,enviado:false};
    try{ var l=JSON.parse(localStorage.getItem("tinaErros")||"[]"); l.push(e); localStorage.setItem("tinaErros",JSON.stringify(l.slice(-MAX))); }catch(_){}
    try{ if(window.__enviarErros) window.__enviarErros(); }catch(_){}
  }
  window.addEventListener("error",function(ev){
    var t=ev&&ev.target;
    if(t && t!==window){   // falha de carregamento: só script do próprio sistema interessa
      if(t.tagName==="SCRIPT" && t.src && t.src.indexOf(location.origin)===0) guardar("não carregou "+t.src.split("/").pop().split("?")[0],"carregamento");
      return; }
    guardar(ev.message||(ev.error&&ev.error.message),(String(ev.filename||"").split("/").pop()||"?")+":"+(ev.lineno||""));
  },true);
  window.addEventListener("unhandledrejection",function(ev){ var r=ev&&ev.reason; guardar("promessa rejeitada: "+((r&&r.message)||r),String((r&&r.stack)||"").split("\n")[1]||""); });
  window.__registrarErro=guardar;
})();
