// =============================
// SERVER.JS COMPLETO (CORRIGIDO)
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
    try {

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
                email: usuario.email
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
app.get("/api/v1/licenca/painel", async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM licencas ORDER BY id DESC");
    res.json(rows);
});

// =============================
// 🔹 GERAR
// =============================
app.post("/api/v1/licenca/gerar", async (req, res) => {
    console.log("REQ BODY:", req.body);

    const { cliente, dias } = req.body;

    const diasNum = Number(dias);
    const diasFinal = (!diasNum || isNaN(diasNum) || diasNum <= 0) ? 30 : diasNum;

    console.log("DIAS RECEBIDO:", dias, "-> convertido:", diasFinal);

    const chave = require("crypto").randomBytes(16).toString("hex");

    const agora = Date.now();
    const expira_em = agora + (diasFinal * 86400000);

    await pool.query(
        "INSERT INTO licencas (cliente_nome, chave, statusFinal, expira_em) VALUES ($1,$2,$3,$4)",
        [cliente, chave, "ATIVO", expira_em]
    );

    res.json({ ok: true, chave, dias: diasFinal });
});

// =============================
// 🔹 BLOQUEAR / DESBLOQUEAR
// =============================
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

// =============================
// 🔹 ATIVAR
// =============================
app.post("/api/v1/licenca/ativar", async (req, res) => {
    const { chave, deviceId } = req.body;

    const { rows } = await pool.query("SELECT * FROM licencas WHERE chave=$1", [chave]);
    const lic = rows[0];

    if (!lic) return res.status(404).json({ erro: "Licença não encontrada" });
    if (lic.statusFinal === "BLOQUEADO") return res.status(403).json({ erro: "Bloqueado" });

    const expira = Number(lic.expira_em);
    if (!expira || isNaN(expira)) {
        return res.status(500).json({ erro: "data_invalida" });
    }

    if (Date.now() > expira) return res.status(403).json({ erro: "Expirada" });

    await pool.query(
        "UPDATE licencas SET dispositivo_id=$1, data_ativacao=$2, ultimo_uso=$3 WHERE chave=$4",
        [deviceId, Date.now(), Date.now(), chave]
    );

    res.json({ sucesso: true });
});

// =============================
// 🔹 VALIDAR
// =============================
app.post("/api/v1/licenca/validar", async (req, res) => {
    try {
        const { chave, deviceId } = req.body;

        if (!chave) {
            return res.status(400).json({ valida: false });
        }

        const { rows } = await pool.query(
            "SELECT * FROM licencas WHERE chave = $1",
            [chave]
        );

        const lic = rows[0];

        if (!lic) {
            return res.json({ valida: false, status: "NAO_ENCONTRADA" });
        }

        const agora = Date.now();
        const expiraEm = Number(lic.expira_em);

        if (!expiraEm || isNaN(expiraEm)) {
            console.error("DATA INVALIDA NO BANCO:", lic.expira_em);
            return res.status(500).json({
                valida: false,
                erro: "data_invalida"
            });
        }

        await pool.query(
            "UPDATE licencas SET ultimo_uso = $1 WHERE chave = $2",
            [agora, chave]
        );

        if (lic.dispositivo_id && deviceId && lic.dispositivo_id !== deviceId) {
            return res.json({ valida: false, status: "DEVICE_INVALIDO" });
        }

        if (!lic.dispositivo_id && deviceId) {
            await pool.query(
                "UPDATE licencas SET dispositivo_id = $1 WHERE chave = $2",
                [deviceId, chave]
            );
        }

        const status = lic.statusFinal;

        if (status && status !== "ATIVO") {
            return res.json({ valida: false, status });
        }

        if (agora > expiraEm) {
            return res.json({
                valida: false,
                status: "EXPIRADO",
                diasRestantes: 0,
                expiraEm
            });
        }

        const diff = expiraEm - agora;
        const diasRestantes = Math.max(0, Math.floor(diff / 86400000));

        res.json({
            valida: true,
            diasRestantes,
            expiraEm
        });

    } catch (err) {
        console.error("ERRO VALIDAR:", err);
        res.status(500).json({
            valida: false,
            erro: "erro_interno"
        });
    }
});

