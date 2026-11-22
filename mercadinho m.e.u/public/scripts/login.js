const form = document.getElementById('formLogin');
const msg = document.getElementById('msgLogin');

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

        const destinos = { gerente: 'gerente.html', funcionario: 'funcionario.html' };
        location.href = destinos[usuario.papel] || 'catalogo.html';
    } catch (erro) {
        btn.disabled = false;
        mostrarMensagem(msg, erro.message, 'erro');
    }
});