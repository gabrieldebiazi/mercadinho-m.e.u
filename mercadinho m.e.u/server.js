require('dotenv').config();

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool, types } = require('pg');

if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
    console.error('Defina DATABASE_URL e JWT_SECRET no arquivo .env (veja .env.example).');
    process.exit(1);
}

// O pg devolve "numeric" como texto; aqui convertemos para número (preço)
types.setTypeParser(1700, valor => parseFloat(valor));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const app = express();

const PRODUCAO = process.env.NODE_ENV === 'production';
const CATEGORIAS = ['Alimentos', 'Bebidas', 'Casa', 'Roupas'];
const COLUNAS_PRODUTO = 'id, nome, categoria, preco, estoque, imagem_url, descricao';
const OPCOES_COOKIE = { httpOnly: true, sameSite: 'lax', secure: PRODUCAO };
// usado para gastar o mesmo tempo quando o e-mail não existe (evita descobrir e-mails cadastrados)
const HASH_FALSO = bcrypt.hashSync('senha-falsa', 10);

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
// Só a pasta "public" fica acessível pelo navegador. server.js e .env ficam de fora.
app.use(express.static(path.join(__dirname, 'public')));

const erro = (res, status, mensagem) => res.status(status).json({ erro: mensagem });

/* ---------- Autenticação ---------- */

