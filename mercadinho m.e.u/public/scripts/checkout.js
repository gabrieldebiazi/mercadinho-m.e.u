const form = document.getElementById('formCheckout');
const msg = document.getElementById('checkoutMsg');
const btnConfirmar = document.getElementById('btnConfirmar');
const campoEndereco = document.getElementById('campoEndereco');
const inputEndereco = document.getElementById('endereco');

let taxaEntrega = 0;

const tipoEscolhido = () => form.elements.tipo.value;

function erroNaTela(texto) {
    mostrarMensagem(msg, texto, 'erro');
    msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderResumo() {
    const itens = getCarrinho();
    const subtotal = itens.reduce((soma, i) => soma + i.preco * i.qtd, 0);
    const entrega = tipoEscolhido() === 'entrega' ? taxaEntrega : 0;

    document.getElementById('resumoItens').innerHTML = itens
        .map(i => `<li>${i.qtd}x ${esc(i.nome)} - ${moeda(i.preco * i.qtd)}</li>`)
        .join('');
    document.getElementById('resumoSubtotal').textContent = moeda(subtotal);
    document.getElementById('resumoEntrega').textContent = moeda(entrega);
    document.getElementById('resumoTotal').textContent = moeda(subtotal + entrega);
}

function atualizarTipo() {
    const entrega = tipoEscolhido() === 'entrega';
    campoEndereco.hidden = !entrega;
    inputEndereco.required = entrega;
    renderResumo();
}

function bloquear(texto) {
    btnConfirmar.disabled = true;
    mostrarMensagem(msg, texto, 'erro');
}

form.querySelectorAll('input[name="tipo"]').forEach(r => r.addEventListener('change', atualizarTipo));

async function iniciar() {
    if (!getCarrinho().length) {
        bloquear('Seu carrinho está vazio. Adicione produtos pelo catálogo.');
        return;
    }

    let usuario;
    try {
        ({ usuario } = await api('/me'));
    } catch (e) {
        bloquear(e.message);
        return;
    }

    // o carrinho fica guardado no navegador, então não se perde ao entrar na conta
    if (!usuario) {
        location.replace('login.html?voltar=checkout.html');
        return;
    }

    document.getElementById('nome').value = usuario.nome;

    try {
        ({ taxaEntrega } = await api('/configuracao'));
    } catch {
        // sem a taxa, o servidor ainda calcula o valor correto ao confirmar
    }

    const removidos = await sincronizarCarrinho();

    if (!getCarrinho().length) {
        bloquear('Os itens do seu carrinho ficaram indisponíveis.');
        return;
    }
    if (removidos) {
        mostrarMensagem(msg, 'Alguns itens ficaram indisponíveis e foram removidos do pedido.', 'erro');
    }

    atualizarTipo();
}

form.addEventListener('submit', async e => {
    e.preventDefault();
    btnConfirmar.disabled = true;

    try {
        await api('/pedidos', {
            method: 'POST',
            corpo: {
                nome: document.getElementById('nome').value.trim(),
                telefone: document.getElementById('telefone').value.trim(),
                tipo: tipoEscolhido(),
                endereco: inputEndereco.value.trim(),
                pagamento: document.getElementById('pagamento').value,
                itens: getCarrinho().map(i => ({ id: i.id, qtd: i.qtd }))
            }
        });

        salvarCarrinho([]);
        location.href = 'meus-pedidos.html?pedido=ok';
    } catch (erro) {
        btnConfirmar.disabled = false;
        erroNaTela(erro.message);

        if (erro.status === 401) {
            location.href = 'login.html?voltar=checkout.html';
        } else if (erro.status === 409) {
            // estoque mudou: atualiza o carrinho e o resumo com os valores atuais
            await sincronizarCarrinho();
            renderResumo();
        }
    }
});

iniciar();