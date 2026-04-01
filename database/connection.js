const { Pool } = require("pg")

const pool = new Pool({
    user: "postgres",
    host: "localhost",
    database: "hamburgueria",
    password: "1984",
    port: 5432
})

module.exports = pool