// =============================
// 🔹 EVENTOS
// =============================
app.post("/api/v1/licenca/evento", async (req, res) => {
    try {
        const { evento, email, deviceId, dataAtivacao } = req.body;

        await pool.query(
            "INSERT INTO eventos (tipo, email, device_id, data) VALUES ($1,$2,$3,$4)",
            [
                evento,
                email || null,
                deviceId || null,
                dataAtivacao || Date.now()
            ]
        );

        res.json({ ok: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro ao salvar evento" });
    }
});

app.get("/api/v1/licenca/evento", async (req, res) => {
    try {
        const { rows } = await pool.query(
            "SELECT * FROM eventos ORDER BY id DESC LIMIT 100"
        );

        res.json(rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro ao buscar eventos" });
    }
});

// =============================
// 🔹 DELETAR
// =============================
app.post("/api/v1/licenca/deletar", async (req, res) => {
    try {
        const { chave } = req.body;

        await pool.query(
            "DELETE FROM licencas WHERE chave=$1",
            [chave]
        );

        res.json({ ok: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro ao deletar" });
    }
});

// =============================
// 🔹 RESETAR DISPOSITIVO
// =============================
app.post("/api/v1/licenca/resetar-dispositivos", async (req, res) => {
    try {
        const { chave } = req.body;

        await pool.query(
            "UPDATE licencas SET dispositivo_id=NULL WHERE chave=$1",
            [chave]
        );

        res.json({ ok: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro ao resetar" });
    }
});

// =============================
// 🔹 RENOVAR
// =============================
app.post("/api/v1/licenca/renovar", async (req, res) => {
    try {
        const { chave, dias } = req.body;

        const diasNum = Number(dias);
        const diasFinal = (!diasNum || isNaN(diasNum) || diasNum <= 0) ? 30 : diasNum;

        const { rows } = await pool.query(
            "SELECT expira_em FROM licencas WHERE chave=$1",
            [chave]
        );

        if (!rows.length) {
            return res.status(404).json({ erro: "Licença não encontrada" });
        }

        const atual = Number(rows[0].expira_em);
        const base = (!atual || isNaN(atual)) ? Date.now() : Math.max(atual, Date.now());

        const novaData = base + (diasFinal * 86400000);

        await pool.query(
            "UPDATE licencas SET expira_em=$1 WHERE chave=$2",
            [novaData, chave]
        );

        res.json({ ok: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro ao renovar" });
    }
});

// =============================
// 🔹 CRIAR USUÁRIO
// =============================
app.post("/api/v1/licenca/criar-usuario", async (req, res) => {
    try {
        const { chave, nome, email, senha } = req.body;

        const senhaHash = await bcrypt.hash(senha, 10);

        await pool.query(
            "INSERT INTO usuarios (nome, email, senha) VALUES ($1,$2,$3)",
            [nome || email, email, senhaHash]
        );

        await pool.query(
            "UPDATE licencas SET usuario_login=$1, usuario_senha=$2 WHERE chave=$3",
            [email, senha, chave]
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
// 🔹 USUÁRIOS
// =============================
app.get("/api/v1/licenca/usuarios", async (req, res) => {
    try {
        const { rows } = await pool.query(
            "SELECT id, nome, email, criado_em FROM usuarios ORDER BY id DESC"
        );

        res.json(rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro ao listar usuários" });
    }
});

app.post("/api/v1/licenca/deletar-usuario", async (req, res) => {
    try {
        const { id } = req.body;

        await pool.query(
            "DELETE FROM usuarios WHERE id=$1",
            [id]
        );

        res.json({ ok: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro ao deletar usuário" });
    }
});

// =============================
// 🔹 RESETAR SENHA (CORRIGIDO)
// =============================
app.post("/api/v1/licenca/resetar-senha", async (req, res) => {
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
