-- Natus — Gestão Inteligente de Leitos (MAB) — schema PostgreSQL
-- Datas/horas são "horário de parede" de Manaus (timestamp sem fuso), como na planilha original.

CREATE TABLE IF NOT EXISTS setores (
  id_setor            text PRIMARY KEY,
  nome_setor          text NOT NULL UNIQUE,
  tipo                text NOT NULL DEFAULT 'Internação',
  capacidade_inicial  integer NOT NULL DEFAULT 0 CHECK (capacidade_inicial >= 0)
);

CREATE TABLE IF NOT EXISTS leitos (
  id_leito           text PRIMARY KEY,
  setor_nome         text NOT NULL REFERENCES setores(nome_setor) ON UPDATE CASCADE ON DELETE RESTRICT,
  numero_leito       text NOT NULL,
  -- FASE 5 (giro de leitos): "Higienizacao" = Higienização Pendente (leito vago aguardando limpeza).
  status             text NOT NULL DEFAULT 'Livre' CHECK (status IN ('Livre','Ocupado','Reservado','Reserva','Bloqueado','Higienizacao')),
  id_paciente_atual  text,
  exame_externo      text NOT NULL DEFAULT 'Não',
  id_paciente_mae    text,   -- ALCON: vínculo da Mãe
  id_paciente_rn     text    -- ALCON: vínculo do RN
);
CREATE INDEX IF NOT EXISTS ix_leitos_setor ON leitos(setor_nome);

