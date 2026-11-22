const lista = document.getElementById('listaProdutos');
const filtroNome = document.getElementById('filtroNome');

let produtos = [];
let categoriaAtiva = 'todos';

async function carregarProdutos() {
    try {
        produtos = await api('/produtos');
        render();
    } catch (e) {
        console.error(e);
        lista.innerHTML = '<p class="mensagem erro">Não foi possível carregar os produtos.</p>';
    }
}

function cardProduto(p) {
    const imagem = p.imagem_url
        ? `<img src="${esc(p.imagem_url)}" alt="${esc(p.nome)}">`
        : '<div class="semImagem">Sem imagem</div>';
    const semEstoque = p.estoque < 1;

    return `
        <article class="cardProduto">
            <a class="linkProduto" href="produto.html?id=${p.id}">
                ${imagem}
                <span class="categoriaProduto">${esc(p.categoria)}</span>
                <h3>${esc(p.nome)}</h3>
            </a>
            <p class="preco">${moeda(p.preco)}</p>
            <button type="button" data-id="${p.id}" ${semEstoque ? 'disabled' : ''}>
                ${semEstoque ? 'Sem estoque' : 'Adicionar ao carrinho'}
            </button>
        </article>`;
}

function render() {
    const termo = filtroNome.value.trim().toLowerCase();

    const filtrados = produtos.filter(p =>
        (categoriaAtiva === 'todos' || p.categoria === categoriaAtiva) &&
        p.nome.toLowerCase().includes(termo)
    );

    lista.innerHTML = filtrados.length
        ? filtrados.map(cardProduto).join('')
        : '<p>Nenhum produto encontrado.</p>';
}

lista.addEventListener('click', e => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;

    const produto = produtos.find(p => p.id === Number(btn.dataset.id));
    if (!produto) return;

    const { limitado } = adicionarAoCarrinho(produto, 1);
    btn.textContent = limitado ? 'Limite do estoque' : 'Adicionado!';
    setTimeout(() => { btn.textContent = 'Adicionar ao carrinho'; }, 1200);
});

filtroNome.addEventListener('input', render);

document.querySelectorAll('.btnFiltro').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelector('.btnFiltro.ativo')?.classList.remove('ativo');
        btn.classList.add('ativo');
        categoriaAtiva = btn.dataset.categoria;
        render();
    });
});

carregarProdutos();