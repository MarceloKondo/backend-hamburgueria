package com.example.hamburgueria.activities

import android.content.Intent
import android.os.Bundle
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.example.hamburgueria.R
import com.example.hamburgueria.database.AppDatabase
import com.example.hamburgueria.databinding.ActivityLoginBinding
import com.example.hamburgueria.security.license.*
import com.example.hamburgueria.security.session.SessionManager
import com.example.hamburgueria.security.session.UsuarioSessao
import com.example.hamburgueria.sync.UsuarioSync
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.*
import kotlin.random.Random

class LoginActivity : AppCompatActivity() {

    private lateinit var binding: ActivityLoginBinding
    private lateinit var foodBack: FrameLayout

    private val colunas = 14
    private val duracaoQueda = 4500L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        binding = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)

        foodBack = findViewById(R.id.foodContainerBack)

        iniciarComidas()

        binding.btnEntrar.setOnClickListener { realizarLogin() }

        binding.btnAtivarLicenca.setOnClickListener {
            startActivity(Intent(this, AtivacaoLicencaActivity::class.java))
        }
    }

    private fun iniciarComidas() {

        val larguraTela = resources.displayMetrics.widthPixels
        val espaco = larguraTela / colunas

        lifecycleScope.launch {
            while (true) {
                for (i in 0 until colunas) {
                    criarComidaColuna(i, espaco)
                }
                delay(120)
            }
        }
    }

    private fun criarComidaColuna(index: Int, espaco: Int) {

        val imagens = listOf(
            R.drawable.burger,
            R.drawable.fries,
            R.drawable.chicken,
            R.drawable.soda
        )

        val img = ImageView(this)

        val size = 42
        val params = FrameLayout.LayoutParams(size, size)

        val baseX = index * espaco + (espaco / 2)

        params.leftMargin = baseX - (size / 2)
        params.topMargin = -120

        img.layoutParams = params
        img.setPadding(6, 6, 6, 6)
        img.setImageResource(imagens[index % imagens.size])

        img.alpha = 0.75f
        img.scaleX = 0.95f
        img.scaleY = 0.95f

        foodBack.addView(img)

        val altura = resources.displayMetrics.heightPixels

        img.animate()
            .translationY(altura.toFloat() + 200f)
            .setDuration(duracaoQueda)
            .setInterpolator(android.view.animation.LinearInterpolator())
            .withEndAction { foodBack.removeView(img) }
            .start()
    }

    private fun realizarLogin() {

        val login = binding.etLogin.text.toString().trim()
        val senha = binding.etSenha.text.toString().trim()

        if (login.isEmpty() || senha.isEmpty()) {
            Toast.makeText(this, "Informe login e senha", Toast.LENGTH_SHORT).show()
            return
        }

        lifecycleScope.launch {

            binding.btnEntrar.isEnabled = false
            binding.tvBtnEntrar.text = "Entrando..."

            try {

                val deviceId = DeviceIdProvider.getId(this@LoginActivity)

                val response = withContext(Dispatchers.IO) {
                    LicenseApi.login(login, senha)
                }

                if (response == null) {
                    Toast.makeText(this@LoginActivity, "Erro de conexão", Toast.LENGTH_LONG).show()
                    return@launch
                }

                if (response.has("erro_real")) {
                    Toast.makeText(this@LoginActivity, response.optString("erro_real"), Toast.LENGTH_LONG).show()
                    return@launch
                }

                val token = response.optString("token", "")
                val usuarioObj = response.optJSONObject("usuario")

                if (token.isBlank() || usuarioObj == null) {
                    Toast.makeText(this@LoginActivity, "Login inválido", Toast.LENGTH_LONG).show()
                    return@launch
                }

                val idUsuario = usuarioObj.optLong("id", -1)
                if (idUsuario <= 0) {
                    Toast.makeText(this@LoginActivity, "Usuário inválido", Toast.LENGTH_LONG).show()
                    return@launch
                }

                val email = usuarioObj.optString("email", login)
                val nome = usuarioObj.optString("nome", email)
                val isOwner = usuarioObj.optBoolean("isOwner", false)
                val licenca = usuarioObj.optString("licenca", "")

                val db = AppDatabase.getDatabase(this@LoginActivity)
                val usuarioDao = db.usuarioDao()

                // =========================
                // 🔥 LICENÇA (CORRIGIDA DE VERDADE)
                // =========================
                if (licenca.isNotBlank()) {

                    LicencaProvider.salvar(this@LoginActivity, licenca)

                    val validacao = withContext(Dispatchers.IO) {
                        LicenseApi.validarLicenca(licenca, deviceId)
                    }

                    val expiraEm = validacao.optLong("expiraEm", 0L)

                    withContext(Dispatchers.IO) {
                        db.licencaDao().salvar(
                            com.example.hamburgueria.model.Licenca(
                                id = 1,
                                chave = licenca,
                                status = "ATIVA",
                                dataValidade = expiraEm, // 🔥 AGORA CORRETO
                                ultimaValidacao = System.currentTimeMillis(),
                                ultimaDataConfiavel = System.currentTimeMillis(),
                                dispositivoAtualId = deviceId,
                                diasToleranciaOffline = 3,
                                maxDispositivos = 1,
                                modoOfflinePermitido = true
                            )
                        )
                    }
                }

                withContext(Dispatchers.IO) {

                    usuarioDao.deslogarTodos()

                    val usuarioExistente = usuarioDao.buscarPorId(idUsuario)

                    if (usuarioExistente == null) {

                        usuarioDao.inserir(
                            com.example.hamburgueria.model.Usuario(
                                idUsuario = idUsuario,
                                login = email,
                                hashSenha = "",
                                ativo = true,
                                logado = true,
                                imutavel = false,
                                isOwner = isOwner,
                                dataCriacao = Date()
                            )
                        )

                    } else {
                        usuarioDao.atualizar(
                            usuarioExistente.copy(
                                ativo = true,
                                logado = true,
                                isOwner = isOwner
                            )
                        )
                    }

                    UsuarioSync.sincronizar(this@LoginActivity, db)
                }

                EventoApi.enviar(
                    evento = "LOGIN",
                    login = email,
                    email = email,
                    dataAtivacao = System.currentTimeMillis(),
                    deviceId = deviceId
                )

                SessionManager.iniciarSessao(
                    UsuarioSessao(idUsuario, nome, email, senha, isOwner),
                    token
                )

                startActivity(Intent(this@LoginActivity, MainActivity::class.java))
                finish()

            } catch (e: Exception) {
                e.printStackTrace()
                Toast.makeText(this@LoginActivity, "Erro inesperado", Toast.LENGTH_LONG).show()
            } finally {
                binding.btnEntrar.isEnabled = true
                binding.tvBtnEntrar.text = "Entrar"
            }
        }
    }
}


