const id = Number(new URLSearchParams(location.search).get('id'));

const msg = document.getElementById('produtoMsg');
const conteudo = document.getElementById('produtoConteudo');
const inputQtd = document.getElementById('produtoQtd');
const btnAdicionar = document.getElementById('btnAdicionar');

let produto = null;

async function carregarProduto() {
    if (!id) {
        mostrarMensagem(msg, 'Produto não encontrado.', 'erro');
        return;
    }

    try {
        produto = await api(`/produtos/${id}`);
    } catch (e) {
        mostrarMensagem(msg, e.status === 404 ? 'Produto não encontrado.' : e.message, 'erro');
        return;
    }

    preencher();
}

function htmlEstoque() {
    if (produto.estoque < 1) return '<span class="badge neutro">Indisponível</span>';
    if (produto.estoque <= 5) return `<span class="badge atencao">Últimas ${produto.estoque} unidade(s)</span>`;
    return `<span class="badge ok">Em estoque (${produto.estoque} unidades)</span>`;
}

function quantidadeValida() {
    const qtd = parseInt(inputQtd.value, 10) || 1;
    return Math.max(1, Math.min(qtd, Math.max(produto.estoque, 1)));
}

function atualizarTotal() {
    document.getElementById('produtoTotal').textContent =
        `Total: ${moeda(produto.preco * quantidadeValida())}`;
}

function preencher() {
    document.title = `${produto.nome} - Mercadinho`;

    const categoria = document.getElementById('produtoCategoria');
    categoria.textContent = produto.categoria;
    categoria.href = `catalogo.html?categoria=${encodeURIComponent(produto.categoria)}`;

    document.getElementById('produtoNome').textContent = produto.nome;
    document.getElementById('produtoPreco').textContent = moeda(produto.preco);
    document.getElementById('produtoDescricao').textContent =
        (produto.descricao || '').trim() || 'Este produto ainda não tem descrição.';
    document.getElementById('produtoEstoque').innerHTML = htmlEstoque();

    const img = document.getElementById('produtoImagem');
    const semImagem = document.getElementById('produtoSemImagem');
    if (produto.imagem_url) {
        img.onerror = () => { img.hidden = true; semImagem.hidden = false; };
        img.src = produto.imagem_url;
        img.alt = produto.nome;
        img.hidden = false;
    } else {
        semImagem.hidden = false;
    }

    if (produto.estoque < 1) {
        btnAdicionar.disabled = true;
        inputQtd.disabled = true;
    } else {
        inputQtd.max = produto.estoque;
    }

    atualizarTotal();
    conteudo.hidden = false;
}

inputQtd.addEventListener('input', () => { if (produto) atualizarTotal(); });

btnAdicionar.addEventListener('click', () => {
    if (!produto) return;

    const qtd = quantidadeValida();
    inputQtd.value = qtd;
    atualizarTotal();

    const resultado = adicionarAoCarrinho(produto, qtd);
    mostrarMensagem(
        msg,
        resultado.limitado
            ? `Quantidade ajustada ao estoque disponível (${resultado.qtd} no carrinho).`
            : `Produto adicionado! Você tem ${resultado.qtd} no carrinho.`,
        resultado.limitado ? 'erro' : 'sucesso'
    );
});

carregarProduto();