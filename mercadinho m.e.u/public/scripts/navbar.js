// Barra de navegação que acompanha o login.
// Carregue depois de api.js e utils.js, em TODAS as páginas.
//
// O login em si fica no cookie do servidor (dura 7 dias). O sessionStorage guarda só
// se há alguém logado, para desenhar a barra na hora, sem esperar o servidor responder.
// Ele serve apenas para exibição: quem decide o que cada pessoa pode ver é o servidor.

const CHAVE_USUARIO = 'usuario';

function sessaoLogada() {
    try {
        return sessionStorage.getItem(CHAVE_USUARIO) === 'logado';
    } catch {
        return false;
    }
}

// recebe o usuário devolvido pela API (ou null ao sair)
function salvarUsuarioSessao(usuario) {
    try {
        if (usuario) sessionStorage.setItem(CHAVE_USUARIO, 'logado');
        else sessionStorage.removeItem(CHAVE_USUARIO);
    } catch {
        // sessionStorage indisponível: a barra continua funcionando pelo servidor
    }
}

(function () {
    const barra = document.querySelector('.barraNavegacao');
    const botoes = barra?.querySelector('.botoes');
    if (!botoes) return;

    const LINKS = {
        home: ['Home', 'index.html'],
        catalogo: ['Catálogo', 'catalogo.html'],
        sobre: ['Sobre', 'sobre.html'],
        carrinho: ['Carrinho', 'carrinho.html'],
        meusPedidos: ['Meus Pedidos', 'meus-pedidos.html']
    };

    const MENU_VISITANTE = ['home', 'catalogo', 'sobre', 'carrinho'];
    const MENU_LOGADO = [...MENU_VISITANTE, 'meusPedidos'];

    // páginas que não têm link próprio no menu marcam outro link como ativo
    const ATIVO_COMO = { 'checkout.html': 'carrinho.html' };

    const pagina = location.pathname.split('/').pop() || 'index.html';
    const paginaAtiva = ATIVO_COMO[pagina] || pagina;

    function renderizar(logado) {
        const links = (logado ? MENU_LOGADO : MENU_VISITANTE).map(chave => {
            const [texto, href] = LINKS[chave];
            return `<a class="link${href === paginaAtiva ? ' ativo' : ''}" href="${href}">${texto}</a>`;
        }).join('');

        const conta = logado
            ? '<a class="btnSair" href="#">Sair</a>'
            : `<a class="btnEntrar${pagina === 'login.html' ? ' ativo' : ''}" href="login.html">Entrar</a>`;

        botoes.innerHTML = links + conta;

        if (typeof atualizarContadorCarrinho === 'function') atualizarContadorCarrinho();
    }

    barra.addEventListener('click', async e => {
        if (!e.target.closest('.btnSair')) return;
        e.preventDefault();

        try {
            await api('/logout', { method: 'POST' });
        } catch {
            alert('Não foi possível sair. Tente novamente.');
            return;
        }

        salvarUsuarioSessao(null);
        location.href = 'login.html';
    });

    (async () => {
        const emCache = sessaoLogada();

        if (emCache) renderizar(true);
        else botoes.style.visibility = 'hidden'; // evita mostrar "Entrar" por um instante para quem já está logado

        let logado = emCache;
        try {
            const { usuario } = await api('/me');
            logado = Boolean(usuario);
            salvarUsuarioSessao(usuario);
        } catch {
            // sem conexão com o servidor: mantém o que já estava na tela
        }

        renderizar(logado);
        botoes.style.visibility = '';
    })();
})();