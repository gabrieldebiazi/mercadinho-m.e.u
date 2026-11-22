const form = document.getElementById('formCadastro');
const msg = document.getElementById('msgCadastro');

form.addEventListener('submit', async e => {
    e.preventDefault();

    const senha = document.getElementById('senha').value;

    if (senha.length < 6) {
        mostrarMensagem(msg, 'A senha deve ter pelo menos 6 caracteres.', 'erro');
        return;
    }

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;

    try {
        // o servidor já deixa o usuário logado depois de cadastrar
        const { usuario } = await api('/cadastro', {
            method: 'POST',
            corpo: {
                nome: document.getElementById('nome').value.trim(),
                email: document.getElementById('email').value.trim(),
                senha
            }
        });

        salvarUsuarioSessao(usuario);
        mostrarMensagem(msg, 'Cadastro realizado! Redirecionando...', 'sucesso');
        setTimeout(() => { location.href = 'catalogo.html'; }, 1200);
    } catch (erro) {
        btn.disabled = false;
        mostrarMensagem(msg, erro.message, 'erro');
    }
});