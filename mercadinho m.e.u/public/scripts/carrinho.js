const listaItens = document.getElementById('listaItens');
const msg = document.getElementById('carrinhoMsg');

function htmlItem(i) {
    const imagem = i.imagem_url
        ? `<img src="${esc(i.imagem_url)}" alt="${esc(i.nome)}">`
        : '<div class="semImagem">Sem imagem</div>';
    const noLimite = i.estoque !== undefined && i.qtd >= i.estoque;

    return `
        <article class="itemCarrinho">
            ${imagem}
            <div class="itemInfo">
                <strong>${esc(i.nome)}</strong><br>
                <small>${moeda(i.preco)} cada</small>
            </div>
            <div class="quantidade">
                <button type="button" data-acao="menos" data-id="${i.id}" aria-label="Diminuir quantidade" ${i.qtd <= 1 ? 'disabled' : ''}>−</button>
                <span>${i.qtd}</span>
                <button type="button" data-acao="mais" data-id="${i.id}" aria-label="Aumentar quantidade" ${noLimite ? 'disabled' : ''}>+</button>
            </div>
            <div class="itemSubtotal">${moeda(i.preco * i.qtd)}</div>
            <button type="button" class="btnRemover" data-acao="remover" data-id="${i.id}">Remover</button>
        </article>`;
}

function render() {
    const itens = getCarrinho();

    listaItens.innerHTML = '<h2>Seus itens</h2>' + (itens.length
        ? itens.map(htmlItem).join('')
        : '<div class="carrinhoVazio"><p>Seu carrinho está vazio.</p><a class="btn" href="catalogo.html">Ver catálogo</a></div>');

    const subtotal = itens.reduce((soma, i) => soma + i.preco * i.qtd, 0);
    const descontos = 0; // sem regra de desconto por enquanto

    document.getElementById('subtotal').textContent = moeda(subtotal);
    document.getElementById('descontos').textContent = moeda(descontos);
    document.getElementById('total').textContent = moeda(subtotal - descontos);
}

function alterarQuantidade(id, delta) {
    const itens = getCarrinho();
    const item = itens.find(i => i.id === id);
    if (!item) return;

    const limite = Number.isFinite(item.estoque) ? item.estoque : Infinity;
    item.qtd = Math.max(1, Math.min(item.qtd + delta, limite));
    salvarCarrinho(itens);
}

listaItens.addEventListener('click', e => {
    const btn = e.target.closest('button[data-acao]');
    if (!btn) return;

    const id = Number(btn.dataset.id);

    if (btn.dataset.acao === 'mais') alterarQuantidade(id, 1);
    if (btn.dataset.acao === 'menos') alterarQuantidade(id, -1);
    if (btn.dataset.acao === 'remover') salvarCarrinho(getCarrinho().filter(i => i.id !== id));

    render();
});

document.querySelector('.btnContinuar').addEventListener('click', e => {
    if (!getCarrinho().length) {
        e.preventDefault();
        mostrarMensagem(msg, 'Adicione ao menos um produto para continuar.', 'erro');
    }
});

(async () => {
    render();
    if (await sincronizarCarrinho()) {
        mostrarMensagem(msg, 'Alguns itens ficaram indisponíveis e foram removidos do carrinho.', 'erro');
    }
    render();
})();