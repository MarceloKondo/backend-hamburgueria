const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");

const db = new sqlite3.Database("./licencas.db");

async function criar() {
    const nome = "Marcelo";
    const email = "CUDOCARALHO";
    const senha = "123456"; 
    const hash = await bcrypt.hash(senha, 10);

    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        senha TEXT NOT NULL,
        criado_em INTEGER DEFAULT (strftime('%s','now'))
    )`);

    db.run(`INSERT INTO usuarios (nome, email, senha) VALUES (?, ?, ?)`, [nome, email, hash], function(err){
        if(err){
            console.log("Erro:", err.message);
        } else {
            console.log("Usuário criado com sucesso! ID:", this.lastID);
        }
        db.close();
    });
}

criar();