CREATE TABLE IF NOT EXISTS pacientes (
  id_paciente        text PRIMARY KEY,
  nome               text NOT NULL,
  data_nascimento    date,
  sexo               char(1),
  numero_prontuario  text NOT NULL DEFAULT '',
  -- FASE 1 (ACR): documentos de identificação para busca rápida na admissão/acolhimento.
  cpf                text NOT NULL DEFAULT '',
  cartao_sus         text NOT NULL DEFAULT '',
  telefone           text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_pacientes_nome ON pacientes (upper(nome) text_pattern_ops);
-- Os índices únicos de CPF/Cartão SUS dependem das colunas novas e são criados na seção de migração,
-- ao final do arquivo, para funcionar tanto em bancos novos quanto em bancos já existentes.

CREATE TABLE IF NOT EXISTS internacoes (
  id_internacao            text PRIMARY KEY,
  id_paciente              text NOT NULL REFERENCES pacientes(id_paciente) ON DELETE RESTRICT,
  id_leito                 text,            -- referência "frouxa": leitos da UEN são extintos na saída
  numero_leito             text NOT NULL DEFAULT '',  -- cópia do número do leito, preserva o histórico
  setor_nome               text NOT NULL REFERENCES setores(nome_setor) ON UPDATE CASCADE ON DELETE RESTRICT,
  data_hora_entrada        timestamp NOT NULL,
  procedencia              text NOT NULL DEFAULT '',
  tipo_parto               text NOT NULL DEFAULT '',
  peso_nascer              text NOT NULL DEFAULT '',
  status                   text NOT NULL DEFAULT 'Ativo',
  hora_nascimento          text NOT NULL DEFAULT '',
  ig                       text NOT NULL DEFAULT '',
  gravidade                text NOT NULL DEFAULT '',
  tipo_paciente            text NOT NULL DEFAULT '',
  observacao_procedimento  text NOT NULL DEFAULT '',
  rn_sozinho               text NOT NULL DEFAULT '',
  -- FASE 2 (Kanban NIR): status operacional de regulação da paciente, mantido pelo quadro Kanban.
  status_regulacao         text NOT NULL DEFAULT '',
  -- FASE 4 (Assistência Clínica): dados ao nascer do RN e vínculo do binômio Mãe-Bebê.
  apgar_1min               integer,
  apgar_5min               integer,
  peso_gramas              integer,
  reanimacao               text NOT NULL DEFAULT '',
  pulseira                 text NOT NULL DEFAULT '',
  id_binomio               text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_int_setor ON internacoes(setor_nome);
CREATE INDEX IF NOT EXISTS ix_int_paciente ON internacoes(id_paciente);
CREATE INDEX IF NOT EXISTS ix_int_leito_ativo ON internacoes(id_leito) WHERE status = 'Ativo';
CREATE INDEX IF NOT EXISTS ix_int_entrada ON internacoes(data_hora_entrada);

CREATE TABLE IF NOT EXISTS movimentacoes (
  id_movimentacao            text PRIMARY KEY,
  id_internacao              text NOT NULL REFERENCES internacoes(id_internacao) ON DELETE RESTRICT,
  tipo_movimento             text NOT NULL CHECK (tipo_movimento IN ('Alta','Obito','Evasao','Transferencia')),
  data_hora_saida            timestamp NOT NULL,
  destino                    text NOT NULL DEFAULT '',
  observacao                 text NOT NULL DEFAULT '',
  peso_saida_gramas          numeric,
  aleitamento_exclusivo_alta text NOT NULL DEFAULT '',
  etapa_metodo_canguru       text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_mov_int ON movimentacoes(id_internacao);
CREATE INDEX IF NOT EXISTS ix_mov_saida ON movimentacoes(data_hora_saida);

CREATE TABLE IF NOT EXISTS contato_pele_pele (
  id_pele_pele       text PRIMARY KEY,
  id_internacao      text NOT NULL REFERENCES internacoes(id_internacao) ON DELETE CASCADE,
  id_paciente        text NOT NULL,
  id_leito           text,
  setor_nome         text NOT NULL,
  data_contato       date NOT NULL,
  contato_realizado  text NOT NULL DEFAULT 'Não',
  duracao_min        integer NOT NULL DEFAULT 0,
  dia_vida           text NOT NULL DEFAULT '',
  registrado_por     text NOT NULL DEFAULT '',
  data_hora_registro timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'America/Manaus'),
  UNIQUE (id_internacao, data_contato)
);

CREATE TABLE IF NOT EXISTS indicadores_leito (
  id_indicador               text PRIMARY KEY,
  id_internacao              text NOT NULL REFERENCES internacoes(id_internacao) ON DELETE CASCADE,
  id_paciente                text NOT NULL,
  id_leito                   text,
  setor_nome                 text NOT NULL,
  data                       date NOT NULL,
  extracao_leite_beira_leito text NOT NULL DEFAULT 'Não',
  visita_mae                 text NOT NULL DEFAULT 'Não',
  visita_pai                 text NOT NULL DEFAULT 'Não',
  visita_irmao               text NOT NULL DEFAULT 'Não',
  visita_avos                text NOT NULL DEFAULT 'Não',
  registrado_por             text NOT NULL DEFAULT '',
  data_hora_registro         timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'America/Manaus'),
  UNIQUE (id_internacao, data)
);

CREATE TABLE IF NOT EXISTS usuarios (
  nome           text NOT NULL,                    -- login de acesso (mantido por compatibilidade)
  perfil         text NOT NULL,
  setor          text NOT NULL DEFAULT '',
  senha_hash     text NOT NULL,
  -- FASE 3 (cadastro completo de colaboradores)
  nome_completo  text NOT NULL DEFAULT '',
  cpf            text NOT NULL DEFAULT '',
  email          text NOT NULL DEFAULT '',
  telefone       text NOT NULL DEFAULT '',
  cargo          text NOT NULL DEFAULT '',
  status         text NOT NULL DEFAULT 'Ativo' CHECK (status IN ('Ativo','Inativo')),
  administrador  boolean NOT NULL DEFAULT false,   -- único perfil autorizado a cadastrar usuários
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_nome ON usuarios (lower(nome));
-- Os índices únicos de e-mail/CPF dependem das colunas novas e são criados na seção de migração.

CREATE TABLE IF NOT EXISTS sessoes (
  token          text PRIMARY KEY,
  nome           text NOT NULL,
  perfil         text NOT NULL,
  setor          text NOT NULL DEFAULT '',
  administrador  boolean NOT NULL DEFAULT false,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  expira_em      timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sessoes_expira ON sessoes(expira_em);

CREATE TABLE IF NOT EXISTS logs (
  id        bigserial PRIMARY KEY,
  data_hora timestamptz NOT NULL DEFAULT now(),
  usuario   text NOT NULL DEFAULT 'Sistema',
  acao      text NOT NULL,
  detalhes  text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_logs_acao_data ON logs(acao, data_hora);

-- =====================================================================================
-- FASE 1 — ACR (Acolhimento com Classificação de Risco)
-- Atendimento de porta/recepção da maternidade: identifica a paciente (CPF / Cartão SUS),
-- classifica o risco e encaminha para internação ou alta ambulatorial.
-- =====================================================================================
CREATE TABLE IF NOT EXISTS acr_atendimentos (
  id_atendimento      text PRIMARY KEY,
  id_paciente         text NOT NULL REFERENCES pacientes(id_paciente) ON DELETE RESTRICT,
  setor_nome          text NOT NULL DEFAULT 'ACR',
  queixa              text NOT NULL DEFAULT '',
  risco               text NOT NULL DEFAULT 'Azul'
                        CHECK (risco IN ('Vermelho','Laranja','Amarelo','Verde','Azul')),
  status              text NOT NULL DEFAULT 'Aguardando'
                        CHECK (status IN ('Aguardando','Em Atendimento','Encaminhado','Alta','Desistencia')),
  destino             text NOT NULL DEFAULT '',
  id_internacao       text,                         -- preenchido quando o atendimento gera internação
  observacao          text NOT NULL DEFAULT '',
  registrado_por      text NOT NULL DEFAULT '',
  data_hora_entrada   timestamp NOT NULL,
  data_hora_registro  timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'America/Manaus')
);
CREATE INDEX IF NOT EXISTS ix_acr_paciente ON acr_atendimentos(id_paciente);
CREATE INDEX IF NOT EXISTS ix_acr_entrada ON acr_atendimentos(data_hora_entrada);
CREATE INDEX IF NOT EXISTS ix_acr_status ON acr_atendimentos(status);

-- =====================================================================================
-- FASE 2 — Kanban de regulação do NIR
-- Cada card representa uma paciente em regulação. Pode vir de uma internação ativa
-- (coluna "Internado/Ativo") ou de um atendimento do ACR ainda sem leito (coluna
-- "Aguardando Avaliação"). A movimentação do card atualiza o status_regulacao da
-- internação correspondente.
-- =====================================================================================
CREATE TABLE IF NOT EXISTS regulacao_cards (
  id_card         text PRIMARY KEY,
  id_paciente     text NOT NULL,
  id_internacao   text REFERENCES internacoes(id_internacao) ON DELETE CASCADE,
  coluna          text NOT NULL DEFAULT 'aguardando'
                    CHECK (coluna IN ('aguardando','internado','documentacao','alta')),
  prioridade      text NOT NULL DEFAULT 'Rotina'
                    CHECK (prioridade IN ('Rotina','Prioridade','Urgente')),
  ordem           integer NOT NULL DEFAULT 0,
  observacao      text NOT NULL DEFAULT '',
  responsavel     text NOT NULL DEFAULT '',
  atualizado_por  text NOT NULL DEFAULT '',
  criado_em       timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'America/Manaus'),
  atualizado_em   timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'America/Manaus')
);
CREATE INDEX IF NOT EXISTS ix_cards_coluna ON regulacao_cards(coluna, ordem);
CREATE INDEX IF NOT EXISTS ix_cards_internacao ON regulacao_cards(id_internacao);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cards_internacao ON regulacao_cards(id_internacao) WHERE id_internacao IS NOT NULL;

-- =====================================================================================
-- FASE 4 — Assistência Clínica: Prontuário Eletrônico Simplificado (PEP)
-- Evolução clínica diária no modelo SOAP (Subjetivo, Objetivo, Avaliação, Plano) e
-- prescrições. O histórico unificado é lido pelo binômio Mãe-Bebê em lib/clinica.js.
-- =====================================================================================
CREATE TABLE IF NOT EXISTS evolucoes_soap (
  id_evolucao     text PRIMARY KEY,
  id_internacao   text NOT NULL REFERENCES internacoes(id_internacao) ON DELETE CASCADE,
  id_paciente     text NOT NULL,
  setor_nome      text NOT NULL DEFAULT '',
  data_hora       timestamp NOT NULL,
  categoria       text NOT NULL DEFAULT 'Médico',   -- Médico, Enfermagem, Fisioterapia, etc.
  profissional    text NOT NULL DEFAULT '',
  subjetivo       text NOT NULL DEFAULT '',
  objetivo        text NOT NULL DEFAULT '',
  avaliacao       text NOT NULL DEFAULT '',
  plano           text NOT NULL DEFAULT '',
  registrado_por  text NOT NULL DEFAULT '',
  criado_em       timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'America/Manaus')
);
CREATE INDEX IF NOT EXISTS ix_soap_internacao ON evolucoes_soap(id_internacao, data_hora);
CREATE INDEX IF NOT EXISTS ix_soap_paciente ON evolucoes_soap(id_paciente);

