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

function preencher() {
    document.title = `${produto.nome} - Mercadinho`;
    document.getElementById('produtoCategoria').textContent = produto.categoria;
    document.getElementById('produtoNome').textContent = produto.nome;
    document.getElementById('produtoPreco').textContent = moeda(produto.preco);
    document.getElementById('produtoDescricao').textContent = produto.descricao || '';

    const img = document.getElementById('produtoImagem');
    if (produto.imagem_url) {
        img.src = produto.imagem_url;
        img.alt = produto.nome;
        img.hidden = false;
    } else {
        document.getElementById('produtoSemImagem').hidden = false;
    }

    const estoque = document.getElementById('produtoEstoque');
    if (produto.estoque < 1) {
        estoque.textContent = 'Produto sem estoque no momento.';
        btnAdicionar.disabled = true;
        inputQtd.disabled = true;
    } else {
        estoque.textContent = `${produto.estoque} unidade(s) em estoque`;
        inputQtd.max = produto.estoque;
    }

    conteudo.hidden = false;
}

btnAdicionar.addEventListener('click', () => {
    if (!produto) return;

    let qtd = parseInt(inputQtd.value, 10) || 1;
    qtd = Math.max(1, Math.min(qtd, produto.estoque));
    inputQtd.value = qtd;

    const resultado = adicionarAoCarrinho(produto, qtd);
    mostrarMensagem(
        msg,
        resultado.limitado
            ? `Quantidade ajustada ao estoque disponível (${resultado.qtd} no carrinho).`
            : 'Produto adicionado ao carrinho.',
        resultado.limitado ? 'erro' : 'sucesso'
    );
});

carregarProduto();