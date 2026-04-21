const pool = require("../database/connection")
const bcrypt = require("bcrypt")
const jwt = require("jsonwebtoken")

const SECRET = "segredo_super_forte"

// =============================
// LISTAR USUÁRIOS (COM LICENÇA)
// =============================
async function listarUsuarios(req, res) {

    try {

        const { licenca } = req.query

        if (!licenca) {
            return res.status(400).send("Licença obrigatória")
        }

        const resultado = await pool.query(
            `
            SELECT id, nome, email, is_owner, created_at, updated_at
            FROM usuarios
            WHERE licenca_chave = $1
            AND deleted IS NOT TRUE
            ORDER BY id DESC
            `,
            [licenca]
        )

        res.json({
            lista: resultado.rows
        })

    } catch (erro) {

        console.error(erro)
        res.status(500).send("Erro ao buscar usuarios")

    }
}

// =============================
// CRIAR USUÁRIO (COM LICENÇA)
// =============================
async function criarUsuario(req, res) {

    try {

        const { nome, email, senha, licenca } = req.body

        if (!nome || !email || !senha || !licenca) {
            return res.status(400).send("Dados obrigatórios faltando")
        }

        // verifica licença
        const lic = await pool.query(
            "SELECT * FROM licencas WHERE chave = $1",
            [licenca]
        )

        if (lic.rows.length === 0) {
            return res.status(404).send("Licença não encontrada")
        }

        const senhaHash = await bcrypt.hash(senha, 10)

        // conta usuários ativos da licença
        const count = await pool.query(
            `
            SELECT COUNT(*) 
            FROM usuarios 
            WHERE licenca_chave=$1 
            AND deleted IS NOT TRUE
            `,
            [licenca]
        )

        const total = Number(count.rows[0].count)

        if (total >= lic.rows[0].max_usuarios) {
            return res.status(403).send("Limite de usuários atingido")
        }

        // garante 1 owner por licença
        const ownerExistente = await pool.query(
            `
            SELECT id FROM usuarios
            WHERE licenca_chave=$1
            AND is_owner = true
            AND deleted IS NOT TRUE
            LIMIT 1
            `,
            [licenca]
        )

        const isOwner = ownerExistente.rowCount === 0

        const resultado = await pool.query(
            `
            INSERT INTO usuarios (
                nome,
                email,
                senha,
                licenca_chave,
                is_owner,
                created_at,
                updated_at
            )
            VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
            RETURNING id, nome, email
            `,
            [nome, email, senhaHash, licenca, isOwner]
        )

        res.json({
            sucesso: true,
            usuario: resultado.rows[0]
        })

    } catch (erro) {

        console.error(erro)
        res.status(500).send("Erro ao criar usuario")

    }
}

// =============================
// LOGIN (COM LICENÇA CORRIGIDO)
// =============================
async function login(req, res) {

    try {

        const { email, senha } = req.body

        const resultado = await pool.query(
            `
            SELECT * 
            FROM usuarios 
            WHERE email=$1 
            AND deleted IS NOT TRUE
            `,
            [email]
        )

        if (resultado.rows.length === 0) {
            return res.status(401).send("Usuario não encontrado")
        }

        const usuario = resultado.rows[0]

        const senhaValida = await bcrypt.compare(senha, usuario.senha)

        if (!senhaValida) {
            return res.status(401).send("Senha inválida")
        }

        const token = jwt.sign(
            { id: usuario.id, email: usuario.email },
            SECRET,
            { expiresIn: "1d" }
        )

        // 🔥 IMPORTANTE: SEM ISSO SUA LICENÇA QUEBRA NO ANDROID
        res.json({
            token,
            usuario: {
                id: usuario.id,
                nome: usuario.nome,
                email: usuario.email,
                licenca: usuario.licenca_chave || "", // 🔥 FIX CRÍTICO
                isOwner: usuario.is_owner || false
            }
        })

    } catch (erro) {

        console.error(erro)
        res.status(500).send("Erro no login")

    }
}

module.exports = {
    listarUsuarios,
    criarUsuario,
    login
}
