# Natus — Binômios e registros de nascimento

## Aplicar esta versão

1. No Neon, no SQL Editor do banco usado pelo Natus, execute **db/migrations/20261020_nascimentos.sql** antes de publicar o código. A migração é aditiva e repetível: cria partos, nascimentos, altas_binomio e inclui os setores PPP, CCO e CPNI quando ausentes. Não exclui prontuários nem movimentações. As migrações anteriores de 17 e 18/10 continuam necessárias se ainda não foram aplicadas.
2. Atualize o projeto Vercel com o conteúdo da pasta `natus`. Mantenha a variável DATABASE_URL já configurada. As dependências continuam as mesmas; o ZIP não inclui node_modules. Para desenvolvimento, execute `npm ci`.
3. Configure os leitos dos setores obstétricos em Gerenciar leitos caso ainda não existam. A migração não inventa quantidades de leitos.
4. Recarregue as páginas abertas após a publicação. Valide primeiro com registros fictícios em ambiente de homologação.

Alternativa pela linha de comando, com a conexão do banco desejado configurada: `npm run db:migrate` aplica o schema e as migrações em ordem.

## Nova regra dos ALCONs

- Mãe internada + RN internado = **duas internações**, inclusive no painel, Dashboard, BI e relatórios de admissões.
- O mesmo binômio continua representando **um leito físico ocupado às 24h**.
- Alta apenas da mãe: o RN continua com **o mesmo ID e a mesma data de admissão**, mantendo evolução, prescrição e demais vínculos. Não há criação de RNCLIN.
- Na saída da mãe, marque **Alta conjunta de mãe e RN internado** para dar alta aos dois. Desmarcado, somente a mãe recebe alta. As duas saídas são gravadas na mesma transação.
- O card **Altas de binômio** conta uma alta conjunta ou a alta da mãe com RN vivo apenas vinculado, sem internação própria. No painel mostra o dia; no Dashboard, o mês.
- Altas individuais continuam no indicador de pacientes que receberam alta; não se confundem com o número de binômios.
- RNCLIN gerados pela versão anterior ficam preservados no histórico/censo e são excluídos das contagens de novas admissões pelo identificador original. Não foi feita fusão nem exclusão de registros históricos. Altas de binômio anteriores à implantação não são inferidas automaticamente.

## Registro de nascimentos

Nos setores **PPP, CCO e CPNI**, o botão **Registrar nascimento**, no topo do painel, abre o formulário baseado na aba ENTRADA da planilha PPP_CENSO_2026.xlsx.

Selecione a mãe internada. O nome, o identificador e a data de admissão vêm do cadastro existente. Os 48 campos de captura da planilha estão disponíveis: antecedentes obstétricos, Robson, profissional, pré-natal, IG, acompanhante, práticas/intervenções, HPP, nascimento, Apgar, sexo, peso, medidas, contato pele a pele, clampeamento, placenta, amamentação, posição, laceração, episiotomia, reanimação e encaminhamentos. Número de registro e mês são derivados pelo sistema. Colunas auxiliares de classificação não são solicitadas novamente.

- No CCO, o tipo é Cesárea. PPP/CPNI permitem informar o tipo do parto.
- Cada parto tem um identificador; cada RN tem outro e uma ordem. Para gemelares, registre o segundo RN com ordem 2: os dados maternos/assistenciais do primeiro registro são reutilizados.
- O vínculo nasce no cadastro do paciente, sem criar uma internação. Por isso acompanha a mãe nas transferências e aparece com o ícone de bebê no card.
- Clique no card para abrir a ficha em tela inteira, com dados da paciente, internação, integrantes do binômio e registros de parto/nascimento.
- Na ficha, **Internar este RN** permite utilizar o mesmo cadastro em um leito compatível do setor atual. A operação cria uma internação real, não outro paciente. Para transferência posterior, utilize o fluxo habitual.
- Apenas nascidos vivos podem ser internados por esse fluxo. O servidor bloqueia RN já internado e leito ocupado por outra mãe.
- A planilha anexada foi utilizada como modelo; seus registros de pacientes **não foram importados**.

## Dashboard e relatórios

Disponível nos Dashboards de PPP, CCO e CPNI e na visão geral com Todos os Setores:

- Internações maternas, partos, nascimentos, nascidos vivos e mortos.
- Tipo de parto, sexo, Robson (1 a 10), idade materna, IG, pré-natal, Apgar, peso e turno.
- Distribuições das práticas, intervenções, posição, laceração, assistência e encaminhamentos da planilha.
- Relatório diário, comparativo mensal, total/percentual anual, gráficos por categoria e gráficos mensais, exportação CSV dos indicadores.

Nascimentos usam a **data do nascimento e o setor de origem do parto**, não a data de transferência ou de admissão. Partos usam a data do primeiro nascimento daquele parto. Gemelares não duplicam o número de partos, inclusive na virada do mês. Internações maternas usam a data de entrada no setor.

Campos sem preenchimento são mostrados como **Não informado**; não se presume “Não”. Percentuais por categoria usam o total de registros do respectivo grupo (partos ou RNs), incluindo não informados. Nos gráficos mensais a barra usa o maior valor da série como escala; o valor absoluto fica visível. Turno: diurno 07h–18h59, noturno 19h–06h59 (a planilha contém os rótulos, sem regra explícita de horário).

## Validação

`npm test` executa os testes de regressão existentes, atualizados para a nova regra, e `scripts/nascimentos-test.js`, com PostgreSQL em memória (PGlite).

Cobertura: duas admissões/um leito; preservação do RN e de seu histórico após alta materna; alta conjunta atômica e sem repetição; nascimento sem internação; gemelares e virada de mês; duplicidade; validação de Apgar/data; cesárea no CCO; vínculo após transferência; contagem de altas; ACL por setor; autenticação/CSRF; sintaxe das telas; migrações repetíveis.

Não foi acessado nem alterado o banco real, nem publicado o projeto na Vercel. A execução visual em navegador não pôde ser feita neste ambiente (Chromium não instalado). A homologação visual deve conferir: botão nos três setores, preenchimento/salvamento, tela inteira e ícone após transferência, alta conjunta, contadores e filtros/exportação do Dashboard.

## Arquivos principais

- `db/migrations/20261020_nascimentos.sql`, `db/schema.sql`
- `lib/clinica.js`, `lib/nascimentos.js`, `lib/operacoes.js`, `lib/calc.js`, `lib/painel.js`, `lib/rpc.js`, `lib/regras.js`
- `public/natus-nascimentos.js`, `public/nascimentos-campos.json`
- `views/painel.html`, `views/dashboard.html`, `views/dashboardgeral.html`
- `scripts/nascimentos-test.js` e ajustes nos testes e seed existentes.
