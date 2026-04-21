// =============================
// SERVER.JS COMPLETO FINAL (SEM PERDER NADA)
// =============================

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const SECRET = "SUPER_SECRET_KEY";

// =============================
// 🔹 POSTGRES CONFIG
// =============================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.get("/app.apk", (req, res) => {
    res.download(path.resolve(__dirname, "app.apk"));
});

// =============================
// 🔹 INIT DB
// =============================
async function startServer() {
    try {

        // 🔥 TABELA USUARIOS CORRIGIDA (SEM QUEBRAR)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                nome TEXT,
                email TEXT UNIQUE,
                senha TEXT,
                criado_em BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
                licenca_chave TEXT,
                is_owner BOOLEAN DEFAULT FALSE,
                updated_at BIGINT,
                deleted BOOLEAN DEFAULT FALSE
            );
        `);

        // 🔥 GARANTE COLUNAS EM BANCOS ANTIGOS
        await pool.query(`
            ALTER TABLE usuarios 
            ADD COLUMN IF NOT EXISTS updated_at BIGINT;
        `);

        await pool.query(`
            ALTER TABLE usuarios 
            ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT FALSE;
        `);

        // 🔥 CORRIGE DADOS ANTIGOS
        await pool.query(`
            UPDATE usuarios 
            SET 
                updated_at = COALESCE(updated_at, criado_em),
                deleted = COALESCE(deleted, FALSE)
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS licencas (
                id SERIAL PRIMARY KEY,
                cliente_nome TEXT,
                chave TEXT UNIQUE,
                statusFinal TEXT,
                expira_em BIGINT,
                dispositivos INTEGER DEFAULT 0,
                dispositivo_id TEXT,
                usuario_login TEXT,
                usuario_senha TEXT,
                ultimo_uso BIGINT,
                data_ativacao BIGINT,
                tentativas_invalidas INTEGER DEFAULT 0,
                max_usuarios INTEGER DEFAULT 3
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS eventos (
                id SERIAL PRIMARY KEY,
                tipo TEXT,
                email TEXT,
                device_id TEXT,
                data BIGINT
            );
        `);

        console.log("Postgres conectado");

        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log("Servidor rodando na porta " + PORT);
        });

    } catch (err) {
        console.error("ERRO AO INICIAR SERVIDOR:", err);
        process.exit(1);
    }
}

startServer();

// =============================
// 🔹 LOGIN
// =============================
app.post("/auth/login", async (req, res) => {
    try {
        const { email, senha } = req.body;

        const result = await pool.query(
            `SELECT * FROM usuarios 
             WHERE LOWER(email)=LOWER($1) 
             AND deleted IS NOT TRUE`,
            [email]
        );

        const usuario = result.rows[0];

        if (!usuario) {
            return res.status(401).json({ erro: "Usuário não encontrado" });
        }

        const senhaValida = await bcrypt.compare(senha, usuario.senha);

        if (!senhaValida) {
            return res.status(401).json({ erro: "Senha inválida" });
        }

        const token = jwt.sign({ id: usuario.id }, SECRET, { expiresIn: "1h" });

        res.json({
            token,
            usuario: {
                id: usuario.id,
                nome: usuario.nome,
                email: usuario.email,
                licenca: usuario.licenca_chave,
                isOwner: usuario.is_owner
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro interno" });
    }
});

// =============================
// 🔹 CRIAR USUÁRIO
// =============================
app.post("/api/v1/licenca/criar-usuario", async (req, res) => {
    try {

        const { chave, nome, email, senha } = req.body;

        if (!chave || !email || !senha) {
            return res.status(400).json({ erro: "Dados obrigatórios faltando" });
        }

        const { rows } = await pool.query(
            "SELECT * FROM licencas WHERE chave = $1",
            [chave]
        );

        const lic = rows[0];

        if (!lic) {
            return res.status(404).json({ erro: "Licença não encontrada" });
        }

        if (lic.statusfinal !== "ATIVO") {
            return res.status(403).json({ erro: "Licença não ativa" });
        }

        const count = await pool.query(
            `SELECT COUNT(*) 
             FROM usuarios 
             WHERE licenca_chave=$1 
             AND deleted IS NOT TRUE`,
            [chave]
        );

        const total = Number(count.rows[0].count);

        if (total >= lic.max_usuarios) {
            return res.status(403).json({ erro: "Limite de usuários atingido" });
        }

        const senhaHash = await bcrypt.hash(senha, 10);

        const ownerExistente = await pool.query(
            `SELECT id FROM usuarios 
             WHERE licenca_chave=$1 
             AND is_owner=true 
             AND deleted IS NOT TRUE 
             LIMIT 1`,
            [chave]
        );

        const isOwner = ownerExistente.rowCount === 0;

        const resultInsert = await pool.query(
            `
            INSERT INTO usuarios (
                nome, email, senha, licenca_chave, is_owner, criado_em, updated_at
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            RETURNING id
            `,
            [nome, email, senhaHash, chave, isOwner, Date.now(), Date.now()]
        );

        res.json({
            sucesso: true,
            id: resultInsert.rows[0].id
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro interno" });
    }
});

// =============================
// 🔹 LISTAR USUÁRIOS (SYNC)
// =============================
app.get("/api/v1/licenca/usuarios", async (req, res) => {

    const { chave, lastSync } = req.query;

    let query = `
        SELECT id, nome, email, criado_em, is_owner, updated_at, deleted
        FROM usuarios 
        WHERE licenca_chave=$1
    `;

    const params = [chave];

    if (lastSync) {
        query += " AND updated_at > $2";
        params.push(Number(lastSync));
    }

    query += " ORDER BY id DESC";

    const { rows } = await pool.query(query, params);

    res.json({ lista: rows });
});

// =============================
// 🔹 EDITAR USUÁRIO
// =============================
app.post("/api/v1/licenca/editar-usuario", async (req, res) => {

    const { id, nome, email } = req.body;

    await pool.query(
        `UPDATE usuarios 
         SET nome=$1, email=$2, updated_at=$3 
         WHERE id=$4`,
        [nome, email, Date.now(), id]
    );

    res.json({ ok: true });
});

// =============================
// 🔹 DELETAR USUÁRIO
// =============================
app.post("/api/v1/licenca/deletar-usuario", async (req, res) => {

    const { id } = req.body;

    await pool.query(
        `UPDATE usuarios 
         SET deleted=true, updated_at=$1 
         WHERE id=$2`,
        [Date.now(), id]
    );

    res.json({ ok: true });
});
