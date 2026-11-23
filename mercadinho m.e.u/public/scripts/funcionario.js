const msg = document.getElementById('pedidosMsg');
const filtros = document.getElementById('filtrosPedidos');
const lista = document.getElementById('listaPedidos');

let pedidos = [];
let filtro = 'todos';

// próxima ação de cada status
const ACOES = {
    pendente: { status: 'em_separacao', texto: 'Iniciar Separação' },
    em_separacao: { status: 'pronto', texto: 'Marcar como Pronto' },
    pronto: { status: 'concluido', texto: 'Concluir Pedido' }
};

function cardPedido(p) {
    const proxima = ACOES[p.status];
    const botoes = proxima
        ? `<button type="button" data-id="${p.id}" data-status="${proxima.status}">${proxima.texto}</button>
           <button type="button" class="btnSecundario" data-id="${p.id}" data-status="cancelado">Cancelar</button>`
        : '';

    return `
        <div>
            <h2>Pedido ${codigoPedido(p.id)}</h2>
            <p>${htmlStatus(p)}</p>
            <p>Cliente: ${esc(p.nome_cliente)}</p>
            <p>Telefone: ${esc(p.telefone)}</p>
            <p>Tipo: ${textoTipo(p.tipo)}</p>
            ${p.tipo === 'entrega' ? `<p>Endereço: ${esc(p.endereco)}</p>` : ''}
            <p>Pagamento: ${esc(p.pagamento)}</p>

            <ul>
                ${p.itens.map(i => `<li>${i.quantidade}x ${esc(i.nome)}</li>`).join('')}
            </ul>

            <p>Total: <strong>${moeda(p.total)}</strong></p>
            <p>Feito em ${new Date(p.criado_em).toLocaleString('pt-BR')}</p>

            ${botoes ? `<div>${botoes}</div>` : ''}
        </div>`;
}

function render() {
    const visiveis = pedidos.filter(p => filtro === 'todos' || p.status === filtro);

    lista.innerHTML = visiveis.length
        ? visiveis.map(cardPedido).join('')
        : '<p>Nenhum pedido encontrado.</p>';
}

async function carregarPedidos() {
    try {
        pedidos = await api('/pedidos');
        render();
    } catch (e) {
        console.error(e);
        mostrarMensagem(msg, 'Não foi possível carregar os pedidos.', 'erro');
    }
}

// Esta checagem é só para a interface. Quem protege os dados de verdade é o servidor.
async function verificarAcesso() {
    let usuario;
    try {
        ({ usuario } = await api('/me'));
    } catch (e) {
        mostrarMensagem(msg, e.message, 'erro');
        return false;
    }

    if (!usuario) {
        location.replace('login.html?voltar=funcionario.html');
        return false;
    }

    if (!['funcionario', 'gerente'].includes(usuario.papel)) {
        mostrarMensagem(msg, 'Acesso restrito à equipe do mercadinho.', 'erro');
        return false;
    }

    filtros.hidden = false;
    lista.hidden = false;
    return true;
}

filtros.addEventListener('click', e => {
    const btn = e.target.closest('button[data-status]');
    if (!btn) return;

    filtros.querySelector('.ativo')?.classList.remove('ativo');
    btn.classList.add('ativo');
    filtro = btn.dataset.status;
    render();
});

lista.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;

    const id = Number(btn.dataset.id);
    const novo = btn.dataset.status;

    if (novo === 'cancelado' &&
        !confirm(`Cancelar o pedido ${codigoPedido(id)}? Os itens voltam para o estoque.`)) {
        return;
    }

    btn.disabled = true;
    try {
        await api(`/pedidos/${id}/status`, { method: 'PATCH', corpo: { status: novo } });
        msg.hidden = true;
    } catch (erro) {
        mostrarMensagem(msg, erro.message, 'erro');
    }
    await carregarPedidos();
});

(async () => {
    if (!(await verificarAcesso())) return;
    await carregarPedidos();
    setInterval(carregarPedidos, 30000); // novos pedidos aparecem sozinhos
})();