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
const PAGAMENTOS = ['PIX', 'Cartão de Crédito', 'Cartão de Débito', 'Dinheiro'];
const TAXA_ENTREGA = Math.max(0, Number(process.env.TAXA_ENTREGA) || 0);
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

// Lê o cookie e busca o usuário atual no banco
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
        'select id, nome, email from usuarios where id = $1', [id]
    );
    return rows[0] || null;
}

// Rotas que exigem alguém logado
const exigirLogin = async (req, res, next) => {
    const usuario = await carregarUsuario(req);
    if (!usuario) return erro(res, 401, 'Faça login para continuar.');
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
             returning id, nome, email`,
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
        'select id, nome, email, senha_hash from usuarios where email = $1', [email]
    );
    const usuario = rows[0];
    const confere = await bcrypt.compare(senha, usuario ? usuario.senha_hash : HASH_FALSO);

    if (!usuario || !confere) return erro(res, 401, 'E-mail ou senha incorretos.');

    criarSessao(res, usuario);
    res.json({ usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email } });
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

/* ---------- Pedidos ---------- */

class ErroNegocio extends Error {
    constructor(mensagem, status = 400) {
        super(mensagem);
        this.status = status;
    }
}

// Executa fn dentro de uma transação: tudo é gravado junto ou nada é gravado
async function emTransacao(fn) {
    const cliente = await pool.connect();
    try {
        await cliente.query('begin');
        const resultado = await fn(cliente);
        await cliente.query('commit');
        return resultado;
    } catch (e) {
        await cliente.query('rollback').catch(() => {});
        throw e;
    } finally {
        cliente.release();
    }
}

const SELECT_PEDIDO = `
    select p.id, p.usuario_id, p.nome_cliente, p.telefone, p.tipo, p.endereco, p.pagamento,
           p.status, p.subtotal, p.taxa_entrega, p.total, p.criado_em,
           coalesce(
               json_agg(json_build_object('nome', i.nome, 'quantidade', i.quantidade,
                                          'preco_unitario', i.preco_unitario) order by i.id)
               filter (where i.id is not null), '[]'::json) as itens
    from pedidos p
    left join pedido_itens i on i.pedido_id = p.id`;

const limitePedidos = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { erro: 'Muitos pedidos em pouco tempo. Tente novamente em alguns minutos.' }
});

app.get('/api/configuracao', (req, res) => {
    res.json({ taxaEntrega: TAXA_ENTREGA });
});

function validarPedido(corpo) {
    const nome = String(corpo.nome ?? '').trim();
    const telefone = String(corpo.telefone ?? '').trim();
    const digitos = telefone.replace(/\D/g, '');
    const endereco = String(corpo.endereco ?? '').trim();
    const { tipo, pagamento } = corpo;

    if (!nome || nome.length > 100) return { mensagem: 'Informe o seu nome.' };
    if (digitos.length < 10 || digitos.length > 11) return { mensagem: 'Informe um telefone válido com DDD.' };
    if (!['retirada', 'entrega'].includes(tipo)) return { mensagem: 'Escolha retirada ou entrega.' };
    if (tipo === 'entrega' && (!endereco || endereco.length > 200)) return { mensagem: 'Informe o endereço de entrega.' };
    if (!PAGAMENTOS.includes(pagamento)) return { mensagem: 'Escolha uma forma de pagamento.' };
    if (!Array.isArray(corpo.itens) || !corpo.itens.length || corpo.itens.length > 100) {
        return { mensagem: 'Seu carrinho está vazio.' };
    }

    // junta itens repetidos somando as quantidades
    const quantidades = new Map();
    for (const item of corpo.itens) {
        const id = Number(item?.id);
        const qtd = Number(item?.qtd);
        if (!Number.isInteger(id) || !Number.isInteger(qtd) || qtd < 1 || qtd > 1000) {
            return { mensagem: 'Itens do carrinho inválidos.' };
        }
        quantidades.set(id, (quantidades.get(id) || 0) + qtd);
    }

    return {
        nome, telefone, tipo, pagamento,
        endereco: tipo === 'entrega' ? endereco : null,
        itens: [...quantidades].map(([id, qtd]) => ({ id, qtd }))
    };
}

// O total é calculado AQUI com os preços do banco: o que vem do navegador não é confiável
app.post('/api/pedidos', limitePedidos, exigirLogin, async (req, res) => {
    const { mensagem, nome, telefone, tipo, endereco, pagamento, itens } = validarPedido(req.body);
    if (mensagem) return erro(res, 400, mensagem);

    try {
        const id = await emTransacao(async cliente => {
            // trava as linhas dos produtos (em ordem de id) para dois pedidos não venderem o mesmo estoque
            const ids = itens.map(i => i.id).sort((a, b) => a - b);
            const { rows } = await cliente.query(
                'select id, nome, preco, estoque from produtos where id = any($1::int[]) order by id for update', [ids]
            );
            const produtos = new Map(rows.map(p => [p.id, p]));

            let subtotal = 0; // em centavos, para não acumular erro de arredondamento
            for (const item of itens) {
                const p = produtos.get(item.id);
                if (!p) throw new ErroNegocio('Um dos produtos do carrinho não está mais disponível.', 409);
                if (p.estoque < item.qtd) {
                    throw new ErroNegocio(`Estoque insuficiente para "${p.nome}" (restam ${p.estoque}).`, 409);
                }
                subtotal += Math.round(p.preco * 100) * item.qtd;
            }

            const taxa = tipo === 'entrega' ? Math.round(TAXA_ENTREGA * 100) : 0;

            const { rows: [pedido] } = await cliente.query(
                `insert into pedidos (usuario_id, nome_cliente, telefone, tipo, endereco, pagamento,
                                      subtotal, taxa_entrega, total)
                 values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
                [req.usuario.id, nome, telefone, tipo, endereco, pagamento,
                 subtotal / 100, taxa / 100, (subtotal + taxa) / 100]
            );

            for (const item of itens) {
                const p = produtos.get(item.id);
                await cliente.query(
                    `insert into pedido_itens (pedido_id, produto_id, nome, preco_unitario, quantidade)
                     values ($1, $2, $3, $4, $5)`,
                    [pedido.id, p.id, p.nome, p.preco, item.qtd]
                );
                await cliente.query('update produtos set estoque = estoque - $1 where id = $2', [item.qtd, p.id]);
            }

            return pedido.id;
        });

        res.status(201).json({ id });
    } catch (e) {
        if (e instanceof ErroNegocio) return erro(res, e.status, e.message);
        throw e;
    }
});

// Todos os pedidos de quem está logado, do mais recente para o mais antigo
app.get('/api/meus-pedidos', exigirLogin, async (req, res) => {
    const { rows } = await pool.query(
        `${SELECT_PEDIDO} where p.usuario_id = $1 group by p.id order by p.criado_em desc limit 100`,
        [req.usuario.id]
    );
    rows.forEach(p => delete p.usuario_id);
    res.json(rows);
});

// Cada cliente só enxerga os próprios pedidos
app.get('/api/pedidos/:id', exigirLogin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return erro(res, 404, 'Pedido não encontrado.');

    const { rows } = await pool.query(`${SELECT_PEDIDO} where p.id = $1 group by p.id`, [id]);
    const pedido = rows[0];

    if (!pedido || pedido.usuario_id !== req.usuario.id) {
        return erro(res, 404, 'Pedido não encontrado.');
    }

    delete pedido.usuario_id;
    res.json(pedido);
});

/* ---------- Erros ---------- */

app.use('/api', (req, res) => erro(res, 404, 'Rota não encontrada.'));

app.use((err, req, res, next) => {
    console.error(err);
    erro(res, 500, 'Erro interno do servidor.');
});

const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => console.log(`Mercadinho rodando em http://localhost:${PORTA}`));