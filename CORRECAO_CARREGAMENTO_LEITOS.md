# Correção do carregamento dos leitos — 18/10/2026

A captura confirma registros na tabela de leitos. Ela não permite identificar a resposta da API ou confirmar a existência das novas colunas/tabelas. Não houve acesso ao banco publicado ou aos logs da Vercel.

Foi reproduzida uma falha introduzida na atualização anterior: a leitura de todas as internações passou a depender de `internacoes.encerrada_em` e `trocas_leito`. Se uma dessas estruturas não existe, a consulta do painel inteiro falha, embora os leitos estejam cadastrados. Além disso, a migração anterior criava um índice em `trocas_leito` sem garantir previamente que a tabela existisse; nesse caso, a transação era revertida.

## O que foi corrigido

- A migração agora cria os pré-requisitos ausentes da auditoria e da exclusão lógica SOAP. Pode ser executada novamente.
- O painel operacional pode carregar os leitos e pacientes quando faltar especificamente a estrutura nova do histórico. Exibe aviso de migração pendente; não oculta outros erros nem transforma indicadores desconhecidos em zero.
- No ALCON, os indicadores de admissões dependentes desse histórico mostram “—” até a migração. Ocupação atual e grade de leitos continuam visíveis. Relatórios históricos exigem a migração, para não apresentar valores incorretos.
- O aviso fica abaixo do cabeçalho, fora da barra lateral. Em falhas da API, mostra a mensagem segura recebida, em vez de esconder o motivo atrás de um aviso genérico.
- O script de comunicação recebe uma URL versionada e revalidação de cache. Isso evita reutilizar um script anterior à mudança de autenticação/CSRF.
- Mantidas as correções anteriores de ALCON, indicadores, segurança e histórico clínico.

## Como aplicar

1. Faça backup e execute no SQL Editor do Neon **`db/migrations/20261017_alcon_seguranca.sql` deste novo pacote**. É a versão corrigida do mesmo arquivo. Não apague nem reimporte os leitos.
2. Publique este pacote completo na Vercel.
3. Abra novamente o sistema, faça login e atualize a página com **Ctrl+F5**.

Se o aviso informar migração pendente, confirme que o SQL foi executado com sucesso no mesmo banco/branch usado em `DATABASE_URL` na Vercel. Se houver outra falha, a mensagem exibida no painel permite investigar a resposta real; a captura isolada do cadastro de leitos não confirma a causa em produção.

## Validação

`npm test`: passou, incluindo reprodução de banco legado sem auditoria, carregamento de leitos com aviso, indicadores indisponíveis sinalizados, migração repetível, restauração do histórico e regressões anteriores de ALCON/sessão/SOAP/API.

Teste de interface em Chromium: leitos visíveis com estrutura histórica ausente, aviso fora da barra lateral e retorno dos indicadores após restaurar a estrutura.

A publicação e a execução no Neon são etapas do ambiente do usuário; não foram realizadas por esta revisão.
