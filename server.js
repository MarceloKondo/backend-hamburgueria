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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nome TEXT,
        email TEXT UNIQUE,
        senha TEXT,
        criado_em BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        licenca_chave TEXT,
        is_owner BOOLEAN DEFAULT FALSE
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
    email: usuario.email,
    licenca: usuario.licenca_chave,
    isOwner: usuario.is_owner // 🔥 AQUI
}
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro interno" });
    }
});

// =============================
// 🔹 IMPORTANTE - APP VERSAO
// =============================
app.get("/api/v1/app/versao", async (req, res) => {
    try {
        res.json({
            versionCode: 1,
            versionName: "1.0.1",
            forceUpdate: true,
            apkUrl: "https://hamburgueria-api-74br.onrender.com/app.apk",
            mensagem: "Atualização obrigatória disponível!!"
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            erro: "Erro interno"
        });
    }
});
// =============================
// 🔹 PAINEL (COM USUÁRIOS)
// =============================
app.get("/api/v1/licenca/painel", async (req, res) => {

    const { rows } = await pool.query("SELECT * FROM licencas ORDER BY id DESC");

    const resultado = [];

    for (let lic of rows) {
        const count = await pool.query(
            "SELECT COUNT(*) FROM usuarios WHERE licenca_chave=$1",
            [lic.chave]
        );

        resultado.push({
            ...lic,
            usuarios_usados: Number(count.rows[0].count)
        });
    }

    res.json(resultado);
});

