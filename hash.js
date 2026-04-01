const bcrypt = require("bcrypt");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

(async () => {
    const db = await open({ filename: "./licencas.db", driver: sqlite3.Database });
    const senhaHash = await bcrypt.hash("123456", 10);
    await db.run(
        "INSERT INTO usuarios (nome, email, senha) VALUES (?,?,?)",
        ["Marcelo", "marcelo2@email.com", senhaHash]
    );
    console.log("Usuário criado!");
})();