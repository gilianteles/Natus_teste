# Natus — Gestão Inteligente de Leitos
Maternidade Ana Braga (MAB) · Manaus-AM · Censo hospitalar, fluxo entre setores, NIR, indicadores e relatórios.

Versão para **Vercel + GitHub + PostgreSQL em nuvem** (portada do projeto Google Apps Script/Planilhas). As telas, regras de
negócio (UEN/vaga zero, binômio ALCON, censo às 24h, mortalidade, Método Canguru etc.) e os endpoints têm os mesmos nomes do original.

## Arquitetura
| Camada | Onde |
|---|---|
| Front-end (telas Bootstrap/Chart.js) | `views/*.html` + `public/` (renderizadas por `api/page.js`) |
| API | `api/rpc/[fn].js` (`POST /api/rpc/<função>`, `Authorization: Bearer <token>`) |
| Regras de negócio | `lib/` (`calc.js` indicadores · `operacoes.js` escritas · `painel.js` · `qualidade.js` · `historico.js` · `acr.js` acolhimento · `kanban.js` regulação) |
| Banco | `db/schema.sql` (PostgreSQL, com chaves estrangeiras, índices e unicidade) |

`public/natus-rpc.js` recria `google.script.run` sobre `fetch`, por isso as telas quase não foram alteradas.

## Interface (design system)
- **Tema claro/escuro** (botão no trilho lateral; segue o sistema operacional até o usuário escolher; preferência salva no navegador).
- Fundo `#F4F5F7`, cards brancos flutuantes (`border-radius: 20px`, borda sutil, sombra leve), tipografia **Plus Jakarta Sans**.
- Trilho lateral compacto com ícones (vira barra inferior no celular), KPIs, gráficos de tendência/distribuição (Chart.js) e cards de leitos por situação.
- Tudo em `public/natus-ui.css` (tokens `--primary`, `--card`, `--bg`…), `public/natus-ui.js` (tema, gráficos, trilho) e `lib/shell.js` (trilho por perfil). Para trocar a paleta, edite só os tokens no início do CSS.
- Os módulos novos (ACR e Kanban) usam `public/natus-modulos.css` para os estilos próprios, sem tocar na base existente.

## Módulos das fases de evolução
### FASE 1 — ACR (Acolhimento com Classificação de Risco) · `/?view=acr`
- Nova tela de porta de entrada (`views/acr.html` + `public/natus-acr.js`) com **busca rápida por CPF e Cartão SUS**
  (`buscarPacientePorDocumento`): ao encontrar, preenche Nome/Data de Nascimento/CPF/Cartão SUS/Telefone; ao **não** encontrar,
  limpa o formulário para um cadastro rápido. Registra o atendimento em `acr_atendimentos` com classificação de risco
  (Vermelho…Azul), queixa, destino e situação, exibindo KPIs e a fila do dia.
- A tabela `pacientes` ganhou `cpf`, `cartao_sus` e `telefone` (índices únicos normalizados por dígitos). `registrarInternacao`
  **reaproveita o cadastro** quando o CPF/SUS confere, evitando paciente duplicado e ligando a internação ao atendimento do ACR.
- Acesso: qualquer colaborador autenticado — a recepção do acolhimento é aberta por decisão de projeto e o cadastro fica auditado
  em `logs`. Para restringir, ajuste `exigirACR()` em `lib/auth.js`.

### FASE 2 — Kanban de Regulação (NIR) · `/?view=kanban`
- Quadro (`views/kanban.html` + `public/natus-kanban.js`) com as colunas **Aguardando Avaliação (Triagem/ACR)**,
  **Internado / Ativo**, **Aguardando Documentação** e **Pronto para Alta / Transferência**, com **arrastar e soltar** (`moverCardKanban`).
- Os cards são **sincronizados automaticamente**: internações ativas entram em "Internado / Ativo"; atendimentos pendentes do ACR
  sem leito entram em "Aguardando Avaliação". Quando a paciente ganha leito, o card é promovido automaticamente; quando a
  internação encerra ou o atendimento é finalizado, o card sai do quadro (tabela `regulacao_cards`).
- Mover um card grava a coluna escolhida e **espelha o status operacional** em `internacoes.status_regulacao` (tempo real no
  censo/painel). Não é permitido mover para "Internado / Ativo" sem internação ativa.
- Acesso: perfis de gestão (NIR/SAME/GESTÃO/Administrador) via `exigirAdministrativo()`.

