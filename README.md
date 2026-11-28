# Mercadinho M.E.U.

Trabalho final da disciplina de **Programação Web**, desenvolvido por **João Pedro Mendes, Anderson Henrique e Gabriel Debiazi**.

O projeto consiste em um marketplace de um mercado externo universitário (**M.E.U.**), construído com HTML, CSS e JavaScript, consumindo uma API própria em Node.js/Express integrada a um banco PostgreSQL e utilizando `localStorage` para o gerenciamento do carrinho de compras.

## Funcionalidades

* **Catálogo e detalhes:** visualização de produtos, busca por nome e filtro por categorias (`Alimentos`, `Bebidas`, `Casa`, `Roupas` e `Construção`).
* **Carrinho de compras:** CRUD completo salvo no `localStorage` do navegador com sincronização de preços e estoque junto à API.
* **Autenticação e pedidos:** cadastro/login de clientes com JWT, finalização de pedido (retirada ou entrega) e acompanhamento em **Meus Pedidos**.

## Como rodar

1. Acesse a pasta do projeto: `cd "mercadinho m.e.u"`
2. Instale as dependências: `npm install`
3. Configure o arquivo `.env` com `DATABASE_URL` e `JWT_SECRET` (baseado no `.env.example`)
4. Inicie o servidor: `npm start`
5. Acesse `http://localhost:3000` no navegador.