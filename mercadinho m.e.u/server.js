require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
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
const PAGAMENTOS = ['PIX', 'Cartão de Crédito', 'Cartão de Débito', 'Dinheiro'];
const TAXA_ENTREGA = Math.max(0, Number(process.env.TAXA_ENTREGA) || 0);
// status atual -> para quais status o pedido pode ir
const TRANSICOES = {
    pendente: ['em_separacao', 'cancelado'],
    em_separacao: ['pronto', 'cancelado'],
    pronto: ['concluido', 'cancelado'],
    concluido: [],
    cancelado: []
};
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

// exigirPapel('gerente', 'funcionario') aceita qualquer um dos papéis informados
const exigirPapel = (...papeis) => async (req, res, next) => {
    const usuario = await carregarUsuario(req);
    if (!usuario) return erro(res, 401, 'Faça login para continuar.');
    if (papeis.length && !papeis.includes(usuario.papel)) return erro(res, 403, 'Acesso restrito.');
    req.usuario = usuario;
    next();
};

// qualquer pessoa logada
const exigirLogin = exigirPapel();

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

/* ---------- Upload de imagens ---------- */

const PASTA_UPLOADS = path.join(__dirname, 'public', 'uploads', 'produtos');
fs.mkdirSync(PASTA_UPLOADS, { recursive: true });

const EXTENSOES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const upload = multer({
    storage: multer.diskStorage({
        destination: PASTA_UPLOADS,
        // nome gerado pelo servidor: nunca usamos o nome enviado pelo usuário
        filename: (req, file, cb) => cb(null, crypto.randomUUID() + EXTENSOES[file.mimetype])
    }),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, Boolean(EXTENSOES[file.mimetype]))
});

// Apaga do disco a imagem antiga (só se ela foi enviada por upload)
function apagarImagemLocal(url) {
    if (!url || !url.startsWith('/uploads/produtos/')) return;
    fs.unlink(path.join(PASTA_UPLOADS, path.basename(url)), () => {});
}

// A checagem de gerente vem ANTES do multer: quem não é gerente não grava nada no disco
app.post('/api/upload', exigirPapel('gerente'), (req, res) => {
    upload.single('imagem')(req, res, err => {
        if (err) {
            return erro(res, 400, err.code === 'LIMIT_FILE_SIZE'
                ? 'A imagem deve ter no máximo 2 MB.'
                : 'Não foi possível enviar a imagem.');
        }
        if (!req.file) return erro(res, 400, 'Envie uma imagem JPG, PNG ou WebP.');
        res.status(201).json({ url: '/uploads/produtos/' + req.file.filename });
    });
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
    if (imagem_url && !/^(https?:\/\/|\/uploads\/|imagens\/)/i.test(imagem_url)) return { mensagem: 'Endereço de imagem inválido. Use http(s)://..., imagens/... ou envie um arquivo.' };

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

    const { rows: anteriores } = await pool.query('select imagem_url from produtos where id = $1', [id]);

    const { rows } = await pool.query(
        `update produtos set nome = $1, categoria = $2, preco = $3, estoque = $4,
                imagem_url = $5, descricao = $6
         where id = $7 returning ${COLUNAS_PRODUTO}`, [...dados, id]
    );
    if (!rows[0]) return erro(res, 404, 'Produto não encontrado.');

    if (anteriores[0].imagem_url !== rows[0].imagem_url) apagarImagemLocal(anteriores[0].imagem_url);
    res.json(rows[0]);
});