CREATE TABLE IF NOT EXISTS prescricoes (
  id_prescricao  text PRIMARY KEY,
  id_internacao  text NOT NULL REFERENCES internacoes(id_internacao) ON DELETE CASCADE,
  id_paciente    text NOT NULL,
  setor_nome     text NOT NULL DEFAULT '',
  data_hora      timestamp NOT NULL,
  tipo           text NOT NULL DEFAULT 'Medicamento',  -- Medicamento, Cuidado, Dieta, Exame, Procedimento
  descricao      text NOT NULL DEFAULT '',
  dose           text NOT NULL DEFAULT '',
  via            text NOT NULL DEFAULT '',
  frequencia     text NOT NULL DEFAULT '',
  status         text NOT NULL DEFAULT 'Ativa' CHECK (status IN ('Ativa','Suspensa','Concluída')),
  profissional   text NOT NULL DEFAULT '',
  observacao     text NOT NULL DEFAULT '',
  criado_em      timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'America/Manaus'),
  atualizado_em  timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'America/Manaus')
);
CREATE INDEX IF NOT EXISTS ix_presc_internacao ON prescricoes(id_internacao, data_hora);
CREATE INDEX IF NOT EXISTS ix_presc_paciente ON prescricoes(id_paciente);

-- =====================================================================================
-- Migrações incrementais (idempotentes) — aplicam as novas colunas em bancos já existentes.
-- `npm run db:migrate` executa este arquivo inteiro, portanto funciona para instalações
-- novas e para bancos antigos sem perder dados.
-- =====================================================================================
ALTER TABLE pacientes  ADD COLUMN IF NOT EXISTS cpf         text NOT NULL DEFAULT '';
ALTER TABLE pacientes  ADD COLUMN IF NOT EXISTS cartao_sus  text NOT NULL DEFAULT '';
ALTER TABLE pacientes  ADD COLUMN IF NOT EXISTS telefone    text NOT NULL DEFAULT '';