### FASE 3 — Cadastro de usuários restrito ao Administrador · `/?view=nir` → "Usuários e acessos"
- **Somente o perfil Administrador** cadastra/edita/exclui usuários; a validação é **no servidor** (`exigirAdministrador()`),
  não apenas na tela (perfis comuns como Enfermagem, Médico, NIR e Setor são bloqueados ao tentar gravar).
- Formulário reformulado: Nome Completo, CPF, E-mail profissional, Telefone/WhatsApp, Cargo/Função, Login, Perfil de Acesso
  (Administrador/Operador/Visualizador/NIR/SAME/NIR-SAME/Gestão/Setor), Setor de atuação e Status (Ativo/Inativo).
- `usuarios` ganhou `nome_completo, cpf, email, telefone, cargo, status, administrador, criado_em, atualizado_em`; `sessoes.administrador`
  leva o papel para a sessão. O login aceita o **usuário ou o e-mail** e usuários `Inativo` são bloqueados no login.
- A migração promove os perfis `ADMINISTRADOR`/`ADMIN` existentes a Administrador e, se nenhum existir, promove o NIR/SAME/GESTÃO
  mais antigo — **evita que o sistema fique sem ninguém capaz de cadastrar usuários**. Os `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
  ao fim de `db/schema.sql` aplicam tudo sem perder dados, em bancos novos e existentes.

### FASE 4 — Assistência Clínica / PEP (binômio Mãe-Bebê, SOAP e prescrições) · `/?view=prontuario&id=<internação>`
- **Vínculo do binômio Mãe-Bebê** (`internacoes.id_binomio`): no ALCON o Mãe e o RN compartilham o mesmo identificador
  automaticamente; em setores distintos (Mãe na UTI Materna/ALCON e RN na UTIN/UCI/UCINCO), o vínculo é feito por
  `vincularBinomio`. O prontuário mostra todos os integrantes do binômio com atalho para cada um.
- **Dados ao nascer** gravados na internação do RN: `apgar_1min`, `apgar_5min`, `peso_gramas`, `reanimacao` e `pulseira`
  (identificação por pulseira). `editarInternacao` só altera esses campos quando explicitamente enviados.
- **Prontuário Eletrônico Simplificado (PEP)** — `views/prontuario.html` + `public/natus-prontuario.js`: evolução clínica diária
  em **SOAP** (Subjetivo/Objetivo/Avaliação/Plano) por categoria profissional (Médico, Enfermagem, Fisioterapia…), registro de
  **prescrições** (medicamento/cuidado/dieta/exame/procedimento, com dose/via/frequência e situação Ativa/Suspensa/Concluída) e
  **histórico unificado** (movimentações + evoluções + prescrições), com **exportação CSV** para auditoria.
- Tabelas novas `evolucoes_soap` e `prescricoes` (ver `db/schema.sql`) e módulo `lib/clinica.js`. Acesso recortado por setor
  (`exigirSetor`); os perfis de gestão (NIR/SAME/GESTÃO/Administrador) enxergam todos os setores.
- Botão **"Prontuário (PEP)"** no detalhe do leito (censo) e no card do Kanban abrem o prontuário em nova aba.

### FASE 5 — Indicadores de qualidade, giro de leitos e BI gerencial · `/?view=bi`
- **Giro de leitos / higienização**: um leito vago passa a **"Higienização Pendente"** (`leitos.status = 'Higienizacao'`) após
  altas, óbitos, evasões e transferências — a equipe de higienização o devolve como **Disponível** por `concluirHigienizacao`
  (e pode reencaminhar com `marcarHigienizacao`). O leito em higienização **não aceita nova internação** até ser liberado.
  No censo, esses leitos aparecem com destaque e o botão **"Concluir Higienização"**; o `CHECK` de `leitos.status` foi ampliado.
- **Alertas operacionais**: a conclusão de uma saída sinaliza o leito para limpeza (badge "Higienização Pendente") e o BI lista
  os leitos aguardando higienização.
- **Painel gerencial** (`views/bi.html` + `public/natus-bi.js`, módulo `lib/bi.js`, RPC `obterIndicadoresGerenciais`): **taxa de
  ocupação** (tempo real por setor e média do período), **tempo médio de permanência (TMP)**, **percentual de partos normais x
  cesáreas**, **giro de leitos**, movimentação (admissões/altas/óbitos/evasões/transferências) e **alertas de indicadores
  críticos** (ocupação ≥ 90%/80%, setores lotados, permanência prolongada, pacientes sem leito, higienização pendente).
  Exportável em **CSV** (relatório de auditoria). Acesso restrito aos perfis de gestão.
- **Correções desta rodada**: (1) nas telas de admissão, o campo de **faixa de peso** é ocultado **e desabilitado** quando a
  internação é da Mãe (MAE no ALCON) ou da UTI Materna, e o servidor ignora o peso enviado nesses casos; (2) a **busca por nome
  no Kanban** foi corrigida (o filtro por documento casava com CPF vazio) e agora é **insensível a acentos/caixa**; (3) o
  **Regulador pode internar a paciente direto pelo card** (`internarCardKanban`), escolhendo setor e leito sem redigitar dados.

### FASE 6 — Consulta CPF (CADSUS), painel de chamadas (TV) e correções de cálculo
- **Consulta por CPF / CADSUS** (`lib/cadsus.js`, rota `GET /api/cadsus?cpf=...` e RPC `buscarCadsusPorCpf`): o servidor atua
  como **proxy** — as credenciais da fonte externa ficam **apenas no backend** (`CADSUS_API_URL`/`CADSUS_API_TOKEN`, opcionais).
  Sem fonte externa configurada, consulta a **base interna** do Natus. Devolve **nome, data de nascimento, nome da mãe, CNS** e
  o status de internação ativa; trata **CPF não encontrado** e **rede instável** com mensagens claras. No ACR, o botão
  **"Buscar no SUS"** preenche o formulário com estado de carregamento; o campo **Nome da mãe** passou a existir no cadastro
  (`pacientes.nome_mae`, migração idempotente).
- **Painel de chamadas TV/recepção** (`views/chamada.html` + `public/natus-chamada.js`, módulo `lib/chamadas.js`, tabela
  `chamadas`): página **`/?view=chamada`** (atalho `/chamada`) com layout responsivo de TV — **"Chamada Atual"** (senha +
  paciente + consultório) e **"Últimas chamadas"**. Atualização por **polling a cada 4 s**, com **alerta sonoro** e **anúncio por
  voz** (`speechSynthesis`). A leitura é **pública** e exibe apenas o **primeiro nome + inicial** (privacidade/LGPD). Para
  operadores **autenticados**, aparece o **console** com **"Chamar próxima"**, **"Chamar novamente"** (incrementa as repetições)
  e **finalizar**. O ACR ganhou a ação **Chamar** em cada linha da fila.
- **Correções de relatório/BI** (`lib/calc.js` + `lib/bi.js`):
  (1) **período parcial**: os indicadores deixaram de contar meses inteiros — há `calcularIndicadoresPeriodo` que recorta cada
  métrica exatamente em `[dataInicial, dataFinal]`;
  (2) **ALCON (Mãe + RN)**: a admissão conjunta passa a contar como **uma única internação** (episódio por `id_binomio`, com
  união de MAE+RN por leito/intervalo para dados legados) e a ocupação usa **leito-dia** (sem duplicar a Mãe e o RN);
  (3) **trocas de leito**: cada `trocarLeito` grava **auditoria em `trocas_leito`** (origem/destino/data), preservando a
  reconstrução histórica da ocupação;
  (4) **indicadores neonatais**: a **Mãe é excluída** dos denominadores específicos de RN (faixa de peso e sexo) nos setores
  neonatais; corrigido também um bug de acentuação em `normalizarParto` (cesárea/fórceps iam para "Outros").

### FASE 7 — Correções de divergências (ALCON, histórico, versionamento e segurança)
- **1. Ocupação histórica após troca de leito** (`lib/calc.js`): a taxa de ocupação deixou de olhar apenas o **leito atual** da
  internação. A partir da linha do tempo de `trocas_leito` (`indexarTrocas` + `leitoNoDia`), cada dia do mês é reconstruído com
  o leito em que a internação **estava naquele dia** (leito de origem antes da troca, destino depois). Vale para
  `calcularIndicadoresSetor`, `calcularIndicadoresPeriodo` e o relatório gerencial — trocar o leito hoje **não reescreve** o
  passado.
- **2. Mães fora do denominador neonatal** (`lib/qualidade.js`): o painel de qualidade exclui a **Mãe (puérpera)** do conjunto de
  RNs (`totalRNsInternados`/`idsRN`) via `R.ehMae`. Sem isso, 1 Mãe + 1 RN concentrado geraria "50%" de contato pele a pele;
  agora as metas neonatais refletem apenas os RNs.
- **3. Token de sessão fora da URL** (`lib/util.js`, `lib/auth.js`, `api/page.js`, `api/rpc/[fn].js`, `public/natus-rpc.js`):
  o token passa a existir **somente** no cookie `HttpOnly`. O banco guarda o **hash SHA-256** (`hashToken`) — nunca o valor
  utilizável; a resposta de `autenticar` **não devolve mais** `token`; `?token=` na URL é **ignorado**; o cliente não envia
  `Authorization`. *Efeito colateral esperado: sessões antigas são invalidadas — todos precisam entrar de novo.*
- **4. Proteção contra XSS** (`views/*.html`, `public/*.js`): as inserções de dados de paciente em `innerHTML` passam a usar o
  helper de escape (`esc`/`escaparHtml`) — nomes, procedência, destino, observações, rótulos de setor e selects. O `esc` global
  passa a ser exposto por `public/natus-rpc.js` (carregado por todas as telas). A CSP mantém `'unsafe-inline'` porque a arquitetura
  usa handlers/scripts inline; a defesa efetiva contra injeção é o escape na saída.
- **5. Histórico das evoluções preservado** (`lib/clinica.js`, `db/schema.sql`, `public/natus-prontuario.js`): editar uma evolução
  SOAP **não sobrescreve** mais o conteúdo anterior. Antes da alteração, o conteúdo atual é arquivado em
  `evolucoes_soap_versoes` e `evolucoes_soap.versao` é incrementado. O prontuário mostra um selo **vN** e um modal
  **"Histórico de versões"** (RPC `listarVersoesEvolucao`).
- **6. Transferência para o ALCON não inverte mais o binômio** (`lib/operacoes.js`, `lib/painel.js`): a vaga (Mãe/RN) é
  **clínica** e não pode ser adivinhada. A designação vem do `tipo_paciente` atual; quando ausente, é inferida da **origem**
  inequívoca (PPP/UTI Materna → **Mãe**; UTIN/UCIN/UCINCA/UEN/CCO → **RN**) e, nas origens ambíguas, **exigida explicitamente**
  (`tipoPacienteDestino`) — com erro claro se não informada. `registrarInternacao`/`internarCardKanban` também deixaram de
  assumir `'RN'` por padrão, e a sincronização do ALCON não promove mais um ocupante de tipo desconhecido a RN (o leito
  permanece Ocupado, sem vínculo errado).
- **7. Lista de leitos do ALCON** (`lib/operacoes.js`, `views/painel.html`, `public/natus-kanban.js`): a lista de destino mostra
  **primeiro os leitos LIVRES** e, em seguida, os **OCUPADOS que podem receber a vaga** selecionada (ex.: leito ocupado apenas
  pela Mãe, para completar o binômio). Ao trocar o papel (Mãe/RN), a lista é recarregada — no painel de admissão, na
  transferência e no Kanban.
- **Regra ALCON corrigida** (`lib/calc.js`, `episodiosAlcon`): o **RN que permanece internado após a alta da Mãe** (nova
  internação de Tratamento Clínico) **não pertence** ao episódio anterior — conta como **nova admissão**. O agrupamento por
  binômio só une quem **convive no tempo** com a Mãe (intervalos semiabertos `[início, fim)`: uma reinternação que começa
  exatamente na alta da Mãe não se sobrepõe). Efeito: o binômio continua valendo **1 admissão**, mas a reinternação do RN
  soma **+1**.


## Implantação (≈10 min)
1. **Banco**: crie um PostgreSQL gratuito (Neon, Supabase ou Vercel Postgres, região São Paulo/`gru1` se disponível) e copie a `DATABASE_URL` (versão *pooled*).
2. **GitHub**: `git init && git add . && git commit -m "Natus" && git remote add origin <repo> && git push -u origin main`.
3. **Vercel**: *Add New > Project* > importe o repositório (framework: *Other*). Em *Environment Variables* defina `DATABASE_URL`. *Deploy*.
4. **Criar tabelas e o 1º usuário** (na sua máquina, apontando para o mesmo banco):
   ```bash
   npm install
   export DATABASE_URL="postgres://..."
   npm run db:migrate
   ADMIN_NOME=admin ADMIN_SENHA='uma-senha-forte' SEED_LEITOS=0 npm run db:seed
   ```
5. Abra `https://<seu-projeto>.vercel.app`, entre como administrador (perfil **Administrador**), cadastre setores/leitos e usuários na tela NIR.
   `GET /api/health` confirma banco e fuso.

### Migrar os dados da planilha
Google Sheets → *Arquivo > Fazer download > .xlsx*, depois:
```bash
npm install            # inclui o leitor de .xlsx (devDependency)
DATABASE_URL=... npm run db:import -- planilha.xlsx --limpar    # --limpar apaga o que já existe
```
Importa Setores, Leitos, Pacientes, Internações, Movimentações, Usuários (senhas antigas continuam válidas e são
convertidas a scrypt no 1º login), Pele a Pele e Indicadores. Roda em transação única (tudo ou nada) e mostra o resumo.

## Desenvolvimento local
`npm run dev` (http://localhost:3000, precisa de `DATABASE_URL`) ou `vercel dev`.
`npm test` executa a bateria completa de verificações de ponta a ponta (inclui ACR, Kanban, PEP, BI, CADSUS, o painel de chamadas e as correções da FASE 7 — ocupação histórica por trocas de leito, denominador neonatal sem a Mãe, vaga Mãe/RN no ALCON, versionamento da evolução e hash do token — além do bloqueio de cadastro por perfil) — **apaga os dados do banco apontado**; use um banco de teste.

## Segurança (diferenças em relação ao original)
- Todas as chamadas exigem sessão válida (expira em 12 h, `SESSION_HOURS`); perfis NIR/SAME/GESTÃO e restrição por setor são aplicados **no servidor**, não só na tela.
- O cadastro/gestão de usuários exige o perfil **Administrador** (validação `exigirAdministrador` no servidor); os demais perfis só consultam.
- Senhas com scrypt + sal (o SHA-256 sem sal da planilha é aceito apenas para migração); bloqueio após 8 falhas/15 min; senha mínima de 6 caracteres.
- O nome do usuário nos logs de auditoria vem da sessão (não do navegador). Erros técnicos não são expostos ao usuário.
- Escritas são transações com trava global (`pg_advisory_xact_lock`), substituindo o `LockService`.
- A sessão vive **apenas em cookie HttpOnly** (`natus_sessao`, `SameSite=Lax`; `Secure` em HTTPS): o token **não trafega na URL**
  nem no `Authorization`. O banco guarda somente o **hash SHA-256** do token (`hashToken`) — nunca o valor utilizável; a resposta
  do login **não devolve** mais o token e um `?token=` na URL é **ignorado** pelo servidor.
- As permissões da sessão são **revalidadas a cada requisição** contra o cadastro do usuário: mudar perfil/setor/nível administrativo ou inativar/remover o usuário revoga o acesso na hora.
- **CSP** aplicada nas páginas (bloqueia `object-src`, fixa `base-uri`/`frame-ancestors`/`form-action`); todo texto dinâmico é escapado no servidor (`escaparHtml`/`jsonSeguro`) e no cliente (`esc`, exposto por `natus-rpc.js`), evitando XSS armazenado/refletido. (`'unsafe-inline'` é mantido porque as telas usam handlers/scripts inline — a defesa efetiva é o escape na saída.)
- A **evolução clínica SOAP nunca é apagada fisicamente**: a exclusão é lógica (`excluido`) e **cada edição arquiva a versão
  anterior** em `evolucoes_soap_versoes` (campo `versao`), preservando o histórico clínico e a auditoria do prontuário.
- Consultas por CPF ao **CADSUS** passam por um **proxy de servidor** (`lib/cadsus.js` / `/api/cadsus`): nenhuma credencial de API fica no front-end. Sem `CADSUS_API_URL` configurada, usa a base interna do Natus.
- Escritas são transações com trava global (`pg_advisory_xact_lock`), substituindo o `LockService`.
- Fuso fixo America/Manaus (definido no código; a Vercel não permite a variável `TZ`).
- Variáveis opcionais do proxy CADSUS: `CADSUS_API_URL` (com `{cpf}`), `CADSUS_API_TOKEN` e `CADSUS_TIMEOUT_MS`.

## Observações sobre regras portadas sem alteração
Mantidas como no original; vale revisar com a equipe:
1. **Transferência a partir do ALCON** encerra a internação e libera o vínculo, mas **não cria internação no setor de destino** (o ramo ALCON é executado antes do ramo de transferência interna).
2. **Alta da Mãe no ALCON**: a internação anterior do RN vira "Encerrado - Binômio" sem registro de saída, e uma nova é aberta
   (Tratamento Clínico). Por **regra clínica**, essa reinternação conta como **nova admissão** (não herda o binômio anterior) e,
   no censo de pacientes-dia, o RN pode ser contado em duplicidade — a ocupação física do leito (leito-dia) não é afetada.
3. `Setores.Leitos_Ativos` é apenas o número inicial de leitos informado na criação do setor.
