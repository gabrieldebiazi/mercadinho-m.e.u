// Comunicação com o servidor (server.js), que fala com o banco Neon.
// Em caso de erro, lança uma Error com a mensagem em português vinda do servidor.
async function api(caminho, { method = 'GET', corpo } = {}) {
    let resposta;

    try {
        resposta = await fetch('/api' + caminho, {
            method,
            headers: corpo ? { 'Content-Type': 'application/json' } : {},
            body: corpo ? JSON.stringify(corpo) : undefined,
            credentials: 'same-origin'
        });
    } catch {
        throw new Error('Não foi possível conectar ao servidor.');
    }

    let dados = null;
    try {
        dados = await resposta.json();
    } catch {
        // respostas sem corpo (ex.: 204)
    }

    if (!resposta.ok) {
        const e = new Error(dados?.erro || 'Erro ao processar a requisição.');
        e.status = resposta.status;
        throw e;
    }

    return dados;
}