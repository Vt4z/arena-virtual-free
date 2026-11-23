# Vestiário — Liga virtual

Painel para organizar competições de futebol com contas de administrador e managers vinculados a clubes.

## Iniciar

1. Instale o Node.js 20 ou mais recente.
2. Abra um terminal nesta pasta e execute `npm run dev`.
3. Abra no computador o endereço mostrado no terminal, normalmente `http://localhost:3000`.
4. Se a porta 3000 já estiver em uso, o Vestiário tentará iniciar na 3001 e mostrará o endereço correto.

Para abrir em um celular ou computador conectado à mesma rede Wi-Fi, use o endereço de rede local que aparece no terminal. O computador que executa o Vestiário precisa continuar ligado. Para acessar de redes diferentes, publique o projeto em um servidor com HTTPS.

Não há dependências externas para instalar; `npm install` é opcional.

## Primeira configuração

Na primeira abertura, crie a conta administradora. O administrador pode criar competições e clubes. Se esta pasta já tinha dados locais do navegador, eles são importados nessa configuração inicial.

Na área **Managers**, escolha um clube e informe o nome do responsável. O painel cria um código e um link de convite de uso único, válido por 7 dias. Envie o link ou o código junto com o endereço do painel. A pessoa abre o convite em seu aparelho, escolhe o próprio usuário e senha e passa a gerenciar o clube associado.

Managers podem cuidar do próprio elenco, anunciar e negociar jogadores, acompanhar partidas do time e movimentar o saldo conforme as regras do painel. O administrador mantém a configuração das competições, dos clubes e do calendário.

## Dados

As contas, senhas protegidas e dados da liga ficam no arquivo `data/arena.json` criado pelo servidor. Faça cópia desse arquivo para backup. Não compartilhe nem publique esse arquivo.

As sessões ficam no servidor e expiram em 7 dias. Em uma hospedagem pública, configure HTTPS, mantenha o arquivo de dados em armazenamento persistente e restrinja o acesso administrativo inicial.

O cadastro de jogadores é feito pela liga; uma base mundial atualizada de atletas ainda não está conectada.
