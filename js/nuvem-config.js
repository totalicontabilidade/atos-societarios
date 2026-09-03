/* ============================================================
   Atos Societários · Totali
   nuvem-config.js — endereço do projeto no Firebase

   Estas chaves são PÚBLICAS por natureza: elas dizem apenas
   "qual projeto", não dão permissão nenhuma. Quem decide o que
   cada pessoa pode ler e escrever são as regras do Firestore
   (arquivo firestore.rules, na raiz do repositório).

   O que NUNCA pode entrar aqui: chave de conta de serviço
   (a que começa com "-----BEGIN PRIVATE KEY"), token do Admin
   SDK, ou a chave privada de emissão de licença.

   COMO PREENCHER
   --------------
   1. console.firebase.google.com → Adicionar projeto
      (sugestão de nome: "totali-atos-societarios").
   2. No projeto: Criar banco de dados Firestore → modo produção.
   3. Autenticação → Sign-in method → ativar E-mail/senha.
      IMPORTANTE: em Configurações → "Ações do usuário",
      DESMARQUE "Ativar criação de conta (inscrição)". Só quem
      você cadastrar à mão entra.
   4. Configurações do projeto → Seus apps → Web (</>) → copie
      o objeto de configuração e cole abaixo.
   5. Publique as regras ANTES de usar o app (firestore.rules).
      Regra primeiro, código depois — na ordem inversa, toda
      gravação é recusada e parece bug do sistema.
   6. Authentication → Users → adicione as contas da equipe e,
      no Firestore, crie um documento em "equipe" com o ID igual
      ao UID de cada pessoa (campo "nome" e campo "ativo": true).
   ============================================================ */
window.ATOS_FIREBASE = {
  apiKey: "AIzaSyAa9UoPU8jbqlBX9r1E2C44hXZfJq0l_04",
  authDomain: "atos-societarios.firebaseapp.com",
  projectId: "atos-societarios",
  storageBucket: "atos-societarios.firebasestorage.app",
  messagingSenderId: "127923457771",
  appId: "1:127923457771:web:2cc5ffadfa425a80cb38ae"
};