function criarSessao(res, usuario) {
    const token = jwt.sign({ sub: usuario.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { ...OPCOES_COOKIE, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

// Lê o cookie e busca o usuário atual no banco (assim mudar o papel vale na hora)
async function carregarUsuario(req) {
    const token = req.cookies.token;
    if (!token) return null;

    let id;
    try {
        id = jwt.verify(token, process.env.JWT_SECRET).sub;
    } catch {
        return null;
    }

    const { rows } = await pool.query(
        'select id, nome, email, papel from usuarios where id = $1', [id]
    );
    return rows[0] || null;
}

const exigirPapel = papel => async (req, res, next) => {
    const usuario = await carregarUsuario(req);
    if (!usuario) return erro(res, 401, 'Faça login para continuar.');
    if (usuario.papel !== papel) return erro(res, 403, 'Acesso restrito.');
    req.usuario = usuario;
    next();
};

const limiteAuth = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { erro: 'Muitas tentativas. Tente novamente em alguns minutos.' }
});

app.post('/api/cadastro', limiteAuth, async (req, res) => {
    const nome = String(req.body.nome ?? '').trim();
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const senha = String(req.body.senha ?? '');

    if (!nome || nome.length > 100) return erro(res, 400, 'Informe um nome válido.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return erro(res, 400, 'Informe um e-mail válido.');
    if (senha.length < 6 || senha.length > 72) return erro(res, 400, 'A senha deve ter entre 6 e 72 caracteres.');

    const senhaHash = await bcrypt.hash(senha, 10);

    try {
        const { rows } = await pool.query(
            `insert into usuarios (nome, email, senha_hash) values ($1, $2, $3)
             returning id, nome, email, papel`,
            [nome, email, senhaHash]
        );
        criarSessao(res, rows[0]);
        res.status(201).json({ usuario: rows[0] });
    } catch (e) {
        if (e.code === '23505') return erro(res, 409, 'Este e-mail já está cadastrado.');
        throw e;
    }
});

app.post('/api/login', limiteAuth, async (req, res) => {
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const senha = String(req.body.senha ?? '');

    const { rows } = await pool.query(
        'select id, nome, email, papel, senha_hash from usuarios where email = $1', [email]
    );
    const usuario = rows[0];
    const confere = await bcrypt.compare(senha, usuario ? usuario.senha_hash : HASH_FALSO);

    if (!usuario || !confere) return erro(res, 401, 'E-mail ou senha incorretos.');

    criarSessao(res, usuario);
    res.json({ usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel } });
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('token', OPCOES_COOKIE);
    res.json({ ok: true });
});

app.get('/api/me', async (req, res) => {
    res.json({ usuario: await carregarUsuario(req) });
});

/* ---------- Produtos ---------- */

// GET /api/produtos            -> todos
// GET /api/produtos?ids=1,2,3  -> só os ids pedidos (usado pelo carrinho)
app.get('/api/produtos', async (req, res) => {
    if (req.query.ids !== undefined) {
        const ids = String(req.query.ids).split(',').map(Number).filter(Number.isInteger).slice(0, 100);
        const { rows } = await pool.query(
            `select ${COLUNAS_PRODUTO} from produtos where id = any($1::int[]) order by nome`, [ids]
        );
        return res.json(rows);
    }

    const { rows } = await pool.query(`select ${COLUNAS_PRODUTO} from produtos order by nome`);
    res.json(rows);
});

app.get('/api/produtos/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return erro(res, 404, 'Produto não encontrado.');

    const { rows } = await pool.query(`select ${COLUNAS_PRODUTO} from produtos where id = $1`, [id]);
    if (!rows[0]) return erro(res, 404, 'Produto não encontrado.');
    res.json(rows[0]);
});

function validarProduto(corpo) {
    const nome = String(corpo.nome ?? '').trim();
    const preco = Number(corpo.preco);
    const estoque = Number(corpo.estoque);
    const imagem_url = corpo.imagem_url ? String(corpo.imagem_url).trim() : null;
    const descricao = corpo.descricao ? String(corpo.descricao).trim() : null;

    if (!nome || nome.length > 120) return { mensagem: 'Nome inválido.' };
    if (!CATEGORIAS.includes(corpo.categoria)) return { mensagem: 'Categoria inválida.' };
    if (!Number.isFinite(preco) || preco < 0 || preco > 1000000) return { mensagem: 'Preço inválido.' };
    if (!Number.isInteger(estoque) || estoque < 0) return { mensagem: 'Estoque inválido.' };
    if (imagem_url && !/^https?:\/\//i.test(imagem_url)) return { mensagem: 'A URL da imagem deve começar com http:// ou https://.' };

    return { dados: [nome, corpo.categoria, preco, estoque, imagem_url, descricao] };
}

app.post('/api/produtos', exigirPapel('gerente'), async (req, res) => {
    const { dados, mensagem } = validarProduto(req.body);
    if (mensagem) return erro(res, 400, mensagem);

    const { rows } = await pool.query(
        `insert into produtos (nome, categoria, preco, estoque, imagem_url, descricao)
         values ($1, $2, $3, $4, $5, $6) returning ${COLUNAS_PRODUTO}`, dados
    );
    res.status(201).json(rows[0]);
});

app.put('/api/produtos/:id', exigirPapel('gerente'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return erro(res, 404, 'Produto não encontrado.');

    const { dados, mensagem } = validarProduto(req.body);
    if (mensagem) return erro(res, 400, mensagem);

    const { rows } = await pool.query(
        `update produtos set nome = $1, categoria = $2, preco = $3, estoque = $4,
                imagem_url = $5, descricao = $6
         where id = $7 returning ${COLUNAS_PRODUTO}`, [...dados, id]
    );
    if (!rows[0]) return erro(res, 404, 'Produto não encontrado.');
    res.json(rows[0]);
});

app.delete('/api/produtos/:id', exigirPapel('gerente'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return erro(res, 404, 'Produto não encontrado.');

    const { rowCount } = await pool.query('delete from produtos where id = $1', [id]);
    if (!rowCount) return erro(res, 404, 'Produto não encontrado.');
    res.status(204).end();
});

/* ---------- Erros ---------- */

app.use('/api', (req, res) => erro(res, 404, 'Rota não encontrada.'));

app.use((err, req, res, next) => {
    console.error(err);
    erro(res, 500, 'Erro interno do servidor.');
});

const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => console.log(`Mercadinho rodando em http://localhost:${PORTA}`));