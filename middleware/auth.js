const jwt = require("jsonwebtoken")

const SECRET = "segredo_super_forte"

function autenticarToken(req,res,next){

    const authHeader = req.headers['authorization']

    if(!authHeader){
        return res.status(401).send("Token não enviado")
    }

    const token = authHeader.split(" ")[1]

    if(!token){
        return res.status(401).send("Token inválido")
    }

    jwt.verify(token, SECRET, (erro,usuario)=>{

        if(erro){
            return res.status(403).send("Token inválido")
        }

        req.usuario = usuario

        next()

    })

}

module.exports = autenticarToken