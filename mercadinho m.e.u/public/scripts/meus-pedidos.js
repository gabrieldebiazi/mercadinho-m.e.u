const msg = document.getElementById('pedidosMsg');
const lista = document.getElementById('listaMeusPedidos');

// pedidos que ainda podem mudar de status
const EM_ANDAMENTO = ['pendente', 'em_separacao', 'pronto'];

let temporizador = null;

function cardPedido(p) {
    const entrega = p.tipo === 'entrega';

    return `
        <article class="resumoPedido">
            <div>
                <h2>Pedido ${codigoPedido(p.id)}</h2>
                ${htmlStatus(p)}
            </div>

            <p>Feito em ${new Date(p.criado_em).toLocaleString('pt-BR')}</p>
            <p>Tipo: ${textoTipo(p.tipo)}</p>
            ${entrega ? `<p>Endereço: ${esc(p.endereco)}</p>` : ''}
            <p>Pagamento: ${esc(p.pagamento)}</p>

            <ul>
                ${p.itens.map(i =>
                    `<li>${i.quantidade}x ${esc(i.nome)} - ${moeda(i.preco_unitario * i.quantidade)}</li>`
                ).join('')}
            </ul>

            <div>
                <p>Subtotal</p>
                <p>${moeda(p.subtotal)}</p>
            </div>
            ${entrega ? `
            <div>
                <p>Entrega</p>
                <p>${moeda(p.taxa_entrega)}</p>
            </div>` : ''}
            <div>
                <h2>Total</h2>
                <h2>${moeda(p.total)}</h2>
            </div>
        </article>`;
}

async function carregar() {
    try {
        const pedidos = await api('/meus-pedidos');

        lista.innerHTML = pedidos.length
            ? pedidos.map(cardPedido).join('')
            : `<div class="card carrinhoVazio">
                   <p>Você ainda não fez nenhum pedido.</p>
                   <a class="btn" href="catalogo.html">Ver catálogo</a>
               </div>`;

        // sem pedidos em andamento não há o que atualizar
        if (!pedidos.some(p => EM_ANDAMENTO.includes(p.status))) clearInterval(temporizador);
    } catch (e) {
        clearInterval(temporizador);
        if (e.status === 401) {
            location.replace('login.html?voltar=meus-pedidos.html');
            return;
        }
        lista.innerHTML = '';
        mostrarMensagem(msg, e.message, 'erro');
    }
}

// chegou aqui depois de finalizar a compra (checkout.js)
if (new URLSearchParams(location.search).get('pedido') === 'ok') {
    mostrarMensagem(msg, 'Pedido realizado com sucesso! Acompanhe o andamento abaixo.', 'sucesso');
    history.replaceState(null, '', 'meus-pedidos.html'); // atualizar a página não repete o aviso
}

temporizador = setInterval(carregar, 15000); // atualiza o status sozinho
carregar();