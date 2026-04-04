// =============================
// SERVER.JS COMPLETO (ATUALIZADO E SEGURO)
// =============================

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

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

// =============================
// 🔐 MIDDLEWARE JWT (NOVO)
// =============================
function auth(req, res, next) {
    const header = req.headers.authorization;

    if (!header) {
        return res.status(401).json({ erro: "Token não enviado" });
    }

    try {
        const token = header.replace("Bearer ", "");
        jwt.verify(token, SECRET);
        next();
    } catch (err) {
        return res.status(403).json({ erro: "Token inválido" });
    }
}

// =============================
// 🔹 INIT DB
// =============================
async function startServer() {
    try {

        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                nome TEXT,
                email TEXT UNIQUE,
                senha TEXT,
                criado_em BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
                licenca_chave TEXT
            );
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
// 🔹 LOGIN (SEM VALIDAÇÃO DE LICENÇA POR ENQUANTO)
// =============================
app.post("/auth/login", async (req, res) => {
    try {
        const { email, senha } = req.body;

        if (!email || !senha) {
            return res.status(400).json({ erro: "Email e senha obrigatórios" });
        }

        const result = await pool.query(
            "SELECT * FROM usuarios WHERE LOWER(email)=LOWER($1)",
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
                licenca: usuario.licenca_chave
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro interno" });
    }
});

// =============================
// 🔹 PAINEL
// =============================
app.get("/api/v1/licenca/painel", auth, async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM licencas ORDER BY id DESC");
    res.json(rows);
});

// =============================
// 🔹 GERAR
// =============================
app.post("/api/v1/licenca/gerar", auth, async (req, res) => {

    const { cliente, dias, maxUsuarios } = req.body;

    const diasNum = Number(dias);
    const diasFinal = (!diasNum || isNaN(diasNum) || diasNum <= 0) ? 30 : diasNum;

    const max = (!maxUsuarios || isNaN(maxUsuarios) || maxUsuarios <= 0) ? 3 : Number(maxUsuarios);

    const chave = require("crypto").randomBytes(16).toString("hex");

    const agora = Date.now();
    const expira_em = agora + (diasFinal * 86400000);

    await pool.query(
        "INSERT INTO licencas (cliente_nome, chave, statusFinal, expira_em, max_usuarios) VALUES ($1,$2,$3,$4,$5)",
        [cliente, chave, "ATIVO", expira_em, max]
    );

    res.json({ ok: true, chave, dias: diasFinal });
});

// =============================
// 🔹 BLOQUEAR / DESBLOQUEAR
// =============================
app.post("/api/v1/licenca/bloquear", auth, async (req, res) => {
    const { chave } = req.body;
    await pool.query("UPDATE licencas SET statusFinal='BLOQUEADO' WHERE chave=$1", [chave]);
    res.json({ ok: true });
});

app.post("/api/v1/licenca/desbloquear", auth, async (req, res) => {
    const { chave } = req.body;
    await pool.query("UPDATE licencas SET statusFinal='ATIVO' WHERE chave=$1", [chave]);
    res.json({ ok: true });
});

// =============================
// 🔹 ATIVAR / VALIDAR (SEM AUTH - APP USA)
// =============================
app.post("/api/v1/licenca/ativar", async (req, res) => {
    const { chave, deviceId } = req.body;

    const { rows } = await pool.query("SELECT * FROM licencas WHERE chave=$1", [chave]);
    const lic = rows[0];

    if (!lic) return res.status(404).json({ erro: "Licença não encontrada" });
    if (lic.statusfinal === "BLOQUEADO") return res.status(403).json({ erro: "Bloqueado" });

    const expira = Number(lic.expira_em);
    if (!expira || isNaN(expira)) return res.status(500).json({ erro: "data_invalida" });

    if (Date.now() > expira) return res.status(403).json({ erro: "Expirada" });

    await pool.query(
        "UPDATE licencas SET dispositivo_id=$1, data_ativacao=$2, ultimo_uso=$3 WHERE chave=$4",
        [deviceId, Date.now(), Date.now(), chave]
    );

    res.json({ sucesso: true });
});

app.post("/api/v1/licenca/validar", async (req, res) => {
    try {
        const { chave, deviceId } = req.body;

        const { rows } = await pool.query(
            "SELECT * FROM licencas WHERE chave = $1",
            [chave]
        );

        const lic = rows[0];

        if (!lic) return res.json({ valida: false });

        const agora = Date.now();
        const expiraEm = Number(lic.expira_em);

        await pool.query(
            "UPDATE licencas SET ultimo_uso = $1 WHERE chave = $2",
            [agora, chave]
        );

        if (lic.dispositivo_id && deviceId && lic.dispositivo_id !== deviceId) {
            return res.json({ valida: false });
        }

        if (!lic.dispositivo_id && deviceId) {
            await pool.query(
                "UPDATE licencas SET dispositivo_id = $1 WHERE chave = $2",
                [deviceId, chave]
            );
        }

        if (lic.statusfinal !== "ATIVO") return res.json({ valida: false });

        if (agora > expiraEm) return res.json({ valida: false });

        const diasRestantes = Math.max(0, Math.floor((expiraEm - agora) / 86400000));

        res.json({ valida: true, diasRestantes });

    } catch (err) {
        console.error(err);
        res.status(500).json({ valida: false });
    }
});

// =============================
// 🔹 EVENTOS
// =============================
app.post("/api/v1/licenca/evento", async (req, res) => {
    const { evento, email, deviceId } = req.body;

    await pool.query(
        "INSERT INTO eventos (tipo, email, device_id, data) VALUES ($1,$2,$3,$4)",
        [evento, email || null, deviceId || null, Date.now()]
    );

    res.json({ ok: true });
});

app.get("/api/v1/licenca/evento", auth, async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM eventos ORDER BY id DESC LIMIT 100");
    res.json(rows);
});

