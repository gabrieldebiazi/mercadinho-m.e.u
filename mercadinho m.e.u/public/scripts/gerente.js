const msg = document.getElementById('dashboardMsg');
const secoes = document.querySelectorAll('.resumoGeral, .atalhosGerente, .alertasEstoque');

function render(d) {
    document.getElementById('vendasDia').textContent = moeda(d.vendasHoje);
    document.getElementById('pedidosPendentes').textContent = d.pedidosPendentes;
    document.getElementById('produtosCadastrados').textContent = d.produtosCadastrados;
    document.getElementById('estoqueBaixo').textContent = d.estoqueBaixo;

    document.getElementById('listaEstoqueBaixo').innerHTML = d.produtosEstoqueBaixo.length
        ? `<ul>${d.produtosEstoqueBaixo.map(p => `
            <li>${esc(p.nome)} - ${p.estoque < 1 ? 'sem estoque' : `${p.estoque} unidade(s) restante(s)`}</li>`).join('')}
           </ul>`
        : '<p>Nenhum produto com estoque baixo.</p>';
}

async function carregarDashboard() {
    try {
        render(await api('/dashboard'));
        msg.hidden = true;
    } catch (e) {
        console.error(e);
        mostrarMensagem(msg, 'Não foi possível atualizar o painel.', 'erro');
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
        location.replace('login.html?voltar=gerente.html');
        return false;
    }

    if (usuario.papel !== 'gerente') {
        mostrarMensagem(msg, 'Acesso restrito a gerentes.', 'erro');
        return false;
    }

    secoes.forEach(secao => { secao.hidden = false; });
    return true;
}

(async () => {
    if (!(await verificarAcesso())) return;
    await carregarDashboard();
    setInterval(carregarDashboard, 30000); // números se atualizam sozinhos
})();