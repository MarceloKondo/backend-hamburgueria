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
            ALTER TABLE usuarios 
            ADD COLUMN IF NOT EXISTS updated_at BIGINT;
        `);

        await pool.query(`
            ALTER TABLE usuarios 
            ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT FALSE;
        `);


        await pool.query(`
            CREATE TABLE IF NOT EXISTS licencas (
                id SERIAL PRIMARY KEY,
                cliente_nome TEXT,
                chave TEXT UNIQUE,
                status_final TEXT,
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
        const { email, senha, chave } = req.body;

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
    `SELECT COUNT(*) FROM usuarios 
     WHERE licenca_chave=$1 AND deleted IS NOT TRUE`,
    [lic.chave]
);

const owner = await pool.query(
    `SELECT email FROM usuarios 
     WHERE licenca_chave=$1 
     AND is_owner = true 
     AND deleted IS NOT TRUE
     LIMIT 1`,
    [lic.chave]
);
        
resultado.push({
    ...lic,
    usuarios_usados: Number(count.rows[0].count),
    owner_email: owner.rows[0]?.email || null
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
    `
    INSERT INTO licencas (
        cliente_nome,
        chave,
        status_final,
        expira_em,
        max_usuarios
    )
    VALUES ($1,$2,$3,$4,$5)
    `,
    [cliente, chave, "ATIVO", expira_em, max]
);

    res.json({ ok: true, chave, dias: diasFinal });
});

// =============================
// 🔹 BLOQUEAR / DESBLOQUEAR
// =============================
app.post("/api/v1/licenca/bloquear", async (req, res) => {
    const { chave } = req.body;
    await pool.query("UPDATE licencas SET status_final='BLOQUEADO' WHERE chave=$1", [chave]);
    res.json({ ok: true });
});

