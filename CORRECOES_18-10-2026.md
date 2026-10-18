# Natus — melhorias de UX (menu suspenso, barra lateral retrátil e menu por perfil)

Base: pacote `natus` (v3, correção de carregamento de leitos). Este pacote altera o código; não publica na Vercel nem executa comandos no banco do hospital.

## Aplicação

1. Faça backup do banco e mantenha a versão anterior da aplicação para recuperação.
2. No SQL Editor do Neon, execute **`db/migrations/20261018_permissoes_menu.sql`**, que acompanha este pacote. Para instalação local nova, `npm run db:migrate` aplica o schema e as migrações.
3. Publique o código atualizado na Vercel. A migração pode preceder a publicação; o código tolera a ausência da tabela (a barra usa o padrão do perfil até a migração ser aplicada).
4. Faça novo login (não é obrigatório, mas o login já devolve a personalização do menu do perfil).
5. Valide os cenários abaixo em homologação antes de liberar aos usuários.

A migração é repetível (idempotente) e aditiva: cria apenas `permissoes_menu` e sua semente, sem alterar nem apagar dados de negócio. `ON CONFLICT DO NOTHING` preserva escolhas já feitas pelos administradores.

## Alterações entregues

| Item | Comportamento |
|---|---|
| Empilhamento (z-index) | Os menus de ação do leito/`dropdowns`/`popovers` passam a ficar **sobrepostos ao trilho lateral** (trilho `z-index:1020`; menus `1035`; cards de leito com o menu aberto em `1040`), mantendo-se **abaixo** do Offcanvas de detalhes (`1045`) e dos modais. |
| Menu lateral retrátil | Clicar na **logo** recolhe/reexpõe a barra lateral; a preferência fica em `localStorage` (`natus_sidebar_collapsed`). Há uma alça para reexibir o menu; no celular (barra inferior) o recolhimento não se aplica. |
| Banco de dados | Nova tabela `permissoes_menu` (`perfil`, `modulo_chave`, `visivel`, `atualizado_em`), com chave única `(perfil, modulo_chave)` e semente que espelha a navegação atual. |
| API/servidor | `lib/configuracoes.js` (matriz, leitura efetiva e atualização), RPCs `obterPermissoesMenu`, `obterMatrizPermissoesMenu` e `atualizarPermissaoMenu` (escrita só para Administrador), e o login (`lib/auth.js`) devolve `permissoesMenu` do perfil. |
| Renderização do menu | `lib/shell.js` marca cada botão com `data-modulo` e já renderiza o menu filtrado por perfil; `public/natus-ui.js` expõe `aplicarVisibilidadeMenu` para ajuste dinâmico no cliente. |
| Tela de Configurações | `/?view=configuracoes` (exclusiva do Administrador): matriz perfil × módulo com interruptores para exibir/ocultar cada botão do menu. |

## Chaves de módulo (personalização)

`censo` (Censo de leitos · tela `painel`), `dashboard`, `acr`, `chamada`, `historico`, `dashboardgeral`, `nir`, `kanban`, `bi` e `configuracoes`.
Os módulos de gestão (`dashboardgeral`, `nir`, `kanban`, `bi`) só são personalizáveis por perfis de gestão; `configuracoes` é exclusivo do Administrador. Células inelegíveis aparecem como “—” na matriz.

## Não-regressão (garantias)

- **Nenhuma assinatura de endpoint/RPC existente** (leitos, trocas, evolução SOAP, prescrições, relatórios, BI, ACR, Kanban, chamadas) foi alterada; as novas funções são aditivas.
- O filtro de menu é **apenas visual**: a segurança de rotas continua em `lib/auth.js` (`exigirAdministrador`, `exigirSetor`), nos recortes por setor (`lib/data.js`) e nas guardas de tela (`api/page.js`). Ocultar um botão **não concede nem remove** acesso.
- O perfil **Administrador** é **imutável** na matriz, evitando que a tela de Configurações desapareça do menu (perda de acesso).
- Sem a migração aplicada, a barra lateral usa o **padrão do perfil** (comportamento atual), sem quebrar a navegação.

## Testes

`npm test` (isolado, sem banco externo) valida: recolhimento da barra lateral pela logo + persistência, `aplicarVisibilidadeMenu`, filtragem do menu no SSR, tela de Configurações do Administrador, matriz por perfil, bloqueio de não administrador, upsert isolado, módulo inelegível, perfil Administrador fixo e migração repetível. `npm run test:smoke:database` (contra um PostgreSQL de teste) cobre os mesmos cenários via RPC.

## Cenários de validação manual

1. **Empilhamento**: no Censo, abrir **Ações** de um leito próximo ao menu lateral — o menu deve aparecer **por cima** do trilho.
2. **Barra lateral**: clicar na logo → menu recolhe; recarregar a página → permanece recolhido; clicar na alça → reexpõe.
3. **Menu por perfil**: como Administrador, em **Configurações**, desmarcar um módulo para o perfil **Setor**; logar com um usuário do perfil Setor e confirmar que o botão desapareceu do menu e que as **rotas permanecem protegidas** (acesso direto à URL continua validado no servidor).
