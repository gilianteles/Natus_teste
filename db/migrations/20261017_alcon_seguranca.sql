BEGIN;
ALTER TABLE internacoes ADD COLUMN IF NOT EXISTS encerrada_em timestamp;
-- Recupera apenas o limite conhecido da continuidade clínica já registrada.
UPDATE internacoes i SET encerrada_em=(SELECT min(n.data_hora_entrada) FROM internacoes n
 WHERE n.id_paciente=i.id_paciente AND n.setor_nome=i.setor_nome
 AND (nullif(i.id_binomio,'') IS NULL OR n.id_binomio=i.id_binomio) AND n.id_internacao<>i.id_internacao
 AND n.data_hora_entrada>=i.data_hora_entrada AND n.id_internacao LIKE '%-RNCLIN')
 WHERE i.status='Encerrado - Binômio' AND i.encerrada_em IS NULL;
CREATE INDEX IF NOT EXISTS ix_trocas_int_tempo ON trocas_leito(id_internacao,data_hora,id_troca);
CREATE INDEX IF NOT EXISTS ix_trocas_setor_tempo ON trocas_leito(upper(setor_nome),data_hora,id_troca);
ALTER TABLE evolucoes_soap ADD COLUMN IF NOT EXISTS motivo_cancelamento text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS evolucoes_soap_versoes (
 id_versao bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 id_evolucao text NOT NULL,
 registrado_em timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'America/Manaus'),
 autor text NOT NULL, motivo text NOT NULL, dados jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_soap_versoes_evolucao ON evolucoes_soap_versoes(id_evolucao,id_versao);
-- Baseline preserva o conteúdo disponível; não inventa revisões antigas inexistentes.
INSERT INTO evolucoes_soap_versoes(id_evolucao,autor,motivo,dados)
 SELECT e.id_evolucao,coalesce(nullif(e.registrado_por,''),'Migração'), 'Conteúdo disponível na migração',to_jsonb(e)
 FROM evolucoes_soap e WHERE NOT EXISTS (SELECT 1 FROM evolucoes_soap_versoes v WHERE v.id_evolucao=e.id_evolucao);
CREATE OR REPLACE FUNCTION natus_auditar_soap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Evoluções não podem ser apagadas; utilize cancelamento auditado.'; END IF;
 IF TG_OP='UPDATE' AND OLD.excluido THEN RAISE EXCEPTION 'Evolução cancelada não pode ser alterada.'; END IF;
 INSERT INTO evolucoes_soap_versoes(id_evolucao,autor,motivo,dados) VALUES
 (NEW.id_evolucao,coalesce(nullif(current_setting('natus.autor',true),''),current_user),
 coalesce(nullif(current_setting('natus.motivo',true),''),'Alteração direta no banco'),to_jsonb(NEW));
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS natus_soap_auditoria ON evolucoes_soap;
CREATE TRIGGER natus_soap_auditoria AFTER INSERT OR UPDATE OR DELETE ON evolucoes_soap FOR EACH ROW EXECUTE FUNCTION natus_auditar_soap();
CREATE OR REPLACE FUNCTION natus_preservar_versao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Histórico clínico imutável.'; END $$;
DROP TRIGGER IF EXISTS natus_soap_versoes_imutaveis ON evolucoes_soap_versoes;
CREATE TRIGGER natus_soap_versoes_imutaveis BEFORE UPDATE OR DELETE ON evolucoes_soap_versoes FOR EACH ROW EXECUTE FUNCTION natus_preservar_versao();
CREATE OR REPLACE FUNCTION natus_revogar_sessoes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN DELETE FROM sessoes WHERE lower(nome)=lower(OLD.nome); RETURN OLD; END IF;
 IF ROW(OLD.nome,OLD.perfil,OLD.setor,OLD.administrador,OLD.status,OLD.senha_hash) IS DISTINCT FROM ROW(NEW.nome,NEW.perfil,NEW.setor,NEW.administrador,NEW.status,NEW.senha_hash)
 THEN DELETE FROM sessoes WHERE lower(nome)=lower(OLD.nome); END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS natus_usuario_revogar ON usuarios;
CREATE TRIGGER natus_usuario_revogar AFTER UPDATE OR DELETE ON usuarios FOR EACH ROW EXECUTE FUNCTION natus_revogar_sessoes();
-- Tokens anteriores não são mais aceitos. Usuários devem autenticar novamente.
DELETE FROM sessoes WHERE token NOT LIKE 'sha256$%';
COMMIT;