ALTER TABLE internacoes ADD COLUMN IF NOT EXISTS status_regulacao text NOT NULL DEFAULT '';

-- FASE 4 — dados ao nascer do RN e vínculo do binômio Mãe-Bebê.
ALTER TABLE internacoes ADD COLUMN IF NOT EXISTS apgar_1min  integer;
ALTER TABLE internacoes ADD COLUMN IF NOT EXISTS apgar_5min  integer;
ALTER TABLE internacoes ADD COLUMN IF NOT EXISTS peso_gramas integer;
ALTER TABLE internacoes ADD COLUMN IF NOT EXISTS reanimacao  text NOT NULL DEFAULT '';
ALTER TABLE internacoes ADD COLUMN IF NOT EXISTS pulseira    text NOT NULL DEFAULT '';
ALTER TABLE internacoes ADD COLUMN IF NOT EXISTS id_binomio  text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS ix_int_binomio ON internacoes(id_binomio) WHERE id_binomio <> '';

-- FASE 5 — novo status operacional "Higienizacao" (Higienização Pendente) no giro de leitos.
ALTER TABLE leitos DROP CONSTRAINT IF EXISTS leitos_status_check;
ALTER TABLE leitos ADD CONSTRAINT leitos_status_check
  CHECK (status IN ('Livre','Ocupado','Reservado','Reserva','Bloqueado','Higienizacao'));

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS nome_completo text NOT NULL DEFAULT '';
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cpf           text NOT NULL DEFAULT '';
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email         text NOT NULL DEFAULT '';
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefone      text NOT NULL DEFAULT '';
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cargo         text NOT NULL DEFAULT '';
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS status        text NOT NULL DEFAULT 'Ativo';
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS administrador boolean NOT NULL DEFAULT false;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS criado_em     timestamptz NOT NULL DEFAULT now();
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS atualizado_em timestamptz NOT NULL DEFAULT now();

ALTER TABLE sessoes ADD COLUMN IF NOT EXISTS administrador boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_email ON usuarios (lower(email)) WHERE email <> '';
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_cpf ON usuarios ((regexp_replace(cpf, '\D', '', 'g')))
  WHERE length(regexp_replace(cpf, '\D', '', 'g')) = 11;
CREATE UNIQUE INDEX IF NOT EXISTS ux_pacientes_cpf ON pacientes ((regexp_replace(cpf, '\D', '', 'g')))
  WHERE length(regexp_replace(cpf, '\D', '', 'g')) = 11;
CREATE UNIQUE INDEX IF NOT EXISTS ux_pacientes_sus ON pacientes ((regexp_replace(cartao_sus, '\D', '', 'g')))
  WHERE length(regexp_replace(cartao_sus, '\D', '', 'g')) BETWEEN 11 AND 20;

-- Perfis que já eram administrativos passam a ser Administradores (mantém acesso à gestão de usuários).
UPDATE usuarios SET administrador = true, status = coalesce(nullif(status,''), 'Ativo')
  WHERE upper(perfil) IN ('ADMINISTRADOR', 'ADMIN');
-- Trava de segurança da migração: se nenhum Administrador existir, o usuário NIR/SAME/GESTÃO mais
-- antigo recebe o papel para evitar que o sistema fique sem ninguém capaz de cadastrar usuários.
UPDATE usuarios SET administrador = true
  WHERE nome = (SELECT nome FROM usuarios
                 WHERE upper(perfil) IN ('NIR', 'SAME', 'NIR/SAME', 'GESTÃO', 'ADMINISTRADOR', 'ADMIN')
                 ORDER BY nome LIMIT 1)
    AND NOT EXISTS (SELECT 1 FROM usuarios WHERE administrador = true);
