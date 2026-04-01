const pool = require("../database/connection")
const bcrypt = require("bcrypt")
const jwt = require("jsonwebtoken")

const SECRET = "segredo_super_forte"

async function listarUsuarios(req,res){

    try{

        const resultado = await pool.query("SELECT id,nome,email FROM usuarios")

        res.json(resultado.rows)

    }catch(erro){

        console.error(erro)
        res.status(500).send("Erro ao buscar usuarios")

    }

}

async function criarUsuario(req,res){

    try{

        const { nome, email, senha } = req.body

        const senhaHash = await bcrypt.hash(senha,10)

        const resultado = await pool.query(
            "INSERT INTO usuarios (nome,email,senha) VALUES ($1,$2,$3) RETURNING id,nome,email",
            [nome,email,senhaHash]
        )

        res.json(resultado.rows[0])

    }catch(erro){

        console.error(erro)
        res.status(500).send("Erro ao criar usuario")

    }

}

async function login(req,res){

    try{

        const { email, senha } = req.body

        const resultado = await pool.query(
            "SELECT * FROM usuarios WHERE email=$1",
            [email]
        )

        if(resultado.rows.length === 0){
            return res.status(401).send("Usuario não encontrado")
        }

        const usuario = resultado.rows[0]

        const senhaValida = await bcrypt.compare(senha,usuario.senha)

        if(!senhaValida){
            return res.status(401).send("Senha inválida")
        }

        const token = jwt.sign(
            { id: usuario.id, email: usuario.email },
            SECRET,
            { expiresIn: "1d" }
        )

        res.json({
            usuario:{
                id:usuario.id,
                nome:usuario.nome,
                email:usuario.email
            },
            token
        })

    }catch(erro){

        console.error(erro)
        res.status(500).send("Erro no login")

    }

}

module.exports = {
    listarUsuarios,
    criarUsuario,
    login
}