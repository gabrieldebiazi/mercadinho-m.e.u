// Funções compartilhadas entre as páginas.
// Carregue depois de api.js e antes do script da página.

const CHAVE_CARRINHO = 'carrinho';

const moeda = valor => 'R$ ' + Number(valor).toFixed(2).replace('.', ',');

// Escapa texto vindo do banco antes de colocar em innerHTML
const esc = texto => String(texto ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

// tipo: '' (informativo), 'erro' ou 'sucesso'
function mostrarMensagem(el, texto, tipo = '') {
    if (!el) return;
    el.textContent = texto;
    el.className = ('mensagem ' + tipo).trim();
    el.hidden = false;
}

/* ---------- Carrinho (guardado no navegador) ---------- */

function getCarrinho() {
    try {
        const dados = JSON.parse(localStorage.getItem(CHAVE_CARRINHO));
        return Array.isArray(dados) ? dados : [];
    } catch {
        return [];
    }
}

function salvarCarrinho(itens) {
    try {
        localStorage.setItem(CHAVE_CARRINHO, JSON.stringify(itens));
    } catch (e) {
        console.error('Não foi possível salvar o carrinho', e);
    }
    atualizarContadorCarrinho();
}

// Retorna { qtd, limitado }: quantidade final no carrinho e se o estoque limitou o pedido
function adicionarAoCarrinho(produto, qtd = 1) {
    const itens = getCarrinho();
    const limite = Number.isFinite(produto.estoque) ? produto.estoque : Infinity;
    let item = itens.find(i => i.id === produto.id);

    if (!item) {
        item = { id: produto.id, qtd: 0 };
        itens.push(item);
    }

    // sempre atualiza os dados com o que veio do banco
    item.nome = produto.nome;
    item.preco = Number(produto.preco);
    item.imagem_url = produto.imagem_url || null;
    item.estoque = produto.estoque;

    const desejada = item.qtd + qtd;
    item.qtd = Math.min(desejada, limite);

    salvarCarrinho(itens);
    return { qtd: item.qtd, limitado: item.qtd < desejada };
}

function atualizarContadorCarrinho() {
    const link = document.querySelector('.barraNavegacao a[href="carrinho.html"]');
    if (!link) return;
    const total = getCarrinho().reduce((soma, i) => soma + i.qtd, 0);
    link.textContent = total ? `Carrinho (${total})` : 'Carrinho';
}

/* ---------- Sincronizar carrinho com o banco ---------- */

// Confere preço e estoque atuais (o localStorage pode estar desatualizado).
// Retorna true se algum item foi removido por indisponibilidade.
async function sincronizarCarrinho() {
    const itens = getCarrinho();
    if (!itens.length) return false;

    let data;
    try {
        data = await api('/produtos?ids=' + itens.map(i => i.id).join(','));
    } catch (e) {
        console.error(e);
        return false;
    }

    const atuais = new Map(data.map(p => [p.id, p]));

    const atualizados = itens
        .filter(i => atuais.has(i.id) && atuais.get(i.id).estoque > 0)
        .map(i => {
            const p = atuais.get(i.id);
            return {
                ...i,
                nome: p.nome,
                preco: Number(p.preco),
                imagem_url: p.imagem_url,
                estoque: p.estoque,
                qtd: Math.min(i.qtd, p.estoque)
            };
        });

    salvarCarrinho(atualizados);
    return atualizados.length < itens.length;
}

/* ---------- Pedidos ---------- */

const codigoPedido = id => '#' + String(id).padStart(4, '0');

const STATUS_PEDIDO = {
    pendente: { rotulo: 'Pendente', classe: 'atencao' },
    em_separacao: { rotulo: 'Em separação', classe: '' },
    pronto: { rotulo: 'Pronto', classe: 'ok' },
    concluido: { rotulo: 'Concluído', classe: 'fim' },
    cancelado: { rotulo: 'Cancelado', classe: 'neutro' }
};

function htmlStatus(pedido) {
    const info = STATUS_PEDIDO[pedido.status] || { rotulo: pedido.status, classe: 'neutro' };
    const rotulo = pedido.status === 'pronto'
        ? (pedido.tipo === 'entrega' ? 'Pronto para entrega' : 'Pronto para retirada')
        : info.rotulo;
    return `<span class="badge ${info.classe}">${esc(rotulo)}</span>`;
}

const textoTipo = tipo => tipo === 'entrega' ? 'Entrega em Casa' : 'Retirada no Mercadinho';

atualizarContadorCarrinho();