// =============================
// 🔹 GERAR LICENÇA
// =============================
app.post("/api/v1/licenca/gerar", async (req, res) => {

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
// 🔹 ATIVAR (CORRIGIDO)
// =============================
app.post("/api/v1/licenca/ativar", async (req, res) => {
    try {

        const { chave, deviceId } = req.body;

        console.log("🔥 [ATIVAR] chave:", chave);
        console.log("🔥 [ATIVAR] deviceId:", deviceId);
        console.log("🔥 [ATIVAR] DATABASE:", process.env.DATABASE_URL);

        const { rows } = await pool.query(
            "SELECT * FROM licencas WHERE chave = $1",
            [chave]
        );

        console.log("🔥 [ATIVAR] rows encontradas:", rows.length);

        const lic = rows[0];

        if (!lic) {
            console.log("❌ Licença não encontrada");
            return res.status(404).json({ erro: "Licença não encontrada" });
        }

        if (lic.statusfinal === "BLOQUEADO") {
            console.log("❌ Licença bloqueada");
            return res.status(403).json({ erro: "Bloqueado" });
        }

        const expira = Number(lic.expira_em);

        if (Date.now() > expira) {
            console.log("❌ Licença expirada");
            return res.status(403).json({ erro: "Expirada" });
        }

        // 🔥 ATIVA DE VERDADE
        await pool.query(
            `
            UPDATE licencas 
            SET 
                dispositivo_id = $1,
                data_ativacao = $2,
                ultimo_uso = $3,
                statusfinal = 'ATIVO'
            WHERE chave = $4
            `,
            [deviceId, Date.now(), Date.now(), chave]
        );

        console.log("✅ Licença ativada com sucesso");

        res.json({ sucesso: true });

    } catch (err) {
        console.error("❌ ERRO ATIVAR:", err);
        res.status(500).json({ erro: "Erro interno" });
    }
});
// =============================
// 🔹 VALIDAR (CORRIGIDO)
// =============================
app.post("/api/v1/licenca/validar", async (req, res) => {
    try {

        const { chave, deviceId } = req.body;

        console.log("🔥 [VALIDAR] chave:", chave);
        console.log("🔥 [VALIDAR] deviceId:", deviceId);

        const { rows } = await pool.query(
            "SELECT * FROM licencas WHERE chave = $1",
            [chave]
        );

        console.log("🔥 [VALIDAR] rows encontradas:", rows.length);

        const lic = rows[0];

        if (!lic) {
            console.log("❌ Licença não encontrada");
            return res.json({ valida: false });
        }

        const agora = Date.now();
        const expiraEm = Number(lic.expira_em);

        // 🔥 LOG COMPLETO
        console.log("📦 Licença encontrada:", {
            status: lic.statusfinal,
            deviceSalvo: lic.dispositivo_id,
            expiraEm
        });

        // 🔥 ATUALIZA USO
        await pool.query(
            "UPDATE licencas SET ultimo_uso = $1 WHERE chave = $2",
            [agora, chave]
        );

        // 🔥 VALIDA DEVICE
        if (lic.dispositivo_id && deviceId && lic.dispositivo_id !== deviceId) {
            console.log("❌ Device diferente");
            return res.json({ valida: false });
        }

        // 🔥 PRIMEIRA ATIVAÇÃO (GRAVA DEVICE SE NÃO EXISTIR)
        if (!lic.dispositivo_id && deviceId) {
            console.log("⚠️ Gravando deviceId na licença");
            await pool.query(
                "UPDATE licencas SET dispositivo_id = $1 WHERE chave = $2",
                [deviceId, chave]
            );
        }

        // 🔥 STATUS
        if (lic.statusfinal !== "ATIVO") {
            console.log("❌ Status não ativo:", lic.statusfinal);
            return res.json({ valida: false });
        }

        // 🔥 EXPIRAÇÃO
        if (agora > expiraEm) {
            console.log("❌ Licença expirada");
            return res.json({ valida: false });
        }

        console.log("✅ Licença válida");

        res.json({
            valida: true,
            expiraEm: expiraEm
        });

    } catch (err) {
        console.error("❌ ERRO VALIDAR:", err);
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
        [evento, email, deviceId, Date.now()]
    );

    res.json({ ok: true });
});

app.get("/api/v1/licenca/evento", async (req, res) => {

    const { rows } = await pool.query(
        "SELECT * FROM eventos ORDER BY id DESC LIMIT 100"
    );

    res.json(rows);
});

// =============================
// 🔹 DELETAR LICENÇA
// =============================
app.post("/api/v1/licenca/deletar", async (req, res) => {

    const { chave } = req.body;

    await pool.query("DELETE FROM licencas WHERE chave=$1", [chave]);

    res.json({ ok: true });
});

// =============================
// 🔹 RESETAR DISPOSITIVO
// =============================
app.post("/api/v1/licenca/resetar-dispositivos", async (req, res) => {

    const { chave } = req.body;

    await pool.query(
        "UPDATE licencas SET dispositivo_id=NULL WHERE chave=$1",
        [chave]
    );

    res.json({ ok: true });
});

// =============================
// 🔹 RENOVAR
// =============================
app.post("/api/v1/licenca/renovar", async (req, res) => {

    const { chave, dias } = req.body;

    const diasFinal = Number(dias) || 30;

    const { rows } = await pool.query(
        "SELECT expira_em FROM licencas WHERE chave=$1",
        [chave]
    );

    const atual = Number(rows[0].expira_em);
    const novaData = Math.max(atual, Date.now()) + (diasFinal * 86400000);

    await pool.query(
        "UPDATE licencas SET expira_em=$1 WHERE chave=$2",
        [novaData, chave]
    );

    res.json({ ok: true });
});
// =============================
// 🔹 CRIAR USUÁRIO (AJUSTADO AO SEU BANCO)
// =============================
app.post("/api/v1/licenca/criar-usuario", async (req, res) => {
    try {

        const { chave, nome, email, senha } = req.body;

        console.log("🔥 [CRIAR USUARIO]");
        console.log("chave:", chave);
        console.log("email:", email);

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

        const bcrypt = require("bcrypt");
        const senhaHash = await bcrypt.hash(senha, 10);

        console.log("🔥 Inserindo usuário...");

   // 🔥 verifica se já existe owner nessa licença
const ownerExistente = await pool.query(
    `
    SELECT 1 FROM usuarios 
    WHERE licenca_chave = $1 AND is_owner = true
    LIMIT 1
    `,
    [chave]
);

const isOwner = ownerExistente.rowCount === 0;

await pool.query(
    `
    INSERT INTO usuarios (
        nome,
        email,
        senha,
        licenca_chave,
        is_owner
    )
    VALUES ($1, $2, $3, $4, $5)
    `,
    [nome, email, senhaHash, chave, isOwner]
);

        console.log("✅ Usuário criado com sucesso");

        res.json({ sucesso: true });

    } catch (err) {
        console.error("❌ ERRO CRIAR USUARIO:", err.message);
        res.status(500).json({ erro: "Erro interno", detalhe: err.message });
    }
});
// =============================
// 🔹 USUÁRIOS
// =============================
app.get("/api/v1/licenca/usuarios", async (req, res) => {

    const { chave } = req.query;

    const { rows } = await pool.query(
        "SELECT id, nome, email, criado_em FROM usuarios WHERE licenca_chave=$1 ORDER BY id DESC",
        [chave]
    );

    res.json(rows);
});

// =============================
// 🔹 EDITAR USUÁRIO
// =============================
app.post("/api/v1/licenca/editar-usuario", async (req, res) => {

    const { id, nome, email } = req.body;

    await pool.query(
        "UPDATE usuarios SET nome=$1, email=$2 WHERE id=$3",
        [nome, email, id]
    );

    res.json({ ok: true });
});

// =============================
// 🔹 RESETAR SENHA
// =============================
app.post("/api/v1/licenca/resetar-senha", async (req, res) => {

    const { id, novaSenha } = req.body;

    const hash = await bcrypt.hash(novaSenha, 10);

    await pool.query(
        "UPDATE usuarios SET senha=$1 WHERE id=$2",
        [hash, id]
    );

    res.json({ ok: true });
});

// =============================
// 🔹 DELETAR USUÁRIO
// =============================
app.post("/api/v1/licenca/deletar-usuario", async (req, res) => {

    const { id } = req.body;

    await pool.query(
        "DELETE FROM usuarios WHERE id=$1",
        [id]
    );

    res.json({ ok: true });
});