// =============================
// 🔹 DELETAR
// =============================
app.post("/api/v1/licenca/deletar", auth, async (req, res) => {
    const { chave } = req.body;
    await pool.query("DELETE FROM licencas WHERE chave=$1", [chave]);
    res.json({ ok: true });
});

// =============================
// 🔹 RESETAR DISPOSITIVO
// =============================
app.post("/api/v1/licenca/resetar-dispositivos", auth, async (req, res) => {
    const { chave } = req.body;
    await pool.query("UPDATE licencas SET dispositivo_id=NULL WHERE chave=$1", [chave]);
    res.json({ ok: true });
});

// =============================
// 🔹 RENOVAR
// =============================
app.post("/api/v1/licenca/renovar", auth, async (req, res) => {
    const { chave, dias } = req.body;

    const diasNum = Number(dias);
    const diasFinal = (!diasNum || isNaN(diasNum) || diasNum <= 0) ? 30 : diasNum;

    const { rows } = await pool.query(
        "SELECT expira_em FROM licencas WHERE chave=$1",
        [chave]
    );

    const atual = Number(rows[0].expira_em);
    const base = (!atual || isNaN(atual)) ? Date.now() : Math.max(atual, Date.now());

    const novaData = base + (diasFinal * 86400000);

    await pool.query(
        "UPDATE licencas SET expira_em=$1 WHERE chave=$2",
        [novaData, chave]
    );

    res.json({ ok: true });
});

// =============================
// 🔹 CRIAR USUÁRIO
// =============================
app.post("/api/v1/licenca/criar-usuario", auth, async (req, res) => {
    try {
        const { chave, nome, email, senha } = req.body;

        if (!email || !senha) {
            return res.status(400).json({ erro: "Email e senha obrigatórios" });
        }

        const { rows } = await pool.query("SELECT * FROM licencas WHERE chave=$1", [chave]);
        const lic = rows[0];

        if (!lic) return res.status(404).json({ erro: "Licença não encontrada" });

        const count = await pool.query(
            "SELECT COUNT(*) FROM usuarios WHERE licenca_chave=$1",
            [chave]
        );

        if (Number(count.rows[0].count) >= (lic.max_usuarios || 3)) {
            return res.status(403).json({ erro: "Limite de usuários atingido" });
        }

        const senhaHash = await bcrypt.hash(senha, 10);

        await pool.query(
            "INSERT INTO usuarios (nome, email, senha, licenca_chave) VALUES ($1,$2,$3,$4)",
            [nome || email, email, senhaHash, chave]
        );

        res.json({ sucesso: true });

    } catch (err) {
        if (err.message.includes("duplicate")) {
            return res.status(400).json({ erro: "Usuário já existe" });
        }

        console.error(err);
        res.status(500).json({ erro: "Erro ao criar usuário" });
    }
});

// =============================
// 🔹 LISTAR USUÁRIOS
// =============================
app.get("/api/v1/licenca/usuarios", auth, async (req, res) => {
    const { chave } = req.query;

    const { rows } = await pool.query(
        "SELECT id, nome, email, criado_em FROM usuarios WHERE licenca_chave=$1 ORDER BY id DESC",
        [chave]
    );

    res.json(rows);
});

// =============================
// 🔹 DELETAR USUÁRIO (NOVO)
// =============================
app.post("/api/v1/licenca/deletar-usuario", auth, async (req, res) => {
    const { id } = req.body;

    await pool.query(
        "DELETE FROM usuarios WHERE id=$1",
        [id]
    );

    res.json({ ok: true });
});

// =============================
// 🔹 RESETAR SENHA
// =============================
app.post("/api/v1/licenca/resetar-senha", auth, async (req, res) => {
    try {
        const { id, novaSenha } = req.body;

        const hash = await bcrypt.hash(novaSenha, 10);

        await pool.query(
            "UPDATE usuarios SET senha=$1 WHERE id=$2",
            [hash, id]
        );

        res.json({ ok: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro ao resetar senha" });
    }
});
