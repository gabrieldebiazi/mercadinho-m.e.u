// Barra de navegação que acompanha o login.
// Carregue depois de api.js e utils.js, em TODAS as páginas.
//
// O login em si fica no cookie do servidor (dura 7 dias). O sessionStorage guarda só
// o papel para desenhar a barra na hora, sem esperar o servidor responder.
// Ele serve apenas para exibição: quem decide o que cada pessoa pode fazer é o servidor.

const CHAVE_USUARIO = 'usuario';

function lerUsuarioSessao() {
    try {
        const usuario = JSON.parse(sessionStorage.getItem(CHAVE_USUARIO));
        return usuario && typeof usuario.papel === 'string' ? usuario : null;
    } catch {
        return null;
    }
}

function salvarUsuarioSessao(usuario) {
    try {
        if (usuario) {
            sessionStorage.setItem(CHAVE_USUARIO, JSON.stringify({ papel: usuario.papel }));
        } else {
            sessionStorage.removeItem(CHAVE_USUARIO);
        }
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

    const MENU_POR_PAPEL = {
        cliente: ['home', 'catalogo', 'sobre', 'carrinho', 'meusPedidos'],
        visitante: ['home', 'catalogo', 'sobre', 'carrinho']
    };

    // páginas que não têm link próprio no menu marcam outro link como ativo
    const ATIVO_COMO = { 'checkout.html': 'carrinho.html' };

    const pagina = location.pathname.split('/').pop() || 'index.html';
    const paginaAtiva = ATIVO_COMO[pagina] || pagina;

    function renderizar(usuario) {
        const papel = usuario?.papel in MENU_POR_PAPEL ? usuario.papel : 'visitante';

        const links = MENU_POR_PAPEL[papel].map(chave => {
            const [texto, href] = LINKS[chave];
            return `<a class="link${href === paginaAtiva ? ' ativo' : ''}" href="${href}">${texto}</a>`;
        }).join('');

        const conta = usuario
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
        const emCache = lerUsuarioSessao();

        if (emCache) renderizar(emCache);
        else botoes.style.visibility = 'hidden'; // evita mostrar "Entrar" por um instante para quem já está logado

        let usuario = emCache;
        try {
            ({ usuario } = await api('/me'));
            salvarUsuarioSessao(usuario);
        } catch {
            // sem conexão com o servidor: mantém o que já estava na tela
        }

        renderizar(usuario);
        botoes.style.visibility = '';
    })();
})();