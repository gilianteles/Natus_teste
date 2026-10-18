# Natus — correções de ALCON, indicadores e segurança

Base: arquivo `natus(2).zip` enviado em 17/10/2026, incluindo CADSUS e painel de chamadas. Este pacote altera o código; não publica na Vercel nem executa comandos no banco do hospital.

## Aplicação

1. Faça backup do banco e mantenha a versão anterior da aplicação para recuperação.
2. No SQL Editor do Neon, execute **`db/migrations/20261017_alcon_seguranca.sql`**, que acompanha este pacote. A migração pressupõe o schema da versão enviada, incluindo `trocas_leito` e as colunas de exclusão lógica de `evolucoes_soap`.
3. Publique o código atualizado na Vercel. A migração deve preceder a publicação, pois o código consulta as novas colunas/tabela. Para instalação local nova, `npm run db:migrate` aplica o schema e a migração.
4. Faça novo login. Sessões antigas com token bruto são invalidadas. Links antigos com `token=` deixam de autenticar e são redirecionados para uma URL limpa.
5. Valide os cenários abaixo em homologação antes de liberar a atualização aos usuários.

A migração é repetível; não apaga internações, movimentações ou evoluções. Encerra sessões legadas, adiciona o limite temporal da continuidade clínica do RN, índices e o histórico de versões SOAP. Executar apenas o código sem a migração causará falhas nas consultas.

## Correções entregues

| Item | Comportamento atualizado |
|---|---|
| Mãe transferida aparecendo como RN | O servidor preserva o tipo cadastrado. Reconhece UTI Materna como Mãe e setores exclusivamente neonatais como RN. Se a origem não permite determinar o tipo, o formulário exige escolha explícita de Mãe/RN; não presume RN nem usa o nome para classificar. |
| Leitos disponíveis no ALCON | Admissão, transferência e consulta do Kanban mostram livres e ocupados pelo integrante oposto que podem completar o binômio. O servidor revalida a disponibilidade dentro da transação. Leito cheio, bloqueado, em higienização ou com vínculo inconsistente não aceita complemento. |
| RN admitido junto da Mãe | Completar o binômio não gera outra admissão estatística. A contagem usa o primeiro integrante e considera o histórico completo antes de aplicar o filtro, inclusive entre dias e meses diferentes. Cada integrante mantém sua internação clínica individual. |
| Mãe admitida junto do RN | Mesma regra, com vínculo de binômio compartilhado também nessa ordem. |
| Alta materna com RN permanecendo | Encerra o segmento anterior do RN na hora da alta materna e abre a internação clínica dele. Essa entrada conta como nova admissão. Não cria uma alta fictícia do RN. |
| Transferência saindo de ALCON | A transferência interna cria a internação de destino e retira somente o integrante transferido do leito de origem. |
| Troca de leito | Preserva o integrante remanescente do binômio, registra origem/destino/hora, inclusive na atribuição inicial a paciente sem leito. Mantida a correção do botão e da resposta pendente, sem repetir a gravação. |
| Ocupação histórica | O cálculo utiliza `trocas_leito` para localizar o leito no fim de cada dia. Binômio no mesmo leito ocupa um leito físico. O encerramento do segmento antigo do RN impede continuidade indefinida no censo. |
| BI e relatório | Mantido o recorte exato do período parcial e a contagem física por leito; unificada a regra de admissão do binômio nos indicadores e relatórios. |
| Qualidade neonatal | Mães são excluídas dos denominadores de RN, aleitamento e registros de qualidade. No ALCON, o formulário de qualidade seleciona a internação do RN. |
| Sessão | Cookie HttpOnly/SameSite e Secure em HTTPS; token não é retornado no JSON do login nem propagado em links; banco guarda SHA-256 do token. Bearer e token de URL não autenticam. CADSUS usa o mesmo cookie. |
| Permissões | Cadastro atual é verificado em cada requisição; mudanças de perfil, setor, status, administrador, senha ou exclusão revogam sessões por trigger no banco. |
| CSRF e XSS | Validação de origem e token CSRF nos RPCs autenticados; escape contextual de texto HTML, atributos e strings JavaScript nas telas. A leitura pública do painel de chamadas foi preservada. |
| Evoluções clínicas | Registro, retificação e cancelamento geram versões com conteúdo, autor, data e motivo. Cancelamento é lógico e aparece no prontuário com o histórico. Evoluções canceladas não podem ser editadas; DELETE de evolução e UPDATE/DELETE de versões são bloqueados por triggers. |

## Corrigir o caso que já aparece no campo RN

No ALCON, abra **Editar internação**, selecione o registro da paciente e altere **Integrante do binômio** para **Mãe**. Confira os demais dados e salve. A aplicação move o vínculo para o campo Mãe e registra a alteração em log, sem criar outra internação. Se já houver outra mãe no leito, a correção é bloqueada para evitar sobreposição.

Não foi feita alteração automática por nome ou sexo: essa inferência poderia modificar pacientes errados. O banco publicado não foi acessado.

## Testes e critérios de aceite

`npm ci` e `npm test` executam a regressão do botão/RPC e testes de SQL com PostgreSQL em memória (PGlite). Esses testes não usam a conexão do hospital. O teste legado `test:smoke:database` é destrutivo e deve ser usado exclusivamente em banco descartável.

Cenários automatizados: transferência materna; origem ambígua; lista de leitos complementares; rejeição de segundo RN; RN antes/depois da mãe; virada de mês; alta materna seguida de internação clínica; ocupação sem duplicação; troca de leito e histórico; transferência ALCON→ALCON; correção de tipo existente; denominador neonatal; versões SOAP; migração repetível; hash de sessão; revogação; logout; cookies; CSRF; rejeição de URL/Bearer; TV pública; sintaxe e escape das dez telas.

A verificação em Chromium também passou nas telas principais: sem exceções JavaScript/API, conteúdo malicioso exibido como texto e seletor de leito complementar correto.

Há teste opcional de interface em `scripts/ui-browser-test.js`, acionado pelo teste principal com `NATUS_PLAYWRIGHT_PATH` e `NATUS_UI_DEPS` apontando para Playwright e Bootstrap/Chart.js instalados para testes. Ele usa o mesmo banco isolado.

## Limites e próximos cuidados

- Trocas anteriores à existência da auditoria não podem ser reconstruídas com certeza. Na ausência de eventos, conserva-se o leito conhecido; não se inventam leitos anteriores.
- A migração recupera a data de encerramento de segmentos antigos “Encerrado - Binômio” somente quando existe a entrada clínica posterior correspondente do mesmo RN/setor/binômio. Registros sem essa evidência exigem conferência documental.
- Textos clínicos sobrescritos antes desta atualização não podem ser recuperados sem backup. O conteúdo disponível vira a versão inicial preservada.
- Os testes isolados não substituem homologação no ambiente Vercel/Neon. Não foi medido o tempo de resposta sob carga real. Foram mantidas a memoização por requisição e leituras paralelas; adicionados índices de consulta do histórico.
- A CSP ainda permite scripts/handlers inline, pois as telas existentes dependem deles. Migrar esses handlers e restringir a CSP é uma etapa adicional de endurecimento. O escape contextual foi aplicado nesta revisão.
- Como melhoria adicional de infraestrutura: conta de banco com menor privilégio, validação estrita do certificado TLS, backups com restauração testada e monitoramento de acesso. Administradores/proprietários do banco continuam capazes de alterar triggers; as proteções não substituem segregação de acesso.

O documento `REVISAO_16-10-2026.md` é o diagnóstico anterior. O estado desta entrega é descrito aqui.
