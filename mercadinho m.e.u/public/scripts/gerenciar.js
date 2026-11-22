const aviso = document.getElementById('msgAcesso');
const painel = document.getElementById('painelGerenciar');
const form = document.getElementById('formProduto');
const msgForm = document.getElementById('msgForm');
const corpoTabela = document.getElementById('corpoTabela');
const btnSalvar = document.getElementById('btnSalvar');
const btnCancelar = document.getElementById('btnCancelar');
const tituloForm = document.getElementById('tituloForm');
const inputArquivo = document.getElementById('imagemArquivo');
const inputUrl = document.getElementById('imagemUrl');
const previa = document.getElementById('previaImagem');

const ESTOQUE_BAIXO = 5;
let produtos = [];

// Esta checagem é só para a interface. Quem protege os dados de verdade é o servidor.
async function verificarAcesso() {
    let usuario;
    try {
        ({ usuario } = await api('/me'));
    } catch (e) {
        mostrarMensagem(aviso, e.message, 'erro');
        return false;
    }

    if (!usuario) {
        location.replace('login.html');
        return false;
    }

    if (usuario.papel !== 'gerente') {
        mostrarMensagem(aviso, 'Acesso restrito a gerentes.', 'erro');
        return false;
    }

    painel.hidden = false;
    return true;
}

async function carregarProdutos() {
    try {
        produtos = await api('/produtos');
        renderTabela();
    } catch (e) {
        console.error(e);
        mostrarMensagem(msgForm, 'Não foi possível carregar os produtos.', 'erro');
    }
}

function renderTabela() {
    corpoTabela.innerHTML = produtos.length ? produtos.map(p => `
        <tr>
            <td>${esc(p.nome)}</td>
            <td>${esc(p.categoria)}</td>
            <td>${moeda(p.preco)}</td>
            <td class="${p.estoque < ESTOQUE_BAIXO ? 'estoqueBaixo' : ''}">${p.estoque}</td>
            <td>
                <div class="acoesLinha">
                    <button type="button" data-acao="editar" data-id="${p.id}">Editar</button>
                    <button type="button" class="btnSecundario" data-acao="excluir" data-id="${p.id}">Excluir</button>
                </div>
            </td>
        </tr>`).join('')
        : '<tr><td colspan="5">Nenhum produto cadastrado.</td></tr>';
}

function mostrarPrevia(src) {
    if (src) {
        previa.src = src;
        previa.hidden = false;
    } else {
        previa.removeAttribute('src');
        previa.hidden = true;
    }
}

inputArquivo.addEventListener('change', () => {
    const arquivo = inputArquivo.files[0];
    mostrarPrevia(arquivo ? URL.createObjectURL(arquivo) : inputUrl.value.trim());
});

inputUrl.addEventListener('input', () => {
    if (!inputArquivo.files[0]) mostrarPrevia(inputUrl.value.trim());
});

function limparFormulario() {
    form.reset();
    mostrarPrevia('');
    document.getElementById('produtoId').value = '';
    tituloForm.textContent = 'Cadastrar novo produto';
    btnSalvar.textContent = 'Cadastrar produto';
    btnCancelar.hidden = true;
}

function editar(produto) {
    document.getElementById('produtoId').value = produto.id;
    document.getElementById('nome').value = produto.nome;
    document.getElementById('categoria').value = produto.categoria;
    document.getElementById('preco').value = produto.preco;
    document.getElementById('estoque').value = produto.estoque;
    inputUrl.value = produto.imagem_url || '';
    mostrarPrevia(produto.imagem_url);
    document.getElementById('descricao').value = produto.descricao || '';

    tituloForm.textContent = 'Editar produto';
    btnSalvar.textContent = 'Salvar alterações';
    btnCancelar.hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

form.addEventListener('submit', async e => {
    e.preventDefault();

    const dados = {
        nome: document.getElementById('nome').value.trim(),
        categoria: document.getElementById('categoria').value,
        preco: Number(document.getElementById('preco').value),
        estoque: parseInt(document.getElementById('estoque').value, 10),
        imagem_url: inputUrl.value.trim() || null,
        descricao: document.getElementById('descricao').value.trim() || null
    };

    const id = document.getElementById('produtoId').value;
    btnSalvar.disabled = true;

    try {
        // se escolheu um arquivo, envia primeiro e usa o endereço devolvido pelo servidor
        if (inputArquivo.files[0]) {
            const arquivo = new FormData();
            arquivo.append('imagem', inputArquivo.files[0]);
            const { url } = await api('/upload', { method: 'POST', corpo: arquivo });
            dados.imagem_url = url;
        }

        if (id) await api(`/produtos/${id}`, { method: 'PUT', corpo: dados });
        else await api('/produtos', { method: 'POST', corpo: dados });
    } catch (erro) {
        btnSalvar.disabled = false;
        mostrarMensagem(msgForm, erro.message, 'erro');
        return;
    }

    btnSalvar.disabled = false;
    mostrarMensagem(msgForm, id ? 'Produto atualizado.' : 'Produto cadastrado.', 'sucesso');
    limparFormulario();
    await carregarProdutos();
});

btnCancelar.addEventListener('click', limparFormulario);

corpoTabela.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-acao]');
    if (!btn) return;

    const produto = produtos.find(p => p.id === Number(btn.dataset.id));
    if (!produto) return;

    if (btn.dataset.acao === 'editar') {
        editar(produto);
        return;
    }

    if (!confirm(`Excluir "${produto.nome}"?`)) return;

    try {
        await api(`/produtos/${produto.id}`, { method: 'DELETE' });
    } catch (erro) {
        mostrarMensagem(msgForm, erro.message, 'erro');
        return;
    }
    await carregarProdutos();
});

(async () => {
    if (await verificarAcesso()) carregarProdutos();
})();