app.post("/api/v1/licenca/desbloquear", async (req, res) => {
    const { chave } = req.body;
    await pool.query("UPDATE licencas SET status_final='ATIVO' WHERE chave=$1", [chave]);
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

        if (lic.status_final === "BLOQUEADO") {
            console.log("❌ Licença bloqueada");
            return res.status(403).json({ erro: "Bloqueado" });
        }

        const expira = parseInt(lic.expira_em);

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
                status_final = 'ATIVO'
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
       const expiraEm = parseInt(lic.expira_em);

        // 🔥 LOG COMPLETO
        console.log("📦 Licença encontrada:", {
            status: lic.status_final,
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
        if (lic.status_final !== "ATIVO") {
            console.log("❌ Status não ativo:", lic.status_final);
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
// 🔹 DEFINIR OWNER 
// =============================
app.post("/api/v1/licenca/set-owner", async (req, res) => {
    const { id } = req.body;

    try {

        // 🔥 pega licença do usuário
        const { rows } = await pool.query(
            "SELECT licenca_chave FROM usuarios WHERE id=$1",
            [id]
        );

        const chave = rows[0]?.licenca_chave;

        if (!chave) {
            return res.status(404).json({ erro: "Usuário não encontrado" });
        }

        // 🔥 remove owner de todos
        await pool.query(
            "UPDATE usuarios SET is_owner = false WHERE licenca_chave=$1",
            [chave]
        );

        // 🔥 define novo owner
        await pool.query(
            "UPDATE usuarios SET is_owner = true WHERE id=$1",
            [id]
        );

        res.json({ ok: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro interno" });
    }
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
// 🔹 PRATOS 
// =============================
app.get("/api/v1/pratos", async (req, res) => {
    try {

        const pratos = await pool.query(`SELECT * FROM prato ORDER BY id DESC`);

        res.json({ lista: pratos.rows });

    } catch (err) {
        res.status(500).json({ erro: "erro interno" });
    }
});
// =============================
// 🔹 PRATOS DELETAR
// =============================
app.post("/api/v1/pratos/deletar", async (req, res) => {
    try {

        const { id } = req.body;

        await pool.query(`DELETE FROM prato WHERE id=$1`, [id]);

        res.json({ ok: true });

    } catch (err) {
        res.status(500).json({ erro: "erro interno" });
    }
});
// =============================
// 🔹 PRATOS SALVAR
// =============================
app.post("/api/v1/pratos/salvar", async (req, res) => {
    try {

        const { id, nome, canal, ingredientes } = req.body;

        let pratoId = id;

        // =========================
        // 1. CREATE OU UPDATE PRATO
        // =========================
        if (!id) {

            const result = await pool.query(
                `INSERT INTO prato (nome, canal, data_venda)
                 VALUES ($1, $2, $3)
                 RETURNING id`,
                [nome, canal || "", Date.now()]
            );

            pratoId = result.rows[0].id;

        } else {

            await pool.query(
                `UPDATE prato SET nome=$1, canal=$2 WHERE id=$3`,
                [nome, canal || "", id]
            );

            // limpa ingredientes antigos
            await pool.query(
                `DELETE FROM prato_ingrediente WHERE prato_id=$1`,
                [id]
            );
        }

        // =========================
        // 2. RECRIA INGREDIENTES
        // =========================
        for (const ing of ingredientes) {

            await pool.query(
                `INSERT INTO prato_ingrediente
                (prato_id, ingrediente_id, quantidade, preco_medio, nome)
                VALUES ($1, $2, $3, $4, $5)`,
                [
                    pratoId,
                    ing.ingredienteId,
                    ing.quantidade,
                    ing.precoMedio || 0,
                    ing.nome
                ]
            );
        }

        res.json({
            ok: true,
            id: pratoId
        });

    } catch (err) {
        console.error("❌ ERRO PRATO SYNC:", err);
        res.status(500).json({ erro: "erro interno" });
    }
});

// =============================
// 🔹 PRODUTOS (COM SYNC)
// =============================

app.get("/api/v1/produtos", async (req, res) => {

    const { chave, lastSync } = req.query;

    let query = `
        SELECT * FROM produtos
        WHERE licenca_chave = $1
    `;

    const params = [chave];

    if (lastSync && Number(lastSync) > 0) {
        query += " AND updated_at > $2";
        params.push(Number(lastSync));
    }

    const { rows } = await pool.query(query, params);

    res.json(rows);
});

// =============================
// 🔹 EDITAR PRODUTO
// =============================
app.post("/api/v1/produtos/editar", async (req, res) => {
    try {

        const {
            id,
            nome,
            unidade,
            categoria,
            descricao,
            usarEmPrato,
            extra,
            bebida,
            operacional,
            quantidadePadrao,
            medidaPadrao
        } = req.body;

        if (!id) {
            return res.status(400).json({ erro: "ID obrigatório" });
        }

        await pool.query(
            `
            UPDATE produtos SET
                nome = $1,
                unidade = $2,
                categoria = $3,
                descricao = $4,
                usar_em_prato = $5,
                extra = $6,
                bebida = $7,
                operacional = $8,
                quantidade_padrao = $9,
                medida_padrao = $10,
                updated_at = $11
            WHERE id = $12
            `,
            [
                nome,
                unidade,
                categoria,
                descricao,
                usarEmPrato,
                extra,
                bebida,
                operacional,
                quantidadePadrao,
                medidaPadrao,
                Date.now(),
                id
            ]
        );

        res.json({ ok: true });

    } catch (err) {
        console.error("❌ ERRO EDITAR PRODUTO:", err);
        res.status(500).json({ erro: "Erro interno" });
    }
});
// =============================
// 🔹 PRODUTOS DELETAR
// =============================
app.post("/api/v1/produtos/deletar", async (req, res) => {

    const { id } = req.body;

 await pool.query(
    `
    UPDATE produtos
    SET deleted = true, updated_at = $1
    WHERE id = $2
    `,
    [Date.now(), id]
);

    res.json({ ok: true });
});
// =============================
// 🔹 PRODUTOS CRIAR
// =============================
app.post("/api/v1/produtos/criar", async (req, res) => {

    const {
        chave,
        nome,
        unidade,
        categoria,
        descricao,
        usarEmPrato,
        extra,
        bebida,
        operacional,
        quantidadePadrao,
        medidaPadrao
    } = req.body;

    const { rows } = await pool.query(
        `
        INSERT INTO produtos (
            nome, unidade, categoria, descricao,
            usar_em_prato, extra, bebida, operacional,
            quantidade_padrao, medida_padrao,
            licenca_chave,
            updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING id
        `,
        [
            nome, unidade, categoria, descricao,
            usarEmPrato, extra, bebida, operacional,
            quantidadePadrao, medidaPadrao,
            chave,
            Date.now()
        ]
    );

    res.json({ id: rows[0].id });
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

        // 🔹 validação básica
        if (!chave || !email || !senha) {
            return res.status(400).json({ erro: "Dados obrigatórios faltando" });
        }

        // 🔹 busca licença
        const { rows } = await pool.query(
            "SELECT * FROM licencas WHERE chave = $1",
            [chave]
        );

        const lic = rows[0];

        // 🔹 valida licença primeiro
        if (!lic) {
            return res.status(404).json({ erro: "Licença não encontrada" });
        }

        if (lic.status_final !== "ATIVO") {
            return res.status(403).json({ erro: "Licença não ativa" });
        }

        // 🔥 conta usuários (IGNORANDO deletados)
        const count = await pool.query(
            `SELECT COUNT(*) 
             FROM usuarios 
             WHERE licenca_chave=$1 
             AND deleted IS NOT TRUE`,
            [chave]
        );

        const total = Number(count.rows[0].count);

        // 🔥 limite de usuários
        if (total >= lic.max_usuarios) {
            return res.status(403).json({ erro: "Limite de usuários atingido" });
        }

        // 🔹 hash senha
        const senhaHash = await bcrypt.hash(senha, 10);

        console.log("🔥 Inserindo usuário...");

        // 🔥 garante 1 OWNER por licença
        const ownerExistente = await pool.query(
            `
            SELECT id FROM usuarios 
            WHERE licenca_chave = $1 
            AND is_owner = true
            AND deleted IS NOT TRUE
            LIMIT 1
            `,
            [chave]
        );

        let isOwner = false;

        if (ownerExistente.rowCount === 0) {
            isOwner = true;
        }

        // 🔹 INSERT CORRETO (COM RETURNING)
        const resultInsert = await pool.query(
            `
            INSERT INTO usuarios (
                nome,
                email,
                senha,
                licenca_chave,
                is_owner,
                criado_em,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id
            `,
            [nome, email, senhaHash, chave, isOwner, Date.now(), Date.now()]
        );

        console.log("✅ Usuário criado com sucesso");

        // 🔥 RESPOSTA CORRETA
        res.json({
            sucesso: true,
            id: resultInsert.rows[0].id
        });

    } catch (err) {
        console.error("❌ ERRO CRIAR USUARIO:", err);
        res.status(500).json({ erro: "Erro interno", detalhe: err.message });
    }
});
// =============================
// 🔹 USUÁRIOS (COM SYNC)
// =============================
app.get("/api/v1/licenca/usuarios", async (req, res) => {

    const { chave, lastSync } = req.query;
let query = `
    SELECT id, nome, email, criado_em, is_owner, updated_at, deleted
    FROM usuarios 
    WHERE licenca_chave=$1
    AND deleted IS NOT TRUE
`;

    const params = [chave];

    if (Number(lastSync) > 0) {
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

    if (!id) {
        return res.status(400).json({ erro: "ID obrigatório" });
    }

    await pool.query(
        `UPDATE usuarios 
         SET deleted = true, updated_at = $1 
         WHERE id=$2`,
        [Date.now(), id]
    );

    res.json({ ok: true });
});
