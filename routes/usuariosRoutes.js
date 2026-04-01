const express = require("express")
const router = express.Router()

const usuariosController = require("../controllers/usuariosController")
const autenticarToken = require("../middleware/auth")

router.post("/api/v1/login", usuariosController.login)

router.post("/api/v1/usuarios", usuariosController.criarUsuario)

router.get("/api/v1/usuarios", autenticarToken, usuariosController.listarUsuarios)

module.exports = router