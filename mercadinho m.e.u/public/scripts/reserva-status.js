const id = Number(new URLSearchParams(location.search).get('id'));

const msg = document.getElementById('pedidoMsg');
const conteudo = document.getElementById('pedidoConteudo');

let temporizador = null;

function preencher(p) {
    document.title = `Pedido ${codigoPedido(p.id)} - Mercadinho`;
    document.getElementById('pedidoCodigo').textContent = `Pedido ${codigoPedido(p.id)}`;
    document.getElementById('pedidoStatus').innerHTML = htmlStatus(p);
    document.getElementById('pedidoData').textContent =
        `Feito em ${new Date(p.criado_em).toLocaleString('pt-BR')}`;
    document.getElementById('pedidoTipo').textContent = `Tipo: ${textoTipo(p.tipo)}`;
    document.getElementById('pedidoPagamento').textContent = `Pagamento: ${p.pagamento}`;

    const endereco = document.getElementById('pedidoEndereco');
    endereco.hidden = p.tipo !== 'entrega';
    endereco.textContent = `Endereço: ${p.endereco ?? ''}`;

    document.getElementById('pedidoItens').innerHTML = p.itens
        .map(i => `<li>${i.quantidade}x ${esc(i.nome)} - ${moeda(i.preco_unitario * i.quantidade)}</li>`)
        .join('');

    document.getElementById('pedidoSubtotal').textContent = moeda(p.subtotal);
    document.getElementById('pedidoEntrega').textContent = moeda(p.taxa_entrega);
    document.getElementById('pedidoTotal').textContent = moeda(p.total);

    conteudo.hidden = false;
}

async function carregar() {
    if (!id) {
        mostrarMensagem(msg, 'Pedido não encontrado.', 'erro');
        return;
    }

    try {
        const pedido = await api(`/pedidos/${id}`);
        preencher(pedido);

        // pedidos finalizados não mudam mais
        if (['concluido', 'cancelado'].includes(pedido.status)) clearInterval(temporizador);
    } catch (e) {
        clearInterval(temporizador);
        if (e.status === 401) {
            location.replace(`login.html?voltar=reserva-status.html?id=${id}`);
            return;
        }
        mostrarMensagem(msg, e.status === 404 ? 'Pedido não encontrado.' : e.message, 'erro');
    }
}

carregar();
temporizador = setInterval(carregar, 15000); // atualiza o status sozinho