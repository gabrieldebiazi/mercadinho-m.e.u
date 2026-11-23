const form = document.getElementById('formLogin');
const msg = document.getElementById('msgLogin');

// ex.: login.html?voltar=checkout.html (só aceita páginas do próprio site)
const voltar = new URLSearchParams(location.search).get('voltar');
const destinoVoltar = /^[a-z-]+\.html(\?id=\d+)?$/.test(voltar ?? '') ? voltar : null;

form.addEventListener('submit', async e => {
    e.preventDefault();

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;

    try {
        const { usuario } = await api('/login', {
            method: 'POST',
            corpo: {
                email: document.getElementById('email').value.trim(),
                senha: document.getElementById('senha').value
            }
        });

        salvarUsuarioSessao(usuario);

        const destinos = { gerente: 'gerente.html', funcionario: 'funcionario.html' };
        location.href = destinoVoltar || destinos[usuario.papel] || 'catalogo.html';
    } catch (erro) {
        btn.disabled = false;
        mostrarMensagem(msg, erro.message, 'erro');
    }
});