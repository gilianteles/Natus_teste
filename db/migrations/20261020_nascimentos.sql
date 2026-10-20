BEGIN;
CREATE TABLE IF NOT EXISTS partos (
 id_parto text PRIMARY KEY, id_mae text NOT NULL REFERENCES pacientes(id_paciente),
 id_internacao_mae text NOT NULL UNIQUE REFERENCES internacoes(id_internacao),
 setor_origem text NOT NULL CHECK (setor_origem IN ('PPP','CCO','CPNI')),
 tipo_parto text NOT NULL CHECK (tipo_parto IN ('Normal','Cesárea')),
 dados jsonb NOT NULL DEFAULT '{}', criado_por text NOT NULL, criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS nascimentos (
 id_nascimento text PRIMARY KEY, id_parto text NOT NULL REFERENCES partos(id_parto),
 ordem integer NOT NULL CHECK(ordem BETWEEN 1 AND 10), id_rn text NOT NULL UNIQUE REFERENCES pacientes(id_paciente),
 data_nascimento date NOT NULL, hora_nascimento time NOT NULL,
 condicao text NOT NULL CHECK(condicao IN ('Nascido Vivo','Nascido Morto')),
 dados jsonb NOT NULL DEFAULT '{}', UNIQUE(id_parto,ordem)
);
CREATE INDEX IF NOT EXISTS ix_partos_mae ON partos(id_mae);
CREATE INDEX IF NOT EXISTS ix_nascimentos_data ON nascimentos(data_nascimento);
CREATE TABLE IF NOT EXISTS altas_binomio (
 id_internacao_mae text PRIMARY KEY REFERENCES internacoes(id_internacao),
 id_internacao_rn text REFERENCES internacoes(id_internacao), setor_nome text NOT NULL,
 data_hora timestamp NOT NULL, modalidade text NOT NULL CHECK(modalidade IN ('CONJUNTA','VINCULADO'))
);
INSERT INTO setores(id_setor,nome_setor,tipo,capacidade_inicial) VALUES ('PPP','PPP','Obstétrico',0),('CCO','CCO','Obstétrico',0),('CPNI','CPNI','Obstétrico',0) ON CONFLICT DO NOTHING;
COMMIT;