app.delete('/api/produtos/:id', exigirPapel('gerente'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return erro(res, 404, 'Produto não encontrado.');

    const { rows } = await pool.query('delete from produtos where id = $1 returning imagem_url', [id]);
    if (!rows[0]) return erro(res, 404, 'Produto não encontrado.');

    apagarImagemLocal(rows[0].imagem_url);
    res.status(204).end();
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

// Funcionário e gerente veem todos os pedidos (os 200 mais recentes)
app.get('/api/pedidos', exigirPapel('funcionario', 'gerente'), async (req, res) => {
    const { rows } = await pool.query(`${SELECT_PEDIDO} group by p.id order by p.criado_em desc limit 200`);
    rows.forEach(p => delete p.usuario_id);
    res.json(rows);
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

// O cliente só enxerga os próprios pedidos; a equipe vê qualquer um
app.get('/api/pedidos/:id', exigirLogin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return erro(res, 404, 'Pedido não encontrado.');

    const { rows } = await pool.query(`${SELECT_PEDIDO} where p.id = $1 group by p.id`, [id]);
    const pedido = rows[0];
    const equipe = ['funcionario', 'gerente'].includes(req.usuario.papel);

    if (!pedido || (!equipe && pedido.usuario_id !== req.usuario.id)) {
        return erro(res, 404, 'Pedido não encontrado.');
    }

    delete pedido.usuario_id;
    res.json(pedido);
});

app.patch('/api/pedidos/:id/status', exigirPapel('funcionario', 'gerente'), async (req, res) => {
    const id = Number(req.params.id);
    const novo = req.body.status;

    if (!Number.isInteger(id) || !Object.hasOwn(TRANSICOES, novo)) return erro(res, 400, 'Status inválido.');

    try {
        await emTransacao(async cliente => {
            const { rows } = await cliente.query('select status from pedidos where id = $1 for update', [id]);
            if (!rows[0]) throw new ErroNegocio('Pedido não encontrado.', 404);
            if (!TRANSICOES[rows[0].status].includes(novo)) {
                throw new ErroNegocio('Esse pedido não pode mudar para esse status.', 409);
            }

            if (novo === 'cancelado') {
                // devolve os itens ao estoque
                await cliente.query(
                    `update produtos p set estoque = p.estoque + i.quantidade
                     from pedido_itens i where i.pedido_id = $1 and i.produto_id = p.id`, [id]
                );
            }

            await cliente.query('update pedidos set status = $1 where id = $2', [novo, id]);
        });

        res.json({ id, status: novo });
    } catch (e) {
        if (e instanceof ErroNegocio) return erro(res, e.status, e.message);
        throw e;
    }
});

/* ---------- Painel do gerente ---------- */

const LIMITE_ESTOQUE_BAIXO = 5; // mesmo valor usado em gerenciar.js
const FUSO = 'America/Sao_Paulo'; // "hoje" é o dia no horário de Brasília

app.get('/api/dashboard', exigirPapel('gerente'), async (req, res) => {
    const [pedidos, produtos, baixos] = await Promise.all([
        // vendas do dia = pedidos de hoje que não foram cancelados
        pool.query(
            `select coalesce(sum(total) filter (
                        where status <> 'cancelado'
                          and (criado_em at time zone $1::text)::date = (now() at time zone $1::text)::date
                    ), 0) as vendas_hoje,
                    (count(*) filter (where status = 'pendente'))::int as pendentes
             from pedidos`, [FUSO]
        ),
        pool.query(
            `select count(*)::int as total,
                    (count(*) filter (where estoque < $1))::int as baixo
             from produtos`, [LIMITE_ESTOQUE_BAIXO]
        ),
        pool.query(
            'select id, nome, estoque from produtos where estoque < $1 order by estoque, nome limit 100',
            [LIMITE_ESTOQUE_BAIXO]
        )
    ]);

    res.json({
        vendasHoje: pedidos.rows[0].vendas_hoje,
        pedidosPendentes: pedidos.rows[0].pendentes,
        produtosCadastrados: produtos.rows[0].total,
        estoqueBaixo: produtos.rows[0].baixo,
        limiteEstoqueBaixo: LIMITE_ESTOQUE_BAIXO,
        produtosEstoqueBaixo: baixos.rows
    });
});

/* ---------- Erros ---------- */

app.use('/api', (req, res) => erro(res, 404, 'Rota não encontrada.'));

app.use((err, req, res, next) => {
    console.error(err);
    erro(res, 500, 'Erro interno do servidor.');
});

const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => console.log(`Mercadinho rodando em http://localhost:${PORTA}`));