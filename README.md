# Vestiário — Liga virtual

Painel para organizar competições de futebol com contas de administrador e managers vinculados a clubes.

## Rodar no computador

1. Instale o Node.js 20 ou mais recente.
2. Abra um terminal nesta pasta e execute `npm install` uma vez.
3. Execute `npm run dev`.
4. Abra o endereço mostrado no terminal, normalmente `http://localhost:3000`.
5. Se a porta 3000 já estiver em uso, o Vestiário tentará iniciar na 3001 e mostrará o endereço correto.

Para abrir em um celular ou computador conectado à mesma rede Wi-Fi, use o endereço de rede local que aparece no terminal. O computador que executa o Vestiário precisa continuar ligado. Para acessar de redes diferentes, publique o projeto em um servidor com HTTPS.

Não há dependências externas para instalar; `npm install` é opcional.

## Primeira configuração

Na primeira abertura, crie a conta administradora. O administrador pode criar competições e clubes. Se esta pasta já tinha dados locais do navegador, eles são importados nessa configuração inicial.

Na área **Managers**, escolha um clube e informe o nome do responsável. O painel cria um código e um link de convite de uso único, válido por 7 dias. Envie o link ou o código junto com o endereço do painel. A pessoa abre o convite em seu aparelho, escolhe o próprio usuário e senha e passa a gerenciar o clube associado.

Managers podem cuidar do próprio elenco, anunciar e negociar jogadores, acompanhar partidas do time e movimentar o saldo conforme as regras do painel. O administrador mantém a configuração das competições, dos clubes e do calendário.

## Dados e hospedagem

No computador, as contas e os dados da liga ficam em `data/arena.json`. Faça cópia desse arquivo para backup e não o compartilhe nem o publique.

Na versão hospedada, contas, sessões, convites e dados da liga ficam no banco Neon conectado ao Vercel. Assim, managers podem entrar de outros celulares e computadores e compartilhar as atualizações da liga. O projeto usa o plano gratuito do Neon.

As sessões expiram em 7 dias. A implantação pública começa sem campeonatos, clubes ou saldos; crie a conta administradora e configure a liga pelo painel.

O cadastro de jogadores é feito pela liga; uma base mundial atualizada de atletas ainda não está conectada.