package com.example.hamburgueria.security.license

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object EventoApi {

    private const val URL_EVENTO = "http://192.168.15.10:3000/api/v1/eventos"

    fun enviar(
        evento: String,
        login: String?,
        email: String?,
        dataAtivacao: Long?,
        deviceId: String?
    ) {
        Thread {
            try {
                val url = URL(URL_EVENTO)
                val conn = url.openConnection() as HttpURLConnection

                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                conn.connectTimeout = 5000
                conn.readTimeout = 5000

                val body = JSONObject()
                body.put("evento", evento)
                body.put("login", login)
                body.put("email", email)
                body.put("data_ativacao", dataAtivacao)
                body.put("deviceId", deviceId)

                conn.outputStream.write(body.toString().toByteArray())

                conn.responseCode // só dispara

            } catch (e: Exception) {
                e.printStackTrace()
            }
        }.start()
    }
}

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

app.get("/Dominus.apk", (req, res) => {
    res.download(path.resolve(__dirname, "Dominus.apk"));
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
// 🔹 IMPORTANTE - APP VERSAO
// =============================
app.get("/api/v1/app/versao", async (req, res) => {
    try {
        res.json({
            versionCode: 2,
            versionName: "1.0.0",
            forceUpdate: true,
            apkUrl: "https://hamburgueria-api-74br.onrender.com/Dominus.apk",
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
    expiraEm: expiraEm,
    chave: lic.chave,
    status: lic.status_final,
    dispositivoId: lic.dispositivo_id
    });
        
      } catch (err) {
        console.error("❌ ERRO VALIDAR:", err);
        res.status(500).json({ valida: false });
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
// 🔹 PERMISSOES USUARIO
// =============================
app.get("/api/v1/licenca/permissoes", async (req, res) => {

    try {

        const { chave, usuarioId } = req.query;

        if (!chave || !usuarioId) {
            return res.status(400).json({ erro: "Dados obrigatórios" });
        }

        const { rows } = await pool.query(
            `
            SELECT id, usuario_id, codigo_acao, pode_executar, exige_senha, updated_at
            FROM usuario_permissoes
            WHERE licenca_chave = $1
            AND usuario_id = $2
            `,
            [chave, usuarioId]
        );

        res.json({
            lista: rows
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro interno" });
    }
});

// =============================
// 🔹 SALVAR PERMISSOES
// =============================

app.post("/api/v1/licenca/permissoes/salvar", async (req, res) => {

    try {

        const {
            chave,
            usuarioId,
            codigoAcao,
            podeExecutar,
            exigeSenha
        } = req.body;

        if (!chave || !usuarioId || !codigoAcao) {
            return res.status(400).json({ erro: "Dados obrigatórios" });
        }

        await pool.query(
            `
            INSERT INTO usuario_permissoes (
                licenca_chave,
                usuario_id,
                codigo_acao,
                pode_executar,
                exige_senha,
                updated_at
            )
            VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT (usuario_id, codigo_acao, licenca_chave)
            DO UPDATE SET
                pode_executar = EXCLUDED.pode_executar,
                exige_senha = EXCLUDED.exige_senha,
                updated_at = EXCLUDED.updated_at
            `,
            [
                chave,
                usuarioId,
                codigoAcao,
                podeExecutar,
                exigeSenha,
                Date.now()
            ]
        );

        res.json({ ok: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro interno" });
    }
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
        const now = Date.now();

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
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING id, nome, email, updated_at
    `,
    [nome, email, senhaHash, chave, isOwner, now, now]
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
// 🔹 USUÁRIOS (lista)
// =============================
app.get("/api/v1/licenca/usuarios", async (req, res) => {

    const { chave, lastSync } = req.query;

    let query = `
        SELECT id, nome, email, is_owner, criado_em, updated_at, deleted
        FROM usuarios 
        WHERE licenca_chave = $1
        AND deleted IS NOT TRUE
    `;

    const params = [chave];

    if (Number(lastSync) > 0) {
        query += " AND updated_at > $2";
        params.push(Number(lastSync));
    }

    query += " ORDER BY updated_at DESC NULLS LAST";

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


<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8">
<title>Painel SaaS</title>

<style>
body {
    margin:0;
    font-family: Arial;
    background:#0f172a;
    color:#e2e8f0;
    padding:20px;
}
.hidden { display:none; }

.header {
    display:flex;
    justify-content:space-between;
    align-items:center;
}

.cards {
    display:flex;
    gap:10px;
    margin:20px 0;
    flex-wrap:wrap;
}

.card {
    background:#1e293b;
    padding:15px;
    border-radius:8px;
    text-align:center;
    min-width:140px;
}

input {
    padding:8px;
    margin:5px;
    border-radius:5px;
    border:none;
}

button {
    padding:6px 10px;
    margin:2px;
    border:none;
    border-radius:5px;
    cursor:pointer;
}

.btn-blue { background:#3b82f6; color:white; }
.btn-red { background:#ef4444; color:white; }
.btn-green { background:#22c55e; color:white; }
.btn-yellow { background:#eab308; color:black; }
.btn-copy { background:#444; color:white; }

#eventos { margin-top:20px; }

table {
    width:100%;
    border-collapse:collapse;
}

th, td {
    padding:10px;
    border-bottom:1px solid #334155;
}

.login-box {
    max-width:300px;
    margin:100px auto;
    text-align:center;
}
</style>
</head>

<body>

<div id="loginBox" class="login-box">
    <h2>🔐 Login Painel</h2>
    <input id="senha" type="password" placeholder="Senha"><br>
    <button class="btn-blue" onclick="login()">Entrar</button>
</div>

<div id="painel" class="hidden">

<div class="header">
    <h2>📊 Painel SaaS</h2>
    <div>
        <button onclick="trocarTab('licencas')" class="btn-blue">Licenças</button>
        <button onclick="trocarTab('eventos')" class="btn-yellow">Eventos</button>
        <button onclick="trocarTab('usuarios')" class="btn-green">Usuários</button>
        <button onclick="logout()" class="btn-red">Sair</button>
    </div>
</div>

<div class="cards" id="cards"></div>

<div id="licencasBox">
    <h3>➕ Gerar Licença</h3>
    <input id="cliente" placeholder="Cliente">
    <input id="dias" type="number" placeholder="Dias">
    <input id="maxUsuarios" type="number" placeholder="Max usuários">
    <button class="btn-blue" onclick="gerar()">Gerar</button>

    <table id="tabela"></table>
</div>

<div id="eventos" class="hidden">
    <h3>📡 Eventos</h3>
    <table id="tabelaEventos"></table>
</div>
    
<div id="usuarios" class="hidden">
    <h3>👤 Usuários</h3>
    <div id="usuariosContent"></div>
</div>

</div>

<script>

const API = "/api/v1/licenca";
const SENHA = "Mk@td040184";
let licencaSelecionada = null;

function login(){
    const s = document.getElementById("senha").value;
    if(s === SENHA){
        localStorage.setItem("auth", "ok");
        iniciarPainel();
    } else {
        alert("Senha incorreta");
    }
}

function logout(){
    localStorage.removeItem("auth");
    location.reload();
}

function iniciarPainel(){
    document.getElementById("loginBox").style.display = "none";
    document.getElementById("painel").style.display = "block";
    carregar();
}

function trocarTab(tab){
    const lic = document.getElementById("licencasBox");
    const evt = document.getElementById("eventos");
    const usr = document.getElementById("usuarios");

    lic.style.display = "none";
    evt.style.display = "none";
    usr.style.display = "none";

    if(tab === "eventos"){
        evt.style.display = "block";
        carregarEventos();
    } 
    else if(tab === "usuarios"){
        usr.style.display = "block";
        if(!licencaSelecionada){
            document.getElementById("usuariosContent").innerHTML = "Selecione uma licença";
        } else {
            carregarUsuarios(licencaSelecionada);
        }
    }
    else {
        lic.style.display = "block";
    }
}

async function carregar(){
    const res = await fetch(API + "/painel");
    const dados = await res.json();

    let html = "<tr><th>Cliente</th><th>Status</th><th>Chave</th><th>Dias</th><th>Usuários</th><th>Ações</th></tr>";

    dados.forEach(l=>{

        const status = l.statusFinal || "-";

        let diff = Number(l.expira_em) - Date.now();
        let dias = Math.floor(diff / 86400000);
        if(isNaN(dias) || dias < 0) dias = 0;

        html += `
        <tr>
            <td>${l.cliente_nome || "-"}</td>
            <td>${status}</td>
            <td>${l.chave}</td>
            <td>${dias}</td>
            <td>${l.usuarios_usados} / ${l.max_usuarios}</td>
            <td>
                <button class="btn-green" onclick="abrirUsuarios('${l.chave}')">Users</button>
                <button class="btn-red" onclick="bloquear('${l.chave}')">Bloq</button>
                <button class="btn-green" onclick="desbloquear('${l.chave}')">OK</button>
                <button class="btn-yellow" onclick="resetar('${l.chave}')">Reset</button>
                <button class="btn-blue" onclick="renovar('${l.chave}')">+30d</button>
                <button class="btn-red" onclick="deletar('${l.chave}')">Del</button>
                <button class="btn-copy" onclick="copiar('${l.chave}')">📋</button>
            </td>
        </tr>`;
    });

    document.getElementById("tabela").innerHTML = html;
}

function abrirUsuarios(chave){
    licencaSelecionada = chave;
    trocarTab('usuarios');
}

async function gerar(){
    await fetch(API+"/gerar",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
            cliente:document.getElementById("cliente").value,
            dias:Number(document.getElementById("dias").value) || 30,
            maxUsuarios:Number(document.getElementById("maxUsuarios").value) || 3
        })
    });

    carregar();
}

async function bloquear(c){
    await fetch(API+"/bloquear",{ method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({chave:c}) });
    carregar();
}

async function desbloquear(c){
    await fetch(API+"/desbloquear",{ method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({chave:c}) });
    carregar();
}

async function resetar(c){
    await fetch(API+"/resetar-dispositivos",{ method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({chave:c}) });
    carregar();
}

async function renovar(c){
    await fetch(API+"/renovar",{ method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({chave:c,dias:30}) });
    carregar();
}

async function deletar(c){
    if(!confirm("Excluir licença?")) return;
    await fetch(API+"/deletar",{ method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({chave:c}) });
    carregar();
}

function copiar(c){
    navigator.clipboard.writeText(c);
    alert("Copiado!");
}

async function carregarEventos(){
    const res = await fetch(API+"/evento");
    const dados = await res.json();

    let html = "<tr><th>Tipo</th><th>Email</th><th>Device</th><th>Data</th></tr>";

    dados.forEach(e=>{
        html += `<tr>
            <td>${e.tipo}</td>
            <td>${e.email || '-'}</td>
            <td>${e.device_id || '-'}</td>
            <td>${new Date(Number(e.data)).toLocaleString()}</td>
        </tr>`;
    });

    document.getElementById("tabelaEventos").innerHTML = html;
}

async function carregarUsuarios(chave){

    const res = await fetch(API+`/usuarios?chave=${chave}`);
    const data = await res.json();
    const users = data.lista || [];

    let html = `<h4>Licença: ${chave}</h4>`;

    // 🔥 FORM DE CRIAÇÃO
    html += `
    <div style="margin-bottom:10px;">
        <input id="nome" placeholder="Nome">
        <input id="email" placeholder="Email">
        <input id="senhaNovo" placeholder="Senha">
        <button onclick="criarUsuario()">Criar</button>
    </div>
    `;

    // 🔥 LISTA DE USUÁRIOS
    users.forEach(u => {

        const isOwner = u.is_owner ?? u.isOwner; // 🔥 compatível com backend
        const ownerTag = isOwner ? "👑 DONO" : "";

        html += `
        <div class="card" style="${isOwner ? 'border:2px solid gold' : ''}">
            
            <div style="margin-bottom:5px;">
                ${ownerTag}
            </div>

            <input id="n_${u.id}" value="${u.nome}">
            <input id="e_${u.id}" value="${u.email}">

            <button onclick="editar(${u.id})">Salvar</button>
            <button onclick="resetarSenha(${u.id})">Reset</button>
            <button onclick="deletarUsuario(${u.id})">Excluir</button>

            ${!isOwner ? `
                <button class="btn-yellow" onclick="setOwner(${u.id})">
                    👑 Tornar Dono
                </button>
            ` : ""}
        </div>
        `;
    });

    document.getElementById("usuariosContent").innerHTML = html;
}

async function criarUsuario(){

    const nome = document.getElementById("nome").value;
    const email = document.getElementById("email").value;
    const senha = document.getElementById("senhaNovo").value;

    const res = await fetch(API+"/criar-usuario",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({chave:licencaSelecionada,nome,email,senha})
    });

    const data = await res.json();
    if(data.erro){ alert(data.erro); return; }

    carregarUsuarios(licencaSelecionada);
}

async function editar(id){
    await fetch(API+"/editar-usuario",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
            id,
            nome:document.getElementById("n_"+id).value,
            email:document.getElementById("e_"+id).value
        })
    });
    alert("Atualizado");
}

async function resetarSenha(id){
    const senha = prompt("Nova senha:");
    if(!senha) return;

    await fetch(API+"/resetar-senha",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({id,novaSenha:senha})
    });

    alert("Senha atualizada");
}

async function setOwner(id){

    await fetch(API + "/set-owner", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
            chave: licencaSelecionada,
            userId: id
        })
    });

    alert("Owner atualizado!");
    carregarUsuarios(licencaSelecionada);
}
    
async function deletarUsuario(id){
    if(!confirm("Excluir usuário?")) return;

    await fetch(API+"/deletar-usuario",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({id})
    });

    carregarUsuarios(licencaSelecionada);
}

setInterval(()=>{
    if(localStorage.getItem("auth") === "ok"){
        carregar();
    }
}, 3000);

if(localStorage.getItem("auth") === "ok"){
    iniciarPainel();
}
    

</script>

</body>
</html>
