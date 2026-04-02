// =============================
// SERVER.JS - POSTGRES COMPLETO
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
// 🔹 INIT DB
// =============================
async function startServer() {

    await pool.query(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id SERIAL PRIMARY KEY,
            nome TEXT,
            email TEXT UNIQUE,
            senha TEXT,
            criado_em BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
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
            tentativas_invalidas INTEGER DEFAULT 0
        );
    `);

    console.log("Postgres conectado");

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log("Servidor rodando na porta " + PORT);
    });
}

startServer();

// =============================
// 🔹 LOGIN
// =============================
app.post("/auth/login", async (req, res) => {
    try {
        const { email, senha } = req.body;

        const result = await pool.query(
            "SELECT * FROM usuarios WHERE LOWER(email)=LOWER($1)",
            [email]
        );

        const usuario = result.rows[0];

        if (!usuario) return res.status(401).json({ erro: "Usuário não encontrado" });

        const senhaValida = await bcrypt.compare(senha, usuario.senha);
        if (!senhaValida) return res.status(401).json({ erro: "Senha inválida" });

        const token = jwt.sign({ id: usuario.id }, SECRET, { expiresIn: "1h" });

        res.json({ token });

    } catch (err) {
        res.status(500).json({ erro: "Erro interno" });
    }
});

// =============================
// 🔹 LICENÇAS
// =============================
app.get("/api/v1/licenca/painel", async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM licencas ORDER BY id DESC");
    res.json(rows);
});

app.post("/api/v1/licenca/gerar", async (req, res) => {
    const { cliente, dias } = req.body;

    const chave = require("crypto").randomBytes(16).toString("hex");
    const expira_em = Date.now() + dias * 86400000;

    await pool.query(
        "INSERT INTO licencas (cliente_nome, chave, statusFinal, expira_em) VALUES ($1,$2,$3,$4)",
        [cliente, chave, "ATIVO", expira_em]
    );

    res.json({ ok: true, chave });
});

app.post("/api/v1/licenca/bloquear", async (req, res) => {
    const { chave } = req.body;
    await pool.query("UPDATE licencas SET statusFinal='BLOQUEADO' WHERE chave=$1", [chave]);
    res.json({ ok: true });
});

app.post("/api/v1/licenca/desbloquear", async (req, res) => {
    const { chave } = req.body;
    await pool.query("UPDATE licencas SET statusFinal='ATIVO' WHERE chave=$1", [chave]);
    res.json({ ok: true });
});

app.post("/api/v1/licenca/ativar", async (req, res) => {
    const { chave, deviceId } = req.body;

    const { rows } = await pool.query("SELECT * FROM licencas WHERE chave=$1", [chave]);
    const lic = rows[0];

    if (!lic) return res.status(404).json({ erro: "Licença não encontrada" });
    if (lic.statusfinal === "BLOQUEADO") return res.status(403).json({ erro: "Bloqueado" });
    if (Date.now() > lic.expira_em) return res.status(403).json({ erro: "Expirada" });

    await pool.query(
        "UPDATE licencas SET dispositivo_id=$1, data_ativacao=$2, ultimo_uso=$3 WHERE chave=$4",
        [deviceId, Date.now(), Date.now(), chave]
    );

    res.json({ sucesso: true });
});

app.post("/api/v1/licenca/validar", async (req, res) => {
    const { chave, deviceId } = req.body;

    const { rows } = await pool.query("SELECT * FROM licencas WHERE chave=$1", [chave]);
    const lic = rows[0];

    if (!lic) return res.json({ valido: false });
    if (lic.statusfinal !== "ATIVO") return res.json({ valido: false });
    if (Date.now() > lic.expira_em) return res.json({ valido: false });
    if (lic.dispositivo_id && lic.dispositivo_id !== deviceId) return res.json({ valido: false });

    res.json({ valido: true });
});

app.post("/api/v1/licenca/criar-usuario", async (req, res) => {
    try {
        const { chave, nome, email, senha } = req.body;

        const senhaHash = await bcrypt.hash(senha, 10);

        await pool.query(
            "INSERT INTO usuarios (nome, email, senha) VALUES ($1,$2,$3)",
            [nome, email, senhaHash]
        );

        await pool.query(
            "UPDATE licencas SET usuario_login=$1, usuario_senha=$2 WHERE chave=$3",
            [email, senha, chave]
        );

        res.json({ sucesso: true });

    } catch (err) {
        res.status(500).json({ erro: "Erro ao criar usuário" });
    }
});

// ==========================
// 🔹 LOGIN USUARIOS
// ==========================
app.post("/auth/login", async (req, res) => {
    try {
        const { email, senha } = req.body;
        if (!email || !senha) return res.status(400).json({ erro: "Email ou senha não enviados" });

        const usuario = await db.get(
            "SELECT * FROM usuarios WHERE LOWER(email)=LOWER(?)",
            [email.trim()]
        );

        if (!usuario) return res.status(401).json({ erro: "Usuário não encontrado" });

        const senhaValida = await bcrypt.compare(senha, usuario.senha);
        if (!senhaValida) return res.status(401).json({ erro: "Senha inválida" });

        const token = jwt.sign({ id: usuario.id, email: usuario.email }, SECRET, { expiresIn: "1h" });
        res.json({ token, usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email } });

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro interno" });
    }
});

// ==========================
// 🔹 MIDDLEWARE JWT
// ==========================
function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ erro: "Token faltando" });

    const token = authHeader.split(" ")[1];
    try {
        req.user = jwt.verify(token, SECRET);
        next();
    } catch (err) {
        res.status(401).json({ erro: "Token inválido" });
    }
}

// ==========================
// 🔹 ROTAS LICENÇA (exemplo)
// ==========================
app.get("/api/v1/licenca/painel", async (req, res) => {
    const dados = await db.all("SELECT * FROM licencas ORDER BY id DESC");
    res.json(dados);
});

// Exemplo de gerar licença
app.post("/api/v1/licenca/gerar", async (req, res) => {
    const { cliente, dias } = req.body;
    const chave = require("crypto").randomBytes(16).toString("hex");
    const expira_em = Date.now() + dias * 24 * 60 * 60 * 1000;

    await db.run(
        "INSERT INTO licencas (cliente_nome, chave, statusFinal, expira_em) VALUES (?,?,?,?)",
        [cliente, chave, "ATIVO", expira_em]
    );

    res.json({ ok: true, chave });
});

// 🔒 Bloquear/Desbloquear
app.post("/api/v1/licenca/bloquear", async (req, res) => {
    const { chave } = req.body;
    await db.run("UPDATE licencas SET statusFinal='BLOQUEADO' WHERE chave=?", [chave]);
    res.json({ ok: true });
});

app.post("/api/v1/licenca/desbloquear", async (req, res) => {
    const { chave } = req.body;
    await db.run("UPDATE licencas SET statusFinal='ATIVO' WHERE chave=?", [chave]);
    res.json({ ok: true });
});
app.post("/api/v1/licenca/ativar", async (req, res) => {
    try {
        const { chave, deviceId } = req.body;

        if (!chave || !deviceId) {
            return res.status(400).json({ erro: "Dados inválidos" });
        }

        const lic = await db.get("SELECT * FROM licencas WHERE chave = ?", [chave]);

        if (!lic) {
            return res.status(404).json({ erro: "Licença não encontrada" });
        }

        if (lic.statusFinal === "BLOQUEADO") {
            return res.status(403).json({ erro: "Licença bloqueada" });
        }

        if (Date.now() > lic.expira_em) {
            return res.status(403).json({ erro: "Licença expirada" });
        }

        // registra dispositivo
        await db.run(
            `UPDATE licencas 
             SET dispositivo_id = ?, data_ativacao = ?, ultimo_uso = ?
             WHERE chave = ?`,
            [deviceId, Date.now(), Date.now(), chave]
        );

        res.json({
            sucesso: true,
            mensagem: "Licença ativada"
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro ao ativar licença" });
    }
});
app.post("/api/v1/licenca/validar", async (req, res) => {
    try {
        const { chave, deviceId } = req.body;

        const lic = await db.get("SELECT * FROM licencas WHERE chave = ?", [chave]);

        if (!lic) return res.status(404).json({ valido: false });

        if (lic.statusFinal !== "ATIVO") return res.json({ valido: false });

        if (Date.now() > lic.expira_em) return res.json({ valido: false });

        if (lic.dispositivo_id && lic.dispositivo_id !== deviceId) {
            return res.json({ valido: false });
        }

        res.json({ valido: true });

    } catch (err) {
        res.status(500).json({ valido: false });
    }
});
app.post("/api/v1/licenca/criar-usuario", async (req, res) => {
    try {
        const { chave, nome, email, senha } = req.body;

        if (!chave || !email || !senha) {
            return res.status(400).json({ erro: "Dados inválidos" });
        }

        const lic = await db.get("SELECT * FROM licencas WHERE chave = ?", [chave]);

        if (!lic) {
            return res.status(404).json({ erro: "Licença não encontrada" });
        }

        const senhaHash = await bcrypt.hash(senha, 10);

        await db.run(
            "INSERT INTO usuarios (nome, email, senha) VALUES (?,?,?)",
            [nome || email, email, senhaHash]
        );

        // opcional: vincular na licença
        await db.run(
            "UPDATE licencas SET usuario_login = ?, usuario_senha = ? WHERE chave = ?",
            [email, senha, chave]
        );

        res.json({ sucesso: true });

    } catch (err) {
        if (err.message.includes("UNIQUE")) {
            return res.status(400).json({ erro: "Usuário já existe" });
        }

        res.status(500).json({ erro: "Erro ao criar usuário" });
    